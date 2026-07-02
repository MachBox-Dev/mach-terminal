# Changelog

All notable changes to Mach Terminal are documented in this file.

## [Unreleased]

## [0.1.0-rc.10] - 2026-07-02

### Added

- **TER-54:** `machterm://ai-note` deep link — lands text from a sibling Mach app (first consumer: Triage's Armory) in the AI panel as a reviewable, removable attachment; never auto-sent to a provider.
- **TER-59:** `machterm://composer` deep link — sibling to TER-54's `ai-note` scheme; lands Armory-sent text (or a newline-separated set of commands) in the terminal composer as a reviewable, never-auto-submitted draft.
- **TER-37:** Unified session registry (`sessionRegistry.ts`) — `pruneAllSessionScopedState` / `removeSessionFromRegistry` for all per-session maps and transient PTY refs.
- **TER-39:** PTY scrollback store (`sessionBufferStore.ts`, `useSessionBuffer`) — scrollback off React state; panes subscribe per session.
- **TER-29–36 (UX audit):** Command palette WAI-ARIA combobox + focus trap; titlebar tab scroll; global focus-visible rings; tab rename F2; design token cleanup; titlebar menu keyboard nav; focus-vs-target coach mark.
- `docs/deep-link-contract.md` — shared contract for both `machterm://` schemes.
- Linear audit scripts (`linear-create-ux-audit.mjs`, `linear-create-foundation-audit.mjs`).

### Fixed

- **Workspace split/tab:** Split inherits active pane shell/cwd; append-only `addNewSessionTab`; functional `setWorkspace` for split/new-tab; solo-tab `exit` closes tab; tab X uses fresh workspace ref; `reconcileWorkspaceInPlace` on session removal (no orphan-tab explosion).

## [0.1.0-rc.9] - 2026-06-25

### Added

- **TER-26:** Shared `ProviderAiProvidersPanel` — live per-field provider saves in Settings and onboarding advanced AI (`liveProviderSettings` from `useProviderAiState`).
- **TER-27:** `typical_8kb_reads_do_not_hit_pending_cap` Rust baseline; `docs/phase2-perf-spike.md` automated go/no-go criteria.
- **TER-28:** `workspaceFocus.smoke.test.ts`, `settingsPaletteCoordination.smoke.test.ts`, extended `providerUiState.smoke.test.ts`.
- Canonical provider/AI status strings in `providerUiState.ts`; `surfaceErrorMessage()` for onboarding error parity.
- Linear housekeeping scripts: `linear-create-ter-26-28.mjs`, `linear-close-ter-26-28.mjs`, `linear-close-ter-24-25.mjs`.

### Fixed

- **CI:** PTY pipeline perf gate runs in `--release` only (`npm run test:perf`); debug `npm test` / burn-in assert correctness without flaky MiB/s floors on GHA matrix runners.
- **Security:** `quinn-proto` 0.11.15 (RUSTSEC-2026-0185), transitive via `reqwest` HTTP/3 stack.

### Changed

- `npm run test:perf` uses `--release` with 100 MiB/s throughput floor; debug runs log throughput but do not gate CI.

## [0.1.0-rc.8] - 2026-06-25

### Added

- **Hot-path:** Raw-bytes `Channel` transport for PTY output (`pty_subscribe_output`); WebGL xterm renderer (`@xterm/addon-webgl`) with DOM fallback; `npm run test:perf` pipeline throughput gate (~75 MiB/s debug, 50 MiB/s floor).
- `RestorableSession.args` persisted end-to-end so WSL distro args survive cold restart.
- App hooks: `usePtyOutputStream`, `useSessionBoot`, `useWorkspaceFocus`; `workspaceFocus.ts` terminal focus event after tab/pane switch.
- **TER-25:** Terminal hyperlinks require Ctrl+click (Win/Linux) or Cmd+click (Mac) to open — Windows Terminal parity; plain click no longer launches browser/file handler.
- **TER-9:** Command palette quick-launch entries for saved presets and detected shells (`preset:` / `shell:` command ids).
- **TER-19:** Sticky broadcast mode (`off` | `once` | `sticky`) — click Broadcast for one-shot, Shift+click for sticky; `Ctrl/Cmd+Alt+Shift+B` arms sticky; palette disarm command; workspace layout migrates legacy `broadcastMode: boolean`.
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

- **Hot-path:** Streaming UTF-8 decode across PTY read boundaries (no spurious U+FFFD on split multibyte codepoints); multi-tab restore races (subscribe-before-spawn, channel output backlog, lifecycle pending-output wipe).
- **Workspace:** Tab switch repairs stale pane ids, syncs composer target to focus, routes keyboard focus to Operator composer or Commander xterm.
- **TER-22:** Windows PTY spawn refreshes `PATH` from User + Machine registry (WinGet/mise/scoop shims visible without Explorer restart); `profile.env` overlay preserved.
- **TER-23:** New-tab / boot perf — shell picker uses cached `detect_shells` on mount; WSL distro probe times out at 2s; deferred shell prefetch; cached boot profile; `pty_spawn` skips redundant settings read when profile provided; picker loads in parallel with profile fetch.
- **TER-6:** `Ctrl/Cmd+K` works from composer — global shortcut allowlist in `keymap.ts`.
- **TER-7:** Split pane spawns an independent PTY (`createSessionInNewPane`) instead of mirroring `activeSession.id`.
- **TER-8:** Tab switch collapses multi-pane layout via `collapseToSinglePane()`. *(Superseded by TER-11: tab switch no longer collapses splits.)*
- **TER-1:** Instant default tab spawn restored; shell picker via Shift+click `+` / palette; cached `detect_shells`.
- **TER-4:** Commander/xterm viewport realignment at scrollback bottom (`terminalViewport.ts`: tail detection + `refresh()` after pin).
- **TER-24:** Commander/tmux xterm repaint stall — `refresh()` after every PTY write; visibility/focus recovery when WebView2 RAF throttles.
- **TER-25:** Heuristic link provider off-by-one on xterm `provideLinks` coordinates — hover underline + Ctrl/Cmd+click now work in pwsh/WSL.
- CI release-smoke: disable updater artifacts without signing keys; build `deb` only (AppImage/linuxdeploy often hangs on GHA).
- CI reliability: release smoke runs on warmed `ubuntu-22.04` matrix leg (not a cold standalone job); `scripts/ci/install-linux-tauri-deps.sh` adds deb bundling deps; `swatinem/rust-cache` on Linux workflows; nightly burn-in threshold gates calibrated for TER-11 soak times and Windows GHA cold `npm run test` latency (orphan-PTY hardZero removed).
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
