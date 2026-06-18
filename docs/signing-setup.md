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

## Tier 2 — OS code signing (later, optional)

Adds trust at download time. Not required for the workflow to produce GitHub Release assets.

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
| Updater checks fail in installed app | `UPDATER_PUBLIC_KEY` must match the key that signed the **installed** build |
| `createUpdaterArtifacts` / no `.sig` files | Ensure `bundle.createUpdaterArtifacts: true` in `tauri.conf.json` |
| `gh secret set` permission denied | Org owner/admin on `MachBox-Dev`, or repo admin |
