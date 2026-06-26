# 01 · Architecture

## Tech Stack

### Frontend (`src/`)
- **React 19** + **TypeScript ~5.8** + **Vite 7** (`type: module`, dev server on port `1420`).
- **xterm.js** (`@xterm/xterm` v6) for terminal rendering, with `@xterm/addon-fit` (sizing) and `@xterm/addon-search` (find).
- **Tauri JS API** (`@tauri-apps/api`) for `invoke`/`listen`; plugins `@tauri-apps/plugin-opener` (open links/files) and `@tauri-apps/plugin-updater`.
- **No state library / no router.** State is React hooks in `App.tsx` + pure reducer-style helpers in `src/core/` and `src/state/`. No CSS framework — hand-rolled CSS in `src/App.css`.
- **Testing:** Vitest 4.

### Backend (`src-tauri/`)
- **Rust** (edition 2021), crate `mach_terminal_lib`, on **Tauri v2**.
- **`portable-pty` 0.8** — cross-platform PTY backend (ConPTY on Windows, openpty elsewhere).
- **`reqwest` 0.12** (rustls-tls, no default features) — provider HTTP calls.
- **`keyring` 3** — OS credential store for provider API keys (never written to settings files).
- **`serde`/`serde_json`** — settings + IPC serialization.
- **`tokio`** — async runtime for `ai_execute`.
- **`tracing` + `tracing-subscriber` + `tracing-opentelemetry` + `opentelemetry-otlp`** — structured JSON logs and optional OTLP traces.
- **`dirs`** — config-dir resolution.

### Tooling / Scripts (`scripts/*.mjs`)
- Node ESM scripts for version-sync checks, stability signoff, nightly burn-in, threshold gates, invoke smoke, release dry-run, dev-with-cleanup.

## System Design Patterns

- **Two-process desktop architecture (Tauri):** privileged Rust core ("backend") + sandboxed webview UI ("frontend"). The OS boundary (spawning shells, filesystem, network, keychain) lives **only** in Rust.
- **Command/Event (CQRS-ish) IPC:**
  - **Commands** = request/response via `#[tauri::command]` (Rust) ↔ `invoke()` (TS). Registered in `src-tauri/src/lib.rs` `generate_handler![...]`.
  - **Events** = backend→frontend push streams via `app.emit()` (Rust) ↔ `listen()` (TS): `pty-lifecycle`, `pty-cwd-changed`, `pty-command-marker`, `ai-context`.
  - **Channel** = the high-throughput hot path: `pty-output` is streamed as raw bytes over a single long-lived `tauri::ipc::Channel<Response>` (registered once via `pty_subscribe_output`), NOT the event system (which JSON-serializes and isn't built for streaming).
- **Single bridge module:** `src/core/terminal.ts` is the only place that calls `invoke`/`listen`. It defines every shared TS type mirroring Rust `models.rs`. Components never call `invoke` directly.
- **Pure-core / impure-shell separation (frontend):** `src/core/*` and `src/state/*` are pure, unit-testable functions (sequencing, link safety, paste guards, workspace reducers, completion/history state machines). `App.tsx` and `src/components/*` wire those pure helpers to React effects and the IPC bridge.
- **Capability registry pattern:** providers (`src/core/providers.ts`), plugins (`src/core/plugins.ts`), and runtime capabilities (`src/core/runtime.ts`) are declared as typed registries; backend validates against allowlists (`KNOWN_PROVIDER_IDS` in `settings.rs`, capability allowlists in `plugin_host.rs`).
- **Policy + telemetry gate (plugins):** plugin execution is gated by reason-coded `PluginPolicyDecision` and recorded in `PluginMetricsSnapshot`.
- **Strategy-map dispatch (shell integration):** install/remove/backup/restore normalize shell kind (`powershell`→`pwsh`) and dispatch via a shared strategy map rather than per-op branching (`shell_integration.rs`).

## Data Flow

### 1. Terminal I/O (the hot path)
```
Operator mode (group composer active):
User keystroke → GroupComposer textarea (below pane stack)
  → useGroupComposer.submitComposer() → target pane session(s)
  → App.handleInput() → ptyWrite() → invoke "pty_write" → PTY

Commander mode (focused leaf):
User keystroke → xterm stdin (TerminalSurface, showComposer=false on other Operator panes)
  → App.handleInput() → ptyWrite() → PTY

shell stdout → PTY reader thread (session_manager.rs)
  → streaming UTF-8 decode (decode_utf8_streaming): carries an incomplete trailing
    multibyte sequence across read() boundaries so split codepoints are NOT mangled
    into U+FFFD (raw bytes still feed OSC 7/133 parsers untouched)
  → chunked (MAX_CHUNK=2048)
  → streamed over a single long-lived Tauri Channel<Response> (raw bytes, NOT the
    JSON event system) registered once via `pty_subscribe_output`; frame is
    [u16 LE id_len][session_id][chunk utf8]
  → onPtyOutput() in usePtyOutputStream (bridge parses the frame + synthesizes a per-session
    monotonic `sequence`, so downstream still sees {session_id, data, sequence})
  → sequence validation (ptyOutputCoalesce.ts: duplicate/gap/resync)
  → buffered in pendingOutputRef, flushed per requestAnimationFrame
     with a per-frame byte budget (MAX_PTY_FLUSH_BYTES_PER_FRAME=48k)
  → sessionBufferStore (ref-backed, outside React) → useSessionBuffer(sessionId)
     in TerminalSurface → xterm.write() delta per pane (App does not re-render on output)
     (xterm renders via the WebGL addon (`@xterm/addon-webgl`); on GPU
      context-loss/init failure it disposes the addon and falls back to the
      DOM renderer transparently)
```
- **Backpressure & pacing:** output is coalesced and RAF-batched on the frontend; per-session scrollback buffer is bounded to `MAX_SESSION_BUFFER` (120k UTF-16 units). Backend caps pending chunks (`MAX_PENDING_CHUNKS=64`) and tracks drops in `RuntimeCounters`.
- **Resize** is throttled (`RESIZE_THROTTLE_MS=100`) before `pty_resize`.

### 2. Session lifecycle
```
spawn: profileGet() → ptySpawn({profile}) → SessionManager.spawn_session()
  → `child_env::build_child_environment()` merges process env; on Windows overrides `PATH` from registry (TER-22) before `profile.env` overlay
  → portable_pty spawns shell, starts reader thread → returns PtySessionInfo
status transitions: running | stopped | closed | error
  → emit "pty-lifecycle" {status, message, exit_code?}
  → App deriveExitedInfo() → exit overlay + tab status dot
restart: snapshot live cwd → closeSession → createSessionAt(cwd) (same pane)
exit cleanup: RunEvent::Exit → SessionManager.close_all()
```

### 3. Shell context side-channels (OSC escape parsing in reader thread)
- **OSC 7** (`osc7.rs`): shell emits `file://host/path` each prompt → decoded → `pty-cwd-changed` → live cwd map (`sessionCwd.ts`) → restart lands in last cwd. Strictly opt-in (requires user rc hook).
- **OSC 133** (`osc133.rs`): command-boundary markers → `pty-command-marker` → status-strip hint. Opt-in.

### 4. AI request flow (optional, gated)
```
gate: routing.ai_feature_enabled && isExecutableProvider(default_provider) && AI opt-in
  → useProviderAiState.runAiPrompt/explainCommand/fixCommand
  → buildAiPromptContext() (cwd, shell, trimmed scrollback ≤6000 chars)
  → aiExecute() → invoke "ai_execute" (async)
  → provider_host.execute_ai_request(reqwest client, settings, request)
  → adapter for openai | anthropic | ollama | custom-openai
  → AiExecuteResponse → AiInsightPanel
```
- API keys resolved from **OS keychain** (`provider_secrets.rs`) or env hint; **never persisted in `settings.json`**.
- Stale-response supersession guard lives in `useProviderAiState.ts`.

### 5. Persistence (Tauri app config dir, alongside `settings.json`)
- `settings.json` — profile, providers, routing, shell-integration prefs, **shell presets** (`shell_presets[]`, TER-10) (atomic writes with retry on `PermissionDenied`/`NotFound`; schema-versioned with legacy migration; `settings.rs`).
- `command_history.json` — bounded history (`MAX_HISTORY=3000`); corrupt file → renamed `command_history.corrupt-<ts>.json` + one-time recovery toast (`history_store.rs`).
- `workspace_layout.json` — **v2** binary split tree per tab group (`SplitNodeSnapshot`), `targetPaneId`, `broadcastMode`, plus legacy flat `panes[]` mirror for active group; debounced writes; migrates v1 flat groups via `flatPanesToTree` (`workspace_store.rs`, `workspace.ts`).
- API keys — OS keychain only.
- `localStorage` (frontend) — onboarding flag, ops-rail collapsed/pins UI prefs only.

## External Dependencies & Third-Party APIs

- **AI providers (optional, BYO):** OpenAI (`/v1/chat/completions`), Anthropic (`/v1/messages`), Ollama (`/api/generate`, default `http://127.0.0.1:11434`), custom OpenAI-compatible endpoint. Adapters in `provider_host.rs`. Endpoints validated to `http`/`https` only.
- **Tauri updater:** checks `https://github.com/whobs/mach-terminal/releases/latest/download/latest.json`. **Disabled by default** (`tauri.conf.json` `updater.active=false`; gated by `VITE_ENABLE_UPDATER` build flag).
- **OpenTelemetry OTLP:** optional traces when `OTEL_EXPORTER_OTLP_ENDPOINT` is set.
- **OS keychain:** via `keyring` crate (Credential Manager / Keychain / Secret Service).
- **CI/CD:** GitHub Actions (`.github/workflows/`): `ci.yml`, `release.yml`, `promote-release.yml`, `nightly-burnin.yml`.

## Boundary / Trust Notes
- Webview CSP is `null` in `tauri.conf.json` — frontend is trusted local content; the security boundary is the Rust command surface, which validates all inputs (provider ids, endpoint schemes, plugin capabilities, link/paste safety also enforced frontend-side in `src/core/linkSafety`/`terminalPasteGuard`).
- Window is `decorations: false` → custom title bar (`CustomTitleBar.tsx`).
