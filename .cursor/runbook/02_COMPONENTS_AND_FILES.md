# 02 · Components & Files

## Top-Level Directory Map

```
mach-terminal/
├── src/                  # React + TS frontend (webview)
│   ├── main.tsx          # React root mount
│   ├── App.tsx           # Top-level orchestrator: state + wiring (PTY output/boot/focus extracted to hooks)
│   ├── App.css           # All app styling (hand-rolled)
│   ├── components/       # Presentational + interactive UI (.tsx) + their smoke tests
│   ├── core/             # PURE logic + the IPC bridge (terminal.ts). Heavily unit-tested
│   ├── hooks/            # React hooks (useProviderAiState, useGroupComposer, usePtyOutputStream, useSessionBoot, useWorkspaceFocus)
│   └── state/            # workspace.ts + splitTree.ts: tab groups + binary split layout
├── src-tauri/            # Rust backend (Tauri)
│   ├── src/              # Backend modules (see below)
│   ├── tests/            # Cargo integration tests (pty_behavior, provider_host_behavior, invoke smoke)
│   ├── Cargo.toml        # Rust deps + invoke-smoke feature + test wiring
│   └── tauri.conf.json   # Window, bundle, updater, security config
├── scripts/              # Node ESM automation (signoff, burn-in, version sync, invoke smoke)
├── config/              # burnin-thresholds*.json (perf gate thresholds)
├── docs/                 # runtime-contracts.md, continuation-handoff.md, ux-dogfood-log-template.md
├── .github/workflows/    # CI, release, promote-release, nightly-burnin
├── artifacts/            # Generated signoff/burn-in reports (gitignored)
├── public/ , index.html  # Static assets (logo png, fonts) + Vite HTML entry
└── package.json          # Frontend deps + the canonical script catalog
```

## Frontend Core Modules (`src/core/`) — pure unless noted

| File | Responsibility |
| --- | --- |
| `terminal.ts` | **THE IPC bridge.** All `invoke`/`listen` wrappers + every shared TS type. Impure (only file allowed to talk to Tauri besides `tauriRuntime.ts`). |
| `tauriRuntime.ts` | `isTauri()` environment guard. |
| `providers.ts` | `PROVIDER_REGISTRY` (openai/anthropic/ollama/custom-openai), `ProviderDescriptor`/`ProviderSettings` types. All disabled by default. |
| `providerUiState.ts` | Provider/AI UI state derivation (`isExecutableProvider`, allowlist gating). |
| `plugins.ts` | `PLUGIN_REGISTRY` + capability declaration checks. |
| `runtime.ts` | `RuntimeCapabilities` shape + defaults. |
| `commands.ts` | `APP_COMMANDS` / `DEV_PALETTE_COMMANDS` + `AppCommandId` union (command palette source of truth). |
| `keymap.ts` | `DEFAULT_KEYMAP`, shortcut matching/formatting, pane focus/target shortcut labels. |
| `shellExitCommand.ts` | Detect `exit`/`logout` from composer or terminal line buffer for multi-pane collapse. |
| `shellCandidatesCache.ts` | Cached `detect_shells` for fast new-tab picker. |
| `shellPresets.ts` | Saved shell presets CRUD via `shell_presets_get`/`shell_presets_set`; migrates legacy `localStorage` on first fetch. |
| `broadcastMode.ts` | `off` \| `once` \| `sticky` broadcast helpers + legacy bool migration. |
| `tabGroups.ts` | Tab bar group labels (`pwsh · +2`). |
| `palette.ts` / `palette*.test` | Command palette filtering logic. |
| `ptyOutputCoalesce.ts` | Output **sequencing** (duplicate/gap/resync) + byte-budget chunk draining. Critical hot-path helper. |
| `sessionLifecycle.ts`, `sessionExitSummary.ts`, `sessionTabStatus.ts` | Exit-info derivation, overlay summary, tab status dots, exited-session collection. |
| `sessionCwd.ts` | Live cwd map from OSC 7 + restart-cwd resolution. |
| `sessionRestore.ts` | Cold-restart respawn helpers: `spawnProfileForRestorableTab` (shell/cwd/**args**), metadata remap, chat-key ensure. |
| `workspaceFocus.ts` | `FOCUS_ACTIVE_TERMINAL_EVENT` + `requestFocusActiveTerminal()` — routes keyboard focus to the focused pane's xterm after tab/pane switch (Commander). |
| `runLedger.ts` | Per-session command "run" records (ops rail), pin serialization. |
| `terminalCommandRouting.ts`, `terminalUiIntent.ts`, `terminalUiRequest.ts`, `uiSurfaceState.ts` | Map palette commands → focused-pane terminal UI intents (find/scroll/follow), with per-session UI surface state. |
| `terminalLinkActivation.ts`, `terminalLinkRanges.ts`, `linkSafety.smoke.test.ts` | Link extraction + **activation safety** (allow http/https + safe file; reject unsafe schemes/remote hosts). `bufferLineIndexFromProviderLine` / `xtermBufferRangeForScrapedSpan` map scraped spans to xterm's 1-based `provideLinks` coordinates. |
| `terminalPasteGuard.ts` | Risky multiline paste detection + safe-paste confirmation contract. |
| `terminalFindStatus.ts`, `paletteFind.smoke.test.ts` | Find bar match counter / find intent flow. |
| `composerCompletion.ts`, `composerHistory.ts`, `composerOutputScroll.ts`, `composerInput.smoke.test.ts` | Composer completion cycling, history browsing/prediction, output scroll paging. |
| `inputMode.ts` | Session input posture (`operator` / `console` / `ai`), Ctrl+` cycle chord, AI-mode submit routing (`?` prefix). |
| `machShellSnippets.ts` | Copy-paste OSC 7 / OSC 133 shell rc snippets. |
| `onboarding.ts` | First-run flow state helpers. |
| `shellProfiles.ts` | Pure helpers for the shell picker: command preview, args line parse/serialize, candidate↔selection matching, optgroup grouping of `ShellCandidate`s. |
| `statusStripGlyphs.ts`, `statusStripGlyphAssets.ts`, `statusStripSettings.ts` | Status strip glyph rendering + settings. |
| `shellIntegrationSettings.ts`, `terminalUiFont.ts` | Shell-integration prefs, font helpers. |

> Convention: any `*.test.ts` sits next to its source; `*.smoke.test.ts` are auto-discovered by `test:ux:smoke`.

## Frontend Components (`src/components/`)

| Component | Responsibility |
| --- | --- |
| `SplitWorkspace.tsx` | Thin wrapper over `PaneLayout`; exports `sessionIdForPane()`. |
| `PaneLayout.tsx` | Recursive binary split tree renderer; resize handles; per-pane `TerminalSurface`. |
| `SplitResizeHandle.tsx` | Draggable split ratio control (double-click resets 0.5). |
| `GroupComposer.tsx` | Unified per-tab-group composer (Operator mode): pills, broadcast toggle (click=once, Shift+click=sticky), shared input. |
| `TerminalSurface.tsx` | Mounts xterm + fit/search addons; per-pane composer (Commander / legacy); context menu, safe-paste guard, BEL flash, find bar, exit overlay, completion/prediction UI, assist metrics. |
| `TabBar.tsx` | Session tabs, status dots, inline restart/close. |
| `CommandPalette.tsx` | `Ctrl/Cmd+K` palette over `APP_COMMANDS`. |
| `AppSettingsModal.tsx` | Settings hub: terminal profile, providers, routing, AI, shell integration, metrics, plugin demo, shortcuts. |
| `FirstRunSetup.tsx` | Onboarding incl. "Quick start (AI off)". Owns `ONBOARDING_STORAGE_KEY`. Uses `ShellProfilePicker` for shell selection. |
| `ShellProfilePicker.tsx` | Shell selection control: detected-shell dropdown (native shells, WSL distros, POSIX login shells via `detect_shells`), live "will run" preview, Advanced custom shell + args editor. Controlled on `shell`/`args`. |
| `TerminalProfileSection.tsx` | Self-contained "Terminal profile" Settings section: `ShellProfilePicker` + cwd + font size; loads on open, saves via `profile_patch`, calls `onProfileSaved`. |
| `ShellIntegrationSection.tsx` | Capability-driven shell hook install/remove/backup/restore UI. |
| `AiInsightPanel.tsx` | Renders AI explain/fix/freeform output + in-flight state. |
| `OpsRail.tsx` | Side rail of command "runs" (run ledger) with filter/pin/jump + per-entry explain/fix. |
| `HistoryPanel.tsx` | Command history search/replay + AI actions. |
| `MachStatusStrip.tsx`, `StatusStripGlyph.tsx`, `StatusStripSettingsSection.tsx` | Status strip (cwd, elevation, OSC 133 hint) + glyph + settings. |
| `CustomTitleBar.tsx` | Custom window chrome (decorations off) + Settings/Diagnostics entry. |

## Frontend Hooks (`src/hooks/`)

| Hook | Responsibility |
| --- | --- |
| `useProviderAiState.ts` | Provider routing, API keys, AI execute/explain/fix, opt-in gating. |
| `useGroupComposer.ts` | Per-tab-group composer state: submit routing, broadcast, completion integration. |
| `usePtyOutputStream.ts` | Channel subscribe + RAF coalesce flush; owns `pendingOutputRef` / `lastSequenceRef`. |
| `useSessionBoot.ts` | `loadCapabilities` boot path: capabilities, restore/respawn tabs, provider init. |
| `useWorkspaceFocus.ts` | After tab/pane focus change, focuses group composer (Operator) or dispatches terminal focus event (Commander). |

## Backend Modules (`src-tauri/src/`)

| Module | Responsibility |
| --- | --- |
| `main.rs` | Thin binary entry → `mach_terminal_lib::run()`. |
| `lib.rs` | **Command registry** (`generate_handler![]`), all `#[tauri::command]` fns, app builder, managed state (`SessionManager`, `PluginHost`, `AiRuntime`), exit cleanup. |
| `models.rs` | All serde DTOs shared over IPC + `SETTINGS_SCHEMA_VERSION`, legacy settings shape. **Source of truth that `terminal.ts` types mirror.** |
| `session_manager.rs` | PTY spawn/write/resize/close, reader threads, output chunking+sequencing, lifecycle/cwd/marker events, history hydration, runtime counters. The core. |
| `terminal_core.rs` | Runtime `capabilities()` source. |
| `settings.rs` | `settings.json` load/save (atomic + retry), schema migration, profile/provider/routing/shell-integration/**shell-presets** getters/setters, validation (provider id allowlist, endpoint scheme). |
| `child_env.rs` | `build_child_environment()` for PTY spawn; Windows delegates PATH refresh to `win_env`. |
| `win_env.rs` | Windows-only registry PATH merge + `%VAR%` expansion (`#[cfg(windows)]`). |
| `provider_host.rs` | Provider descriptors + AI request execution adapters (openai/anthropic/ollama/custom); tuned reqwest client. |
| `provider_secrets.rs` | API key storage in OS keychain (set/clear/has). |
| `history_store.rs` | `command_history.json` persistence, corruption recovery/backup, history-dir override (`MACH_TERMINAL_HISTORY_DIR`). |
| `workspace_store.rs` | `workspace_layout.json` load/save + schema. |
| `composer_completion.rs` | Backend completion: cwd-aware path completion + PATH/builtin command-name completion with cached index. |
| `osc7.rs` / `osc133.rs` | Incremental OSC escape parsers for cwd / command markers. |
| `shell_integration.rs` | Cross-shell (pwsh/bash/zsh) hook install/remove/status/backup/restore via strategy-map dispatch. |
| `shell_detect.rs` | `detect_shells()` host probe for the profile picker: Windows native shells (pwsh/Windows PowerShell/cmd/Git Bash) + WSL distro enumeration (`wsl.exe -l -q`, UTF-16LE parse), POSIX `$SHELL` + `/etc/shells`. Also `find_on_path` (used by `default_shell` fallback). Pure parsers are unit-tested. |
| `shell_context.rs` | `shell_context_snapshot` (elevation, git branch/short-stat). |
| `plugin_host.rs` | Capability allowlist, reason-coded policy decisions, execution, grants + metrics snapshots. |
| `input_sanitize.rs` | Input sanitization helpers. |
| `telemetry.rs` | `tracing` + OTLP init/shutdown. |

## Where To Find Key Things

- **Add/modify a backend command:** implement in the owning module → add `#[tauri::command]` wrapper in `lib.rs` → register in `generate_handler![]` → add a typed wrapper + types in `src/core/terminal.ts` → use from `App.tsx`/hooks. (See `03_RULES_AND_STANDARDS.md` for the full checklist.)
- **Routing / command palette:** `src/core/commands.ts` (definitions) + `src/core/keymap.ts` (shortcuts) + `App.executeCommand()` (dispatch) + `terminalCommandRouting.ts` (terminal-scoped intents).
- **State management:** top-level state is `useState` in `App.tsx`; layout state via pure reducers in `src/state/workspace.ts`; provider/AI state isolated in `src/hooks/useProviderAiState.ts`; PTY output stream, session boot, and workspace focus routing live in dedicated hooks (`usePtyOutputStream`, `useSessionBoot`, `useWorkspaceFocus`). Persisted state lives in the backend stores (`settings.rs`, `history_store.rs`, `workspace_store.rs`).
- **Config files:** `tauri.conf.json` (window/bundle/updater), `vite.config.ts`, `tsconfig*.json`, `config/burnin-thresholds*.json`, `package.json` scripts.
- **Shared type contracts:** `src-tauri/src/models.rs` ↔ `src/core/terminal.ts` (keep in lockstep).
