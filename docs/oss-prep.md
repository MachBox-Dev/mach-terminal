# OSS Preparation Checklist

> Track progress toward making **mach-terminal** public under Apache-2.0 (open-core:
> entire client open; Mach Cloud relay/service stays proprietary and ships later).
> Mach Cloud is **out of scope** for this pass.

**GitHub org (settled):** [`MachBox-Dev`](https://github.com/MachBox-Dev) — public home for OSS repos.  
**Suite domain:** [`machbox.dev`](https://machbox.dev) — registered.

---

## Status legend

| Symbol | Meaning |
| --- | --- |
| ✅ | Done (or acceptable as-is) |
| 🟡 | Draft exists — needs review or a small follow-up |
| ⬜ | Not started |
| 🔒 | Blocked on a human decision (Mike) |

---

## 1. Branding & domains

**Umbrella domain (settled):** `machbox.dev` — HSTS-preloaded `.dev`, under budget, neutral
suite root (not tied to Triage or a personal site).

`mach-triage.com` stays live; plan a 301 to `triage.machbox.dev` when Triage marketing
moves under the suite (no rush — both can coexist during dogfood).

**Subdomain layout:**

```
machbox.dev                 → suite marketing home
terminal.machbox.dev        → Mach Terminal landing + docs
triage.machbox.dev          → Mach Triage (mach-triage.com 301s here eventually)
api.machbox.dev             → Mach Cloud relay (future, proprietary)
accounts.machbox.dev        → shared SSO (future)
docs.machbox.dev            → shared / OSS docs (optional)
```

| Task | Status |
| --- | --- |
| Pick umbrella domain + register | ✅ | **`machbox.dev`** |
| DNS: apex + `terminal.machbox.dev` | 🟡 | Site in progress (logos, etc.) — flip not blocked |
| Plan `mach-triage.com` → `triage.machbox.dev` redirect | 🔒 when Triage site moves |
| Decide GitHub org | ✅ | **`MachBox-Dev`** (`MachBox` was taken) |
| Transfer repo to `MachBox-Dev/mach-terminal` + flip public | ✅ | [Public repo](https://github.com/MachBox-Dev/mach-terminal) |
| Org profile README → `MachBox-Dev/.github/profile/README.md` | ✅ |
| Mailboxes: `security@`, `conduct@` on `machbox.dev` | 🟡 | Set up with site/DNS (Cloudflare Email Routing) |
| Updater URL → `github.com/MachBox-Dev/mach-terminal/...` | ✅ | Set in `release.yml`; takes effect after transfer |

---

## 2. Legal & governance docs

| File | Status | Notes |
| --- | --- | --- |
| `LICENSE` (Apache-2.0) | 🟡 | Present; copyright holder = Mike Whobrey — confirm entity name if you incorporate |
| `NOTICE` | 🟡 | Third-party attribution stub; regenerate full dep list before first release tag |
| `PRINCIPLES.md` | ✅ | North Star + open-core split documented |
| `CONTRIBUTING.md` | ✅ | DCO (`git commit -s`), gate commands, boundary rules |
| `CODE_OF_CONDUCT.md` | ✅ | `conduct@machbox.dev` |
| `SECURITY.md` | ✅ | GitHub advisories + `security@machbox.dev` |
| DCO sign-off on all external PRs | ✅ | Documented in CONTRIBUTING |
| CLA | ⬜ | **Not required** while using DCO; revisit if dual-licensing Mach Cloud client bits later |

---

## 3. Repository hygiene (pre-flip)

### Secrets & history

| Task | Status | How |
| --- | --- | --- |
| Scan full git history for keys/tokens | ✅ | `gitleaks detect --source .` — 46 commits, no leaks (2026-06-17) |
| Quick manual grep (no `sk-`, `AKIA`, PEM blocks in history) | ✅ | Spot-check + gitleaks clean |
| If history is dirty | ⬜ | Squash to fresh root **or** `git filter-repo` — do not flip public with secrets |

### Internal / maintainer-only content

| Item | Status | Recommendation |
| --- | --- | --- |
| `.cursor/runbook/` | ✅ | Stays gitignored (local agent context) |
| `docs/continuation-handoff.md` | ✅ | Gitignored + removed from index; stays local for agent handoff |
| `config/burnin-thresholds.generated.json` | ✅ | Repo-relative `artifacts/...` path |
| `.cursorrules` | ✅ | Tracked; fine for OSS (documents agent workflow) |

### Hardcoded maintainer endpoints

| Item | Status | Notes |
| --- | --- | --- |
| Updater manifest URL in `tauri.conf.json` | ✅ | Committed `endpoints: []`; release CI injects `MACH_UPDATER_ENDPOINT` |
| OTLP telemetry | ✅ | Opt-in only when `OTEL_EXPORTER_OTLP_ENDPOINT` is set |
| Bundle id `com.machbox.terminal` | ✅ | Was `com.whobs.machterminal` in RC.1; see `docs/bundle-id-migration.md` |
| `package.json` `"private": false` | ✅ | Set for public OSS home |

### GitHub templates & policies

| Task | Status |
| --- | --- |
| Bug report issue template | ✅ |
| Feature request issue template | ✅ |
| Pull request template | ✅ |
| Enable GitHub Security Advisories on public repo | ✅ |
| `security@` / `conduct@` mailboxes on `machbox.dev` | ⬜ |

---

## 4. README & user-facing docs

| Task | Status |
| --- | --- |
| README: project name, principles link, contributing link | ✅ |
| README: drop "scaffold" language — you're late beta | ✅ |
| README: security / telemetry transparency (OTLP opt-in, keychain BYOK) | ✅ |
| `RELEASING.md`: document `MACH_UPDATER_ENDPOINT` | ✅ |
| `CHANGELOG.md` current for v0.1.0 | ✅ |

---

## 5. Build & release posture for OSS consumers

| Task | Status | Notes |
| --- | --- | --- |
| Core works with AI off, no account | ✅ | Architecture + PRINCIPLES |
| Updater off by default in dev builds | ✅ | `active: false` + `VITE_ENABLE_UPDATER` gate |
| Official signed releases via CI only | ✅ | `release.yml` + signing secrets |
| Fork-friendly local build (`npm run tauri dev`) | ✅ | Documented |
| Dependency license audit in NOTICE | ⬜ | Script or manual pass before v0.1.0 public tag |

---

## 6. Flip sequence (do in order)

1. ✅ Register umbrella domain — **`machbox.dev`**
2. ✅ Land legal/governance docs + OSS prep commit on `main`.
3. ✅ Run `gitleaks` / full history audit (also in CI `security-baseline`).
4. ✅ Remove or gitignore `docs/continuation-handoff.md`.
5. ✅ Set `package.json` `"private": false`.
6. ✅ Transfer → **`MachBox-Dev/mach-terminal`** + public + Security Advisories.
7. ⬜ Run `.\scripts\setup-release-signing.ps1` (Tier 1 updater secrets) — see [`docs/signing-setup.md`](signing-setup.md)
8. 🟡 Apex site on `machbox.dev` + `terminal.machbox.dev` (in progress).
9. ⬜ Green CI on `main` + tag `v0.1.0` (or next) with signed artifacts.
10. ⬜ Announce from `machbox.dev` when site is ready.

**Do not** enable Mach Cloud provider in the client until the relay exists — the
open-core seam is already drawn in `PRINCIPLES.md`.

---

## 7. Verification before public tag

Same gate as always:

```bash
npm run test:types
npm run test:ux
npm run test:ux:smoke
cargo test --manifest-path src-tauri/Cargo.toml
npm run security:baseline
npm run security:gitleaks
```

Also: manual README link check; confirm no maintainer updater URL in committed `tauri.conf.json`.

---

## 8. Tooling — gitleaks (secret scan)

Not bundled with the repo. Install once, then run before the public flip (and on
any commit that might touch credentials):

**Windows (winget):**
```powershell
winget install Gitleaks.Gitleaks
# new shell may be required for PATH
gitleaks detect --source .
```

**npm script (after install):**
```bash
npm run security:gitleaks
```

CI runs the same scan in the `security-baseline` job (`.github/workflows/ci.yml`).

---

## 9. DNS quickstart (post-registration)

Minimum viable DNS before the public flip. Use your registrar or Cloudflare (recommended —
free email routing + Pages).

### Mail (do first — unblocks SECURITY.md / CODE_OF_CONDUCT contacts)

Cloudflare Email Routing (or registrar equivalent):

| Address | Forwards to |
| --- | --- |
| `security@machbox.dev` | your inbox |
| `conduct@machbox.dev` | your inbox |

### Web stubs (can be ugly for now)

| Host | Suggested target | Purpose |
| --- | --- | --- |
| `machbox.dev` | GitHub Pages / Cloudflare Pages / simple static | Suite one-liner + links to Terminal + Triage |
| `terminal.machbox.dev` | Same Pages project or `CNAME` → `MachBox-Dev.github.io` | Terminal landing; can redirect to GitHub README until you build a page |

**Fastest path:** one Cloudflare Pages site on the apex with `terminal` as a path or
subdomain redirect to `https://github.com/MachBox-Dev/mach-terminal`.

### Optional (later)

| Host | When |
| --- | --- |
| `triage.machbox.dev` | When Triage marketing moves under the suite |
| `api.machbox.dev` | Mach Cloud relay ships |
| `accounts.machbox.dev` | Suite SSO ships |
