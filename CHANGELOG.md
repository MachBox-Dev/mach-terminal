# Changelog

All notable changes to Mach Terminal are documented in this file.

## [Unreleased]

### Added

- **TER-11:** Multi-pane workspace — binary split tree (up to 6 panes/tab), draggable resize, unified group composer, **independent focus vs target** (`Ctrl+Alt+N` focus · `Ctrl+Alt+Shift+N` target on Windows), one-shot broadcast, `workspace_layout` schema v2.
- `docs/manual-qa.md` and `docs/shell-integration.md` (content moved out of README).
- Gitleaks secret scan in CI and `npm run security:gitleaks`; updater manifest decoupled from committed config (`MACH_UPDATER_ENDPOINT` at release only).
- Release signing bootstrap: `docs/signing-setup.md`, `scripts/setup-release-signing.ps1`, and `npm run release:setup-signing`.
- Shell profile picker with cross-platform `detect_shells` (WSL distro enumeration, `/etc/shells`, profile `args`).
- Persisted workspace tabs (`RestorableSession`: shell, cwd, name, chatKey, inputMode) with cold-restart respawn and layout remap.
- Per-session AI chat persistence (`chatKey` + localStorage) with exit-save overlay and phased close flush.
- Operator/Commander input modes, composer Cmd/AI intent chip, and ops-rail AI chat panel.
- AI read-only tools (`list_command_runs`, `get_command_output`) with native tool loop for OpenAI, Ollama, and Anthropic.
- Resizable ops rail; Explain/Safer gated on configured AI providers.
- Dogfood release CI workflow and `npm run release:build` local production bundles.

### Fixed

- **TER-6:** `Ctrl/Cmd+K` works from composer — global shortcut allowlist in `keymap.ts`.
- **TER-7:** Split pane spawns an independent PTY (`createSessionInNewPane`) instead of mirroring `activeSession.id`.
- **TER-8:** Tab switch collapses multi-pane layout via `collapseToSinglePane()`. *(Superseded by TER-11: tab switch no longer collapses splits.)*
- **TER-1:** Instant default tab spawn restored; shell picker via Shift+click `+` / palette; cached `detect_shells`.
- **TER-4:** Commander/xterm viewport realignment at scrollback bottom (`terminalViewport.ts`: tail detection + `refresh()` after pin).
- CI release-smoke: disable updater artifacts without signing keys; build `deb` only (AppImage/linuxdeploy often hangs on GHA).
- Release builds: inject updater `pubkey` via `enable-updater-build.mjs` (literal key required; `$UPDATER_PUBLIC_KEY` in JSON is not expanded). Skip Tier 2 OS cert env in `release.yml` until real certs exist.
- App close after exit-save overlay: grant `core:window:allow-destroy` so `destroy()` succeeds after `preventDefault`; persist failures no longer block close (`runExitPersistAndClose`).
- AI provider failures no longer pollute the global runtime error strip (status stays in ops-rail AI request status / provider config status).
- xterm output pump drains pending writes across RAF frames instead of clearing the buffer in one shot.
- Multi-pane: composer/terminal `exit` collapses target pane; split direction no longer sticks after horizontal split; focus/target sync on pane close; zombie layout on boot fixed.

### Removed

- 45s PTY idle-output stale banner (`sessionOutputHealth.ts`) — idle prompts are normal; real exit still uses lifecycle overlay.

### Changed

- **README** trimmed to quick start + feature summary + doc index; manual QA checklists → `docs/manual-qa.md`.
- `docs/oss-prep.md` marked completed (historical); see `docs/oss-flip-day.md`.
- Bundle identifier **`com.machbox.terminal`** (was `com.whobs.machterminal`) — breaking vs `v0.1.0-rc.1`; reinstall required; see `docs/bundle-id-migration.md`.
- Release workflow re-adds Tier 2 **`APPLE_*`** env for macOS signing (reuse Mach Triage Developer ID; see `docs/signing-setup.md`).
- Repository prepared for public release under `MachBox-Dev` (open-core client; Mach Cloud out of scope).
- `bundle.createUpdaterArtifacts: true` for signed updater bundles on release builds (disabled for debug smoke via `disable-updater-artifacts.mjs`).
- Provider settings and onboarding share canonical `buildProviderCards` view-model.
- Titlebar-integrated tabs with inline rename and short shell labels.

## [0.1.0] - 2026-04-15

### Added

- PTY session lifecycle commands and event streaming.
- Multi-session tabs, split workspace primitives, command palette, and keymap controls.
- History query/replay commands and AI explain/fix UX hooks.
- OTel-ready runtime telemetry, burn-in scripts, nightly burn-in workflow, and threshold gates.
- Release-readiness foundation including updater scaffolding, release workflows, and signing documentation.

### Changed

- Runtime capabilities now report truthful session persistence status.
- Frontend terminal output handling now uses bounded buffering and batched writes.

### Fixed

- Session teardown reliability and exit cleanup behavior.
- Build-time icon asset gap by generating full Tauri icon set.
