# Release signing setup (from scratch)

Mach Terminal uses **two independent signing layers**:

| Layer | Purpose | Required for stable tag? |
| --- | --- | --- |
| **Tauri updater signing** | Signs update bundles + `latest.json`; in-app updater verifies before install | **Yes** (`TAURI_SIGNING_PRIVATE_KEY`, `UPDATER_PUBLIC_KEY`) |
| **OS code signing** | Windows Authenticode / macOS Developer ID — removes SmartScreen & Gatekeeper friction | **No** for CI to run; **yes** for polished public downloads |

Stable tags **fail immediately** if updater signing secrets are missing (`validate-stable-signing` in `release.yml`).  
OS cert secrets are optional — without them in `release.yml`, `tauri-action` builds **unsigned** installers (SmartScreen / Gatekeeper warnings until Tier 2 is wired). Do **not** add placeholder `APPLE_*` / `WINDOWS_*` secrets; invalid values break macOS builds.

---

## Tier 1 — Updater signing (do this now)

### 1. Run the setup script (interactive)

From repo root, in PowerShell:

```powershell
.\scripts\setup-release-signing.ps1
```

This will:

1. Create `%USERPROFILE%\.machbox\mach-terminal-signing\` (outside the repo)
2. Run `tauri signer generate` (you choose a **strong password** — store in 1Password/etc.)
3. Upload GitHub Actions secrets to **`MachBox-Dev/mach-terminal`**

**If you lose the private key or password, you cannot ship updates to users who already installed a build signed with this key.** Back up the `.key` file offline.

### 2. Secrets created

| Secret | Contents |
| --- | --- |
| `TAURI_SIGNING_PRIVATE_KEY` | Full text of `mach-terminal.key` |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | Password you entered at generation |
| `UPDATER_PUBLIC_KEY` | Full text of `mach-terminal.key.pub` (minisign public key) |

Verify:

```powershell
gh secret list --repo MachBox-Dev/mach-terminal
```

### 3. Config already wired

- `src-tauri/tauri.conf.json` → `bundle.createUpdaterArtifacts: true`; committed `pubkey` is empty (OSS clones)
- `scripts/enable-updater-build.mjs` → injects `UPDATER_PUBLIC_KEY` + enables updater endpoint on release builds only (Tauri does **not** expand `$ENV` in config JSON)
- `release.yml` → Tier 1 updater signing secrets only; add Tier 2 `APPLE_*` / `WINDOWS_*` to the tauri-action step when OS certs are ready

Official docs: [Tauri updater signing](https://v2.tauri.app/plugin/updater/#signing-updates)

### 4. Re-upload only (keys already on disk)

```powershell
.\scripts\setup-release-signing.ps1 -UploadOnly
```

### 5. Regenerate keys (destructive — breaks updater for existing installs)

```powershell
.\scripts\setup-release-signing.ps1 -Force
```

Only if you have **zero** public release artifacts signed with the old key.

---

## Tier 2 — OS code signing (macOS first)

Adds trust at download time. **Required for polished macOS downloads**; Windows OV cert is optional (Mach Triage also omits `WINDOWS_CERTIFICATE` in CI).

### Reuse Mach Triage Apple credentials (recommended)

Mach Triage (proprietary repo) already builds signed + notarized macOS installers with your personal Apple Developer account. Terminal can use the **same** cert — no second enrollment.

1. List secrets on the Triage repo (where they already work):

   ```powershell
   gh secret list --repo <your-mach-triage-repo>
   ```

2. Copy these to **`MachBox-Dev/mach-terminal`** (repo secrets or org secrets scoped to both repos):

   | Secret | Notes |
   | --- | --- |
   | `APPLE_CERTIFICATE` | Base64 `.p12` (Developer ID Application) |
   | `APPLE_CERTIFICATE_PASSWORD` | **Do not set** in GitHub — `release.yml` hardcodes `""` (Triage pattern) when the export has no password |
   | `APPLE_ID` | Apple ID email |
   | `APPLE_PASSWORD` | App-specific password for notarization |
   | `APPLE_TEAM_ID` | 10-char team id |
   | `APPLE_SIGNING_IDENTITY` | Optional — see **Exact identity string** below; omit to let Tauri infer from `.p12` |

3. `release.yml` already passes these to `tauri-action` (mirrors Triage).

4. Tag an RC and confirm macOS job produces a signed `.dmg` without keychain import errors.

If macOS CI fails with `failed to import keychain certificate`, the `.p12` base64 or export password is wrong — fix secrets, do **not** add placeholders.

### Exact identity string (`APPLE_SIGNING_IDENTITY`)

On a Mac with the `.p12` imported into Keychain Access:

```bash
security find-identity -v -p codesigning
```

Example line:

```text
  1) ABCD1234... "Developer ID Application: Michael Whobrey (HTZ6P7R555)"
```

Use **one** of these in the GitHub secret (no surrounding `"` characters):

- Full name: `Developer ID Application: Michael Whobrey (HTZ6P7R555)`
- Team id only: `HTZ6P7R555` (Tauri accepts the parenthesized team id)

Release CI runs `scripts/ci/verify-macos-signing.sh` on macOS before `tauri-action`: it imports `APPLE_CERTIFICATE` with an empty password, prints available identities, and fails early if `APPLE_SIGNING_IDENTITY` does not match. If the secret is **unset**, Tauri infers the identity from the certificate (recommended when copying certs from Mach Triage).

**Common mistakes**

| Mistake | Symptom |
| --- | --- |
| Literal quotes in the secret value (`"Developer ID Application: …"`) | `failed to resolve signing identity` or identity mismatch |
| Non-empty `APPLE_CERTIFICATE_PASSWORD` secret while `.p12` has no password | Import may succeed but Tauri cannot resolve a valid identity |
| Wrong or truncated `APPLE_CERTIFICATE` base64 (re-copy from Triage) | `No valid codesigning identities` in verify step |

### Windows (`WINDOWS_CERTIFICATE`, `WINDOWS_CERTIFICATE_PASSWORD`)

- Purchase an **OV code signing** cert (not SSL). ~$200–400/yr.
- Export `.pfx`, base64-encode for the secret.
- Without it: builds work; SmartScreen may warn on download.

[Tauri Windows signing](https://v2.tauri.app/distribute/sign/windows/)

### macOS (`APPLE_*` secrets)

- Apple Developer account ($99/yr).
- **Developer ID Application** cert for distribution outside App Store.
- Export `.p12` → base64 → `APPLE_CERTIFICATE`.
- Also need `APPLE_ID`, `APPLE_PASSWORD` (app-specific password), `APPLE_TEAM_ID`, `APPLE_SIGNING_IDENTITY`.
- Without it: builds work; users get “app can’t be opened” until right-click → Open, or ad-hoc `-` identity for ARM only.

[Tauri macOS signing](https://v2.tauri.app/distribute/sign/macos/)

### Dogfood without OS certs

Use **Actions → Dogfood Build** (unsigned release bundles, no GitHub Release). Good for internal testing while certs are pending.

---

## Tier 3 — First stable release smoke test

After Tier 1 secrets are set:

1. Confirm CI green on `main`
2. Tag an **RC** first (signing secrets optional for RC):

   ```bash
   git tag v0.1.0-rc.1
   git push origin v0.1.0-rc.1
   ```

3. Verify draft/pre-release assets on GitHub
4. Tag stable when happy:

   ```bash
   git tag v0.1.0
   git push origin v0.1.0
   ```

5. Promote draft per `RELEASING.md`

---

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| `Stable releases require TAURI_SIGNING_PRIVATE_KEY` | Run `setup-release-signing.ps1` |
| `failed to decode pubkey` / `Invalid symbol 36` | Pubkey was literal `$UPDATER_PUBLIC_KEY` — release CI must run `enable-updater-build.mjs` with `UPDATER_PUBLIC_KEY` secret set |
| `failed to import keychain certificate` (macOS) | Remove invalid placeholder `APPLE_*` secrets, or add real Tier 2 certs to `release.yml` |
| `failed to resolve signing identity` (macOS) | Delete `APPLE_CERTIFICATE_PASSWORD` repo secret; hardcode empty password in workflow (done). Re-copy `APPLE_CERTIFICATE` from Mach Triage. Fix `APPLE_SIGNING_IDENTITY` — no quotes; match `security find-identity -v -p codesigning` or omit secret for auto-infer. See verify step log in Release workflow. |
| `failed to resolve signing identity` (macOS) | Export **Developer ID Application** `.p12` (not Apple Distribution / Development). `APPLE_SIGNING_IDENTITY` must match `security find-identity -v -p codesigning` exactly — e.g. `Developer ID Application: Michael Whobrey (HTZ6P7R555)`. No quotes in the secret. Delete `APPLE_CERTIFICATE_PASSWORD` if set. CI runs `scripts/ci/verify-macos-signing.sh` before build. |
| Updater checks fail in installed app | `UPDATER_PUBLIC_KEY` must match the key that signed the **installed** build |
| `createUpdaterArtifacts` / no `.sig` files | Ensure `bundle.createUpdaterArtifacts: true` in `tauri.conf.json` |
| `gh secret set` permission denied | Org owner/admin on `MachBox-Dev`, or repo admin |
