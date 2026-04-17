# Releasing Mach Terminal

This document defines the production release process for Mach Terminal.

## Release Channels

- **Stable tags:** `vX.Y.Z` (semver, no prerelease suffix)
- **Release candidate tags:** `vX.Y.Z-rc.N` (prerelease; auto-published to GitHub Releases)

## Stable vs RC behavior

| Aspect | Stable (`vX.Y.Z`) | RC (`vX.Y.Z-rc.N`) |
|--------|-------------------|---------------------|
| GitHub Release | **Draft** until promoted (see below) | Published as **pre-release** automatically |
| Signing secrets | **Required** in CI (`TAURI_SIGNING_PRIVATE_KEY`, `UPDATER_PUBLIC_KEY`) — workflow fails if missing | Optional; build still runs if validation job is skipped |
| Updater manifest | Shipped in artifacts when signing is configured; users on stable channel pick up `latest.json` after promotion | Pre-release builds are suitable for testers; point testers at the RC asset or a separate manifest if needed |

## Preflight Checklist

1. Run local validation:
   - `npm run check:versions`
   - `npm run test`
   - `npm run release:smoke`
2. Verify `CHANGELOG.md` has an entry for the target version.
3. Confirm nightly burn-in is green for the last 3 runs.
4. Confirm updater manifest endpoint is reachable (GitHub `latest.json` for your repo).

## Required GitHub Secrets

- `TAURI_SIGNING_PRIVATE_KEY`
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`
- `UPDATER_PUBLIC_KEY`
- `APPLE_CERTIFICATE`
- `APPLE_CERTIFICATE_PASSWORD`
- `APPLE_SIGNING_IDENTITY`
- `APPLE_ID`
- `APPLE_PASSWORD`
- `APPLE_TEAM_ID`
- `WINDOWS_CERTIFICATE`
- `WINDOWS_CERTIFICATE_PASSWORD`

If signing credentials are unavailable for a platform, release workflow will still build artifacts but will skip the signing step for that platform.

## Release Execution (stable)

1. Create and push a **stable** tag:
   - `git tag vX.Y.Z`
   - `git push origin vX.Y.Z`
2. Wait for `.github/workflows/release.yml` to complete. The release is created as a **draft** with attached assets.
3. Verify generated assets and checksums on the draft release.
4. **Promote** the draft to a public release: run workflow **Promote release** (`.github/workflows/promote-release.yml`) with the tag name, **or** manually publish the draft in GitHub (ensure “Set as latest” matches your intent).
5. Confirm `latest.json` updater manifest points to the new version (GitHub release assets).

The promote workflow refuses tags that look like RC (`-rc.`) so stable promotion stays explicit.

## Release Execution (RC)

1. Tag `vX.Y.Z-rc.N` and push.
2. CI publishes a **pre-release** automatically (not draft). Use for testers; avoid telling stable-channel users to rely on it without understanding pre-release semantics.

## Updater contract (GA)

- **Dev / local builds:** `plugins.updater.active` is `false` in `src-tauri/tauri.conf.json`; the UI shows updater as disabled unless the frontend is built with `VITE_ENABLE_UPDATER=true` (release workflow sets this).
- **CI release builds:** `scripts/enable-updater-build.mjs` enables the updater plugin before `tauri build`.
- **Channels:** End users consume updates via the manifest URL in `tauri.conf.json` (default: `.../releases/latest/download/latest.json`). Stable users should only follow **promoted** stable releases; RC testers can install RC assets manually or use a separate endpoint if you maintain one.

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
