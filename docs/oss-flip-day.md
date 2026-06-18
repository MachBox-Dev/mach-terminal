# OSS flip day — runbook

> Mach Cloud stays out of scope.

## Current state (2026-06-18)

| Item | Status |
| --- | --- |
| Domain `machbox.dev` | Registered |
| Org `MachBox-Dev` + profile README | Done |
| Site / logos | In progress |
| **`MachBox-Dev/mach-terminal`** | **Public** |
| Security Advisories | Enabled |
| Local `origin` remote | `git@github.com:MachBox-Dev/mach-terminal.git` |
| OSS prep on `main` | Pushed (`95eb026`) |
| Actions secrets on org repo | Tier 1 via `setup-release-signing.ps1` (user-run) |
| First org release tag | Pending green CI + secrets |

---

## Completed — Phase A

- A1 OSS prep committed and pushed
- A2 Transfer to `MachBox-Dev`
- A3 Public visibility
- A5 Security Advisories enabled

### A4. Updater signing secrets (Tier 1 — required)

**Never set before.** Run from repo root:

```powershell
.\scripts\setup-release-signing.ps1
```

Full guide: [`docs/signing-setup.md`](signing-setup.md). Creates three secrets:

| Secret | Purpose |
| --- | --- |
| `TAURI_SIGNING_PRIVATE_KEY` | Signs update bundles |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | Key password |
| `UPDATER_PUBLIC_KEY` | Embedded in release builds for updater verification |

Verify: `gh secret list --repo MachBox-Dev/mach-terminal`

### A4b. OS code signing (Tier 2 — optional, later)

Windows/macOS Authenticode certs — see `docs/signing-setup.md`. Builds work without them; downloads may show OS warnings.

---

## Phase B — Infra (parallel with site work)

| Task | Blocks |
| --- | --- |
| `security@` + `conduct@` → your inbox | Real security contact |
| `terminal.machbox.dev` → site or GitHub redirect | Marketing |
| Apex `machbox.dev` links to Terminal + Triage | Announce |

Site polish does **not** block using GitHub as canonical docs.

---

## Phase C — First public release (next)

1. ~~Re-run CI on `main`~~ ✅
2. ~~Signing secrets (Tier 1 + Apple Tier 2)~~ ✅
3. Commit bundle id `com.machbox.terminal` + tag **`v0.1.0-rc.2`**
4. Verify Release workflow (signed macOS + all matrix legs)
5. Promote stable `v0.1.0` when RC validated per `RELEASING.md`

## Phase D — Product bugs (Linear)

| ID | Issue |
| --- | --- |
| TER-1 | New-tab profile picker |
| TER-2 | OS code signing (Apple wired; Windows OV optional) |
| TER-3 | Bundle id migration (code done) |
| TER-4 | Commander mode scroll alignment at buffer bottom |
| TER-5 | Command history stale until manual refresh |

---

## Phase E — Announce (when site is ready)

- Link from `machbox.dev` → [github.com/MachBox-Dev/mach-terminal](https://github.com/MachBox-Dev/mach-terminal) + Triage
- Release notes: `PRINCIPLES.md`, install from Releases

---

## Post-flip product (not blocking)

| Item | Status |
| --- | --- |
| New-tab profile picker (TER-1) | Backlog |
| Bundle id `com.machbox.terminal` (TER-3) | Done on main — ship in `v0.1.0-rc.2` |
| Apple signing secrets | On org repo |
| Full `NOTICE` dep regeneration | Before stable `v0.1.0` |
| Mach Cloud / `api.machbox.dev` | When relay exists |

---

## Rollback

Org repos can be made private again (plan-dependent). Transfers are hard to undo — prefer fixing forward.
