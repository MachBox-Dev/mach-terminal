# Releasing Mach Terminal

This document defines the production release process for Mach Terminal.

**Canonical repository:** [`MachBox-Dev/mach-terminal`](https://github.com/MachBox-Dev/mach-terminal)  
**Updater manifest (stable):** `https://github.com/MachBox-Dev/mach-terminal/releases/latest/download/latest.json`  
(injected at release build time via `MACH_UPDATER_ENDPOINT` — see `scripts/enable-updater-build.mjs`)

## Release Channels

- **Stable tags:** `vX.Y.Z` (semver, no prerelease suffix)
- **Release candidate tags:** `vX.Y.Z-rc.N` (prerelease; auto-published to GitHub Releases)

## Stable vs RC behavior

| Aspect | Stable (`vX.Y.Z`) | RC (`vX.Y.Z-rc.N`) |
|--------|-------------------|---------------------|
| GitHub Release | **Draft** until promoted (see below) | Published as **pre-release** automatically |
| Signing secrets | **Required** in CI (`TAURI_SIGNING_PRIVATE_KEY`, `UPDATER_PUBLIC_KEY`) — workflow fails if missing | Optional; build still runs if validation job is skipped |
| Updater manifest | Shipped in artifacts when signing is configured; users on stable channel pick up `latest.json` after promotion | Pre-release builds are suitable for testers; point testers at the RC asset or a separate manifest if needed |

## What CI already enforces

Before any release artifacts ship, automation covers overlapping checks:

| Surface | Where | What runs |
|---------|-------|-----------|
| Matrix PR/push CI | `.github/workflows/ci.yml` — job `matrix-build-and-test` | `npm run build`, `npm run test` (includes `npm run test:pty`), `npm run test:invoke:strict`, `cargo check` |
| Stability gate | `.github/workflows/ci.yml` — job `stability-signoff` on PR/master | `npm run stability:signoff` (`check:versions`, full tests, UX smoke, strict invoke, frontend build) |
| Security | `.github/workflows/ci.yml` — job `security-baseline` | `npm run security:baseline` |
| Release bundle smoke | `.github/workflows/ci.yml` — job `release-smoke` | `npm run release:smoke` — debug `deb` only (no AppImage; avoids linuxdeploy hangs); updater artifacts off |
| Tagged release | `.github/workflows/release.yml` — job `preflight-release-quality` | `check:versions`, `npm run test`, `npm run stability:signoff`, `npm run release:smoke`, `npm run security:baseline` |
| Post-build checksums | `.github/workflows/release.yml` — job `publish-checksums` | Downloads release assets, writes `SHA256SUMS.txt`, uploads to the GitHub Release |

Stable tags additionally require signing secrets (`validate-stable-signing` job). **Code signing** for macOS/Windows still depends on platform certificates in that workflow; **artifact integrity for downloaders** is the SHA256 file published next to installers. Before promoting a draft stable release, open the release on GitHub and confirm `SHA256SUMS.txt` is present and matches expectations.

Local dry run (`npm run release:dry-run`) hashes debug-bundle outputs into `artifacts/release-dry-run-checksums.txt`; it does not replace `release:smoke` or signing.

## Preflight Checklist

1. Run local validation (matches CI/release enforcement):
   - `npm run check:versions`
   - `npm run test`
   - `npm run stability:signoff`
   - `npm run release:smoke`
   - `npm run security:baseline`
2. Verify `CHANGELOG.md` has an entry for the target version.
3. Confirm latest nightly burn-in is green and threshold gate passed.
4. Confirm updater manifest endpoint is reachable (`MACH_UPDATER_ENDPOINT` / GitHub `latest.json` for your repo).

## Required GitHub Secrets

### Tier 1 — Updater signing (required for stable tags)

Set up from scratch: **[`docs/signing-setup.md`](signing-setup.md)** (run `.\scripts\setup-release-signing.ps1`).

| Secret | Purpose |
| --- | --- |
| `TAURI_SIGNING_PRIVATE_KEY` | Minisign private key (full file contents) |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | Key encryption password |
| `UPDATER_PUBLIC_KEY` | Minisign public key (full `.pub` file contents) |

Stable tag CI **fails** if `TAURI_SIGNING_PRIVATE_KEY` or `UPDATER_PUBLIC_KEY` is missing.

### Tier 2 — OS code signing (optional; polish, not blocker)

| Secret | Platform |
| --- | --- |
| `APPLE_CERTIFICATE` | macOS — base64 `.p12` |
| `APPLE_CERTIFICATE_PASSWORD` | macOS |
| `APPLE_SIGNING_IDENTITY` | macOS |
| `APPLE_ID` | macOS notarization |
| `APPLE_PASSWORD` | macOS — app-specific password |
| `APPLE_TEAM_ID` | macOS |
| `WINDOWS_CERTIFICATE` | Windows — base64 `.pfx` |
| `WINDOWS_CERTIFICATE_PASSWORD` | Windows |

If OS signing credentials are unavailable, release workflow builds **unsigned** OS installers (Tier 1 updater signing still applies). Do not add placeholder `APPLE_*` / `WINDOWS_*` secrets — wire them into `release.yml` only with valid certs (see `docs/signing-setup.md`).

## Release Execution (stable)

1. Create and push a **stable** tag:
   - `git tag vX.Y.Z`
   - `git push origin vX.Y.Z`
2. Wait for `.github/workflows/release.yml` to complete. The release is created as a **draft** with attached assets.
   - The workflow now enforces preflight gates before publishing artifacts:
     - version consistency
     - full tests
     - stability signoff
     - release smoke
     - security baseline
3. Verify generated assets and checksums on the draft release.
4. **Promote** the draft to a public release: run workflow **Promote release** (`.github/workflows/promote-release.yml`) with the tag name, **or** manually publish the draft in GitHub (ensure “Set as latest” matches your intent).
   - The promote workflow now blocks unless:
     - release is still a draft
     - successful `CI` and `Release` runs exist for the release commit
     - latest `Nightly Burn-In` run succeeded
5. Confirm `latest.json` updater manifest points to the new version (GitHub release assets).

The promote workflow refuses tags that look like RC (`-rc.`) so stable promotion stays explicit.

## Release Execution (RC)

1. Tag `vX.Y.Z-rc.N` and push.
2. CI publishes a **pre-release** automatically (not draft). Use for testers; avoid telling stable-channel users to rely on it without understanding pre-release semantics.

## Updater contract (GA)

- **Dev / local builds:** `plugins.updater.active` is `false` in `src-tauri/tauri.conf.json`; the UI shows updater as disabled unless the frontend is built with `VITE_ENABLE_UPDATER=true` (release workflow sets this).
- **CI release builds:** `scripts/enable-updater-build.mjs` enables the updater plugin before `tauri build`.
- **Channels:** Committed `tauri.conf.json` ships with `endpoints: []` so OSS clones do not phone a maintainer release URL. Official release CI sets `MACH_UPDATER_ENDPOINT` (see `scripts/enable-updater-build.mjs` and `.github/workflows/release.yml`) before building signed packages. Stable users should only follow **promoted** stable releases; RC testers can install RC assets manually or use a separate endpoint if you maintain one.

## Rollback Procedure

1. Mark a bad release as pre-release/draft or delete assets if necessary.
2. Re-point `latest.json` (or GitHub latest release) to the last known-good stable version.
3. Ship a hotfix tag after validation (`vX.Y.Z+1` or patch).

**Downgrading clients:** Tauri updater installs forward by default. To move users backward, they may need to reinstall an older installer from GitHub Releases; document that for support.

## Dry Run

Run:

```bash
npm run release:dry-run
```

This validates build, tests, version consistency, and Tauri bundle smoke checks without publishing.

## GA candidate signoff (week-1 cut line)

Before calling a build GA-ready:

- Stable promotion path (draft → promote) is understood and documented above.
- Signing secrets present for stable tags; CI did not skip required validation unexpectedly.
- `npm run stability:signoff` passes and `artifacts/stability-signoff/stability-signoff-report.json` includes `ga_cutline` criteria (see script).
- First-run settings path verified (profile + providers + routing) without editing JSON by hand.
- Command history survives restart; corrupt `command_history.json` is backed up and surfaced in-app once via recovery notice.
