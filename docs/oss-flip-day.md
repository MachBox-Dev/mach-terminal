# OSS flip day — runbook

> Execute when `machbox.dev` site + email are ready and the OSS prep commit is on `main`.
> Mach Cloud stays out of scope.

**Current state (update before you run this):**

| Item | Status |
| --- | --- |
| Domain `machbox.dev` | Registered |
| Org `MachBox-Dev` + profile README | Done |
| Site / logos | In progress (Mike) |
| Repo remote | `mwhobrey/mach-terminal` (private) — **not yet on org** |
| OSS prep commit | Ready to push on `main` |

---

## Phase A — Repo (you, ~20 min)

### A1. Commit and push OSS prep to `main`

From `mach-terminal` locally:

```bash
npm run test:types
npm run test:ux
npm run test:ux:smoke
cargo test --manifest-path src-tauri/Cargo.toml
npm run security:gitleaks
```

Then commit the OSS batch (governance docs, `oss-prep`, gitleaks CI, updater decoupling,
`continuation-handoff` untracked, `private: false`).

### A2. Transfer to the org

GitHub → `mwhobrey/mach-terminal` → **Settings** → **General** → **Transfer ownership**

- New owner: **`MachBox-Dev`**
- Confirm repo name stays **`mach-terminal`**
- You must be org owner

After transfer:

```bash
git remote set-url origin git@github.com:MachBox-Dev/mach-terminal.git
git remote -v
```

### A3. Make public

`MachBox-Dev/mach-terminal` → **Settings** → **General** → **Danger zone** → **Change visibility** → **Public**

### A4. Re-add secrets (they do not transfer)

Org repo → **Settings** → **Secrets and variables** → **Actions**

| Secret | Required for |
| --- | --- |
| `TAURI_SIGNING_PRIVATE_KEY` | Signed releases |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | Signing |
| `UPDATER_PUBLIC_KEY` | Updater manifest |
| `APPLE_*` | macOS signing (if used) |
| `WINDOWS_*` | Windows signing (if used) |

### A5. Enable Security Advisories

**Settings** → **Security** → **Private vulnerability reporting** / **GitHub Advisory** — enable for the public repo.

---

## Phase B — Infra (parallel with site work)

| Task | Blocks |
| --- | --- |
| `security@` + `conduct@` → your inbox | Real security contact |
| `terminal.machbox.dev` → site or GitHub redirect | Marketing |
| Apex `machbox.dev` links to Terminal + Triage | Announce |

Site polish (logos) does **not** block the repo going public if README + GitHub are canonical.

---

## Phase C — First public release (after transfer)

1. Confirm CI green on `MachBox-Dev/mach-terminal` `main`
2. `CHANGELOG.md` — add `[0.1.1]` or ship `0.1.0` OSS announcement entry if you want a fresh tag
3. Tag from org repo:

   ```bash
   git tag v0.1.0   # or next semver
   git push origin v0.1.0
   ```

4. `release.yml` uses `MACH_UPDATER_ENDPOINT=https://github.com/MachBox-Dev/mach-terminal/releases/latest/download/latest.json`
5. Promote draft stable release per `RELEASING.md`

---

## Phase D — Announce (when site is ready)

- Org README already live
- Post/link from `machbox.dev` → Terminal repo + Triage
- Optional: GitHub Release notes pointing at `PRINCIPLES.md` and install instructions

---

## Not required for flip (defer)

| Item | When |
| --- | --- |
| Bundle id `com.whobs.machterminal` → `com.machbox.terminal` | Before wide public install push (breaking) |
| Full `NOTICE` dep regeneration | Before first org release tag |
| `triage.machbox.dev` 301 | When Triage marketing moves |
| Mach Cloud / `api.machbox.dev` | When relay exists |

---

## Rollback

If something goes wrong after public flip: **Settings** → visibility back to private (org repos can be made private again on paid plans — verify your org plan). Transfers are harder to undo; test secrets + CI on org **before** tagging.
