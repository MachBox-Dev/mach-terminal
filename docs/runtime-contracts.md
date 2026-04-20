# Mach Terminal Runtime Contracts (Slice 1 Baseline)

This document defines the first stable contract between the frontend shell and Rust runtime.

## Tauri Commands

- `runtime_capabilities() -> RuntimeCapabilities` — `session_persistence` is **true** when split-pane layout is stored under the app config directory (`workspace_layout.json`). It does **not** mean shell processes survive process restart (PTY sessions still get new IDs each launch).
- `profile_get() -> TerminalProfile`
- `profile_set(profile: TerminalProfile) -> TerminalProfile`
- `profile_patch(patch: ProfilePatch) -> TerminalProfile` (`shell`/`cwd` support null to clear values)
- `provider_settings_get() -> ProviderSettings[]`
- `provider_settings_set(providers: ProviderSettings[]) -> ProviderSettings[]`
- `provider_set_enabled(provider_id: string, enabled: bool) -> ProviderSettings[]`
- `provider_endpoint_set(provider_id: string, endpoint: string | null) -> ProviderSettings[]`
- `provider_api_key_set(provider_id: string, api_key: string) -> void`
- `provider_api_key_clear(provider_id: string) -> void`
- `provider_api_key_status(provider_id: string) -> ProviderApiKeyStatus` (`{ provider_id, hasStoredKey }`)
- `provider_list() -> ProviderDescriptor[]`
- `provider_routing_get() -> ProviderRoutingSettings`
- `provider_routing_set(provider_routing: ProviderRoutingSettings) -> ProviderRoutingSettings`
- `provider_routing_patch(patch: ProviderRoutingPatch) -> ProviderRoutingSettings`
- `settings_schema_dump() -> SettingsSchemaDebug` (debug builds only)
- `runtime_debug_snapshot() -> RuntimeDebugSnapshot` (debug builds only) — aggregates `runtime_capabilities`, `runtime_metrics_snapshot`, `pty_list_sessions`, config paths for `settings.json` / `command_history.json`, and `history_recovery_pending` (see below)
- `pty_spawn(request: PtySpawnRequest) -> PtySessionInfo`
- `pty_write(session_id: string, data: string) -> void`
- `pty_resize(session_id: string, cols: number, rows: number) -> void`
- `pty_close(session_id: string) -> void`
- `pty_list_sessions() -> PtySessionInfo[]`
- `history_query(request: HistoryQueryRequest) -> HistoryEntry[]` (loads persisted history on first use)
- `history_recovery_take() -> string | null` — one-shot user-facing message if `command_history.json` was corrupt and reset (otherwise `null`). Until consumed, `runtime_debug_snapshot().history_recovery_pending` is `true` (read-only probe; does not clear the notice).
- `history_replay(session_id: string, command: string) -> void`
- `runtime_metrics_snapshot() -> RuntimeMetricsSnapshot`
- `workspace_layout_get() -> WorkspaceLayout | null` — reads `workspace_layout.json` next to `settings.json`; returns `null` if missing; invalid JSON is backed up as `workspace_layout.corrupt-*.json` and yields `null` so startup can continue
- `workspace_layout_set(layout: WorkspaceLayout) -> void` — full replace, atomic write, normalizes `schemaVersion` to the current supported version on save
- `plugin_grant_capability(request: PluginGrantRequest) -> PluginPolicyDecision`
- `plugin_execute(request: PluginExecuteRequest) -> PluginExecutionResult`
- `plugin_metrics_snapshot() -> PluginMetricsSnapshot`
- `plugin_grants_snapshot() -> PluginGrantSnapshot[]`
- `ai_execute(request: AiExecuteRequest) -> AiExecuteResponse`

## Settings persistence contract

- `settings.json` now carries a `schema_version` field.
- Legacy files without `schema_version` are treated as v0 and migrated in-place to the current schema on first load.
- Corrupt JSON still triggers backup recovery semantics (`settings.corrupt-*.json`) and surfaces an explicit error.
- `settings_schema_dump` is the quickest smoke-check helper for migrations; it reports file path, schema read from disk, loaded schema, and whether migration from legacy format occurred.

## Workspace layout persistence contract

- File: `workspace_layout.json` in the Tauri app config directory (same parent as `settings.json`).
- Top-level `schemaVersion` (currently `1`) plus pane tree fields aligned with the UI snapshot: `rootPaneId`, `panes[]` (`id`, `sessionId`), `activePaneId`, `splitDirection` (`row` | `column`).
- On first launch after upgrade, the shell may **one-time migrate** legacy browser `localStorage` (`mach-terminal.workspace.v1`) into this file and remove the key to avoid split-brain.
- Restored `sessionId` values that no longer exist after relaunch are cleared by the same frontend reconciliation rules as before (ghost session IDs).

## Runtime Events

- `pty-output`
  - payload: `{ session_id: string, data: string, sequence: number }`
  - emitted whenever PTY output chunk arrives
- `pty-lifecycle`
  - payload: `{ session_id: string, status: "running" | "stopped" | "closed" | "error", message?: string, timestamp_ms: number, exit_code?: number }`
  - `exit_code` is populated only for the EOF-driven `stopped` transition. The reader thread wraps the spawned child in an `Arc<Mutex<Box<dyn Child + Send>>>` shared with the emit loop and calls `wait()` on the already-dead process on `Ok(0)` from the PTY reader; `portable_pty::ExitStatus::exit_code()` returns a `u32` which is downcast to `i32` for the wire. `running`, user-initiated `closed` (the child is killed before we can observe a code), and `error` (reader I/O failure) paths all omit the field — the Rust `Option<i32>` serializes with `skip_serializing_if = "Option::is_none"` so older consumers see no schema break. Unix signal deaths manifest as the shell convention `128 + signal_number` via portable_pty; a dedicated `signal` channel is intentionally out of scope for this tranche.
  - emitted on spawn, shutdown, close, and read failures
- `pty-cwd-changed`
  - payload: `{ session_id: string, cwd: string, timestamp_ms: number }`
  - Side-channel telemetry for the live shell working directory. Emitted by the Rust reader thread (`session_manager::spawn_session`) whenever the raw PTY byte stream contains an `OSC 7` sequence (`ESC ] 7 ; file://<host>/<path> <BEL|ESC\\>`) whose decoded absolute path differs from the value cached on `SessionHandle.cwd`. The shared `Arc<Mutex<Option<String>>>` is updated before the emit so a concurrent `pty_sessions_list` snapshot reports the new cwd atomically. Lifecycle status is never touched — this is purely a "where is the shell right now" feed, so consumers missing the event simply miss the restart optimization.
  - The source of truth is the shell itself: bash / zsh / fish / PowerShell all ship with a short one-liner that emits OSC 7 on every prompt (see the Shell integration section in the README). Unconfigured shells never emit, the map stays empty, and `restartSessionById` falls back to the spawn-time `profile.cwd` — i.e. this is a strict enhancement with no behavior change for users who opt out.
  - Percent-decoding and `file://` scheme handling live in [`src-tauri/src/osc7.rs`](../src-tauri/src/osc7.rs) (`Osc7Parser::feed`), which buffers partial sequences that span two `reader.read()` chunks, hard-caps its pending buffer at 4 KiB to neutralize a wedged stream, and normalizes Windows paths (`file:///C:/Users/mike` -> `C:\\Users\\mike`) under `#[cfg(target_os = "windows")]`.
- `ai-context`
  - payload: `{ session_id: string, event_type: "command_submitted" | "output_chunk", payload: string, sequence: number, timestamp_ms: number, source: "input" | "pty" | "system" }`
  - emitted for future AI context pipelines

## PTY output coalescing (UI)

- The shell batches `pty-output` chunks per session using `requestAnimationFrame`: pending strings are drained in slices so a single frame does not apply unbounded UTF-16 units to xterm (see `MAX_PTY_FLUSH_BYTES_PER_FRAME` in the app shell).
- **Sequence policy (per `session_id`):** first observed chunk always establishes the baseline; `sequence === previous + 1` is normal. Forward gaps of at most **100** skipped numbers are treated as a **silent resync** (baseline jumps to the new `sequence`; in Vite dev builds a `console.debug` line is emitted). **User-visible** `runtimeError` toasts are reserved for rewinds/duplicates (`sequence <= previous`) or jumps larger than that window—these should be rare if the runtime emitter stays monotonic.
- **`pty-lifecycle`:** on `running`, or when a session reaches a terminal state (`stopped` / `closed` / `error`), the UI clears pending coalesced chunks and the sequence baseline for that `session_id` so a later lifecycle cannot reuse stale state.
- Rust-side `sequence_anomalies` in `RuntimeMetricsSnapshot` still counts gaps detected in the PTY reader thread; UI resync policy is independent and reduces false-positive UX when the stream is healthy but numbering skipped.

## Frontend terminal (xterm.js)

- **Font size:** The UI reads `TerminalProfile.font_size` via `profile_get` on startup, after first-run setup save, and when spawning a session; that value is passed into the xterm surface (clamped in the client for sanity) and applied with `fitAddon.fit()` when it changes.
- **Active pane focus:** When a pane becomes the workspace active pane, the embedded terminal requests focus on the next animation frame so typing reaches the shell without an extra click when the shell already owns focus semantics for that pane.
- **Clipboard:** `Ctrl+Shift+C` / `Cmd+Shift+C` copies the current xterm selection to the system clipboard when non-empty; `Ctrl+Shift+V` / `Cmd+Shift+V` reads plain text from the clipboard and routes it through the safe-paste guard before writing to the PTY (no session → no write). Clipboard failures are ignored (no extra toast spam).
- **Safe paste guard:** Both keyboard paste (`Ctrl/Cmd+Shift+V`) and context-menu **Paste** go through a single entrypoint that calls `decidePasteAction` in [`src/core/terminalPasteGuard.ts`](../src/core/terminalPasteGuard.ts), which delegates to `classifyPasteRisk`. Safe payloads (short, single-line, no shell chaining markers `&& || ; |`) are forwarded to the PTY immediately — the fast path is preserved. Risky payloads (multiline, >500 chars, or chain markers) open an inline confirmation card in the terminal panel with **Paste anyway** and **Cancel**; the pending text is held in per-pane state and is discarded on cancel, session change, or pane unmount. **Paste anyway** forwards the exact original text once and closes the card. While the card is visible, xterm's custom key handler yields: pressing **Enter** commits the pending paste, **Escape** cancels, and the primary button is focused on mount. A **Don't ask again this session** checkbox sets a session-scoped bypass flag that routes subsequent pastes through `kind: "send"` until the `activeSession?.id` changes or the pane unmounts (never persisted). The card also renders a truncated, control-character-sanitized preview via `summarizePastePayload` (default cap 120 chars, with a physical line / char count meta row); the preview is advisory only — the original raw text is what gets written to the PTY.
- **Links:** A single xterm `registerLinkProvider` scans each buffer line via [`src/core/terminalLinkRanges.ts`](../src/core/terminalLinkRanges.ts). **HTTP(S):** substrings matching the conservative URL regex are activated with `openUrl` after `isSafeHttpUrlForOpener` (only `http:` / `https:`). **Filesystem:** conservative absolute paths are also linked — Unix paths from a leading `/` (with guards so `./src/foo` and `file:///etc` style spans are skipped, and `//` bodies are rejected), quoted Unix absolute paths with spaces (`"/opt/My App/bin/start.sh"` or `'/var/log/My App/service.log'`), Windows drive-letter paths `C:\…` / `C:/…` via a delimiter-aware scanner that accepts intra-segment spaces (e.g. `C:\Program Files\MyApp\bin\app.exe`, `C:\Users\John Doe\notes.txt`, `C:\Program Files (x86)\…`), and UNC paths (`\\server\share\logs\build.log`, including spaced deeper segments). The Windows/UNC scanners balance parentheses, stop at shell metacharacters and post-path compiler suffixes (so `C:\src\main.ts:42:7` and `/src/main.ts:42:7` link only the path), and treat a single space as intra-path only when a `\` or `/` separator appears before the next stop — so ambiguous bare tail segments with spaces still need quotes for full-span linking. Explicitly quoted Windows paths (`"C:\Program Files\…"`, `'C:\Users\Name\…'`) are picked up as a second pass and the clickable range excludes the quotes. File hits that overlap an HTTP range on the same line are dropped so URL clicks stay authoritative. Activation uses `openPath` from `@tauri-apps/plugin-opener` after `isSafeLocalPathForOpener` (rejects `..`, shell metacharacters, and other junk); opener failures are swallowed client-side to avoid toast spam. **OSC 8 hyperlinks:** xterm's built-in OSC 8 provider is enabled via a terminal-level `linkHandler` (with `allowNonHttpProtocols: true` so `file://` URIs are forwarded to the allowlist instead of being dropped upstream). Activation routes through [`src/core/terminalLinkActivation.ts`](../src/core/terminalLinkActivation.ts), which enforces the same policy as the scraper: `http:` / `https:` open via `openUrl` (gated by `isSafeHttpUrlForOpener`); `file://` is decoded (percent-decoding, drive-letter + backslash normalization, rejection of remote hosts and `..` traversal) and then routed through `openPath` (gated by `isSafeLocalPathForOpener`); all other schemes (`javascript:`, `data:`, `vscode:`, custom protocols) are silent no-ops. Opener failures are swallowed. This is heuristic screen scraping + a thin OSC 8 allowlist — the helper is the single source of truth for terminal link security.
- **Scrollback:** The terminal is constructed with an elevated scrollback line budget (currently 8000) so long transcripts stay inspectable without changing the PTY contract.
- **Visual bell:** ASCII BEL (`\x07`) is handled by subscribing to xterm’s `onBell` and playing a short inset highlight animation on the terminal host (no `bellStyle` constructor option on this `@xterm/xterm` major; behavior is entirely client-side).
- **Find in buffer:** `@xterm/addon-search` is loaded per surface. `Ctrl+Shift+F` / `Cmd+Shift+F` opens find when the pane is active; the command palette **Find in terminal** bumps a monotonic `seq` so the focused pane opens the same find UI without adding a global keybinding. `Enter` / `Shift+Enter` walk matches while find is open; `Escape` closes find and clears search decorations. **Match case**, **Whole word**, and **Regex** toggles project directly onto `ISearchOptions.caseSensitive` / `wholeWord` / `regex` via the pure `buildFindOptions` helper in [`src/core/terminalFindStatus.ts`](../src/core/terminalFindStatus.ts); every find call (keyboard, palette intent, and in-bar buttons) uses the same options bag plus a static `decorations` constant so highlights stay consistent. Because decorations are always enabled, `SearchAddon.onDidChangeResults` fires on every search, driving a live match counter formatted by `formatFindStatus` (`""` empty query, `"no matches"`, `"many matches"` when the addon signals `resultIndex === -1` over the highlight limit, otherwise `"<n> / <total>"`). An incremental effect re-runs `findNext` with `incremental: true` whenever the query or any toggle changes while the bar is open; empty query clears decorations and zeros the counter. Explicit `Prev` / `Next` buttons in the bar reuse `runFindPrevious` / `runFindNext`, so button, keyboard, and palette paths are observationally identical. Palette terminal intents still include `findNext`, `findPrevious`, `clearViewport`, and `toggleFollowOutput` in the same `TerminalUiRequest` channel; unfocused panes advance an internal consumed `seq` for all intents so stale requests do not replay after pane switches, and `findNext` / `findPrevious` are explicit no-ops when the search query is empty.
- **Context menu:** Right-click on the terminal host opens a small menu for Copy (selection), Paste (same no-session guard as keyboard paste), and Select all (`terminal.selectAll()`). The menu position is clamped after layout so it stays inside the viewport. Dismiss with click-away or `Escape`.
- **Scroll follow:** Subscribing to `onScroll` keeps a pin flag when `buffer.active.viewportY >= buffer.active.baseY`. Coalesced PTY `write` paths and full-buffer `reset`+`write` replays call `scrollToBottom()` only if the pin was true **before** the write, so users reading scrollback are not yanked to the bottom. The palette **Scroll terminal to bottom** command issues `kind: "scrollToBottom"`; **Toggle follow output** issues `kind: "toggleFollowOutput"` to flip the pin state and, when re-enabled, jump to the newest output.
- **Clear viewport contract:** `kind: "clearViewport"` is intentionally visual-only and maps to `xterm.clear()` in the surface; it does not mutate PTY/runtime session buffers, so historical output can still be replayed by later session-buffer sync paths.
- **Session exit handling:** When `pty-lifecycle` reports `stopped` / `closed` / `error`, the shell **no longer** removes the session from `sessions[]` or wipes its buffer. `deriveExitedInfo` in [`src/core/sessionLifecycle.ts`](../src/core/sessionLifecycle.ts) projects the event into a `{ status, message, timestampMs, exitCode }` entry keyed by `session_id` in a `sessionExited` map; in-flight output/sequence state is still dropped so late bytes cannot resurrect the dead session. The pane renders a `.terminal-exit-overlay` on top of the final shell output with a pure `formatExitSummary` call from [`src/core/sessionExitSummary.ts`](../src/core/sessionExitSummary.ts) that produces `{ headline, detail, codeLine }`; the overlay shows the headline, an optional `.terminal-exit-code` `"Exited with code <n>"` line when the backend reported one (populated only on the EOF-driven `stopped` path — see `PtyLifecycleEvent` below), the detail paragraph, and two buttons — **Restart** (keyboard: `Enter`) closes the session and spawns a fresh one in the same pane slot, **Close** (keyboard: `Escape`) just tears the session down. While the overlay is visible, `attachCustomKeyEventHandler` yields the same way it does for the paste guard so xterm does not swallow the keys. Palette commands `session.restart` and `session.close` share these exact handlers against the active pane, and both the palette and the overlay ultimately delegate to a single `restartSessionById` helper in [`src/App.tsx`](../src/App.tsx) that resolves the hosting pane via a functional `setWorkspace` read before `closeSession` + `createSession`. [`src/components/TabBar.tsx`](../src/components/TabBar.tsx) mirrors the overlay state per tab: a leading `.tab-dot.status-<variant>` recolors per `SessionStatus` (emerald running / amber pulse starting / slate idle+stopped / sky closed / red error), the tab `title` / `aria-label` uses `buildTabTooltip(status, message, exitCode)` from [`src/core/sessionTabStatus.ts`](../src/core/sessionTabStatus.ts) to surface the exit reason on hover (`"Session <status> (code <n>): <message>"` when both are present, falling back to a click-to-focus hint), exited tabs are now click-selectable so users can navigate into the overlay without routing through the sidebar, and an inline `\u21BB` restart glyph delegates to `restartSessionById` without switching panes first. Two palette commands walk the exited set in tab order using `collectExitedSessionIds`: `sessions.closeAllExited` runs `closeSession` sequentially, `sessions.restartAllExited` runs `restartSessionById` sequentially (pane lookup re-resolves per iteration because React state flushes between awaits). Map entries are cleared either by those actions, by `onPtyLifecycle` when the session returns to `running` (defensive against id reuse), or by the `pruneExitedForSessions` GC effect keyed on `sessions[]` whenever the list contracts. `formatExitSummary` + `buildTabTooltip` are the single source of truth for status phrasing across overlay and tab-bar surfaces. A per-session `sessionCwd` map (see [`src/core/sessionCwd.ts`](../src/core/sessionCwd.ts) — `applyCwdChange` / `clearCwd` / `pruneCwdForSessions` / `getRestartCwd`) is populated from `pty-cwd-changed` and surfaces a secondary `.terminal-exit-cwd` subline on the overlay ("Restart will land in `<path>`") whenever the shell emitted at least one OSC 7 while alive. `restartSessionById` snapshots the map **before** `closeSession` wipes it, then funnels through `createSessionAt(cwdOverride)` which takes the baseline profile and swaps its `cwd` for the override on that one spawn only; profile storage is never mutated. Shells without the OSC 7 hook simply never populate the map and restart falls back to the spawn-time `PtySessionInfo.cwd` (profile default), so the feature is a pure enhancement on top of the pre-existing lifecycle contract.

## Runtime Metrics

- `RuntimeMetricsSnapshot` fields:
  - `output_chunks_emitted`
  - `output_chunks_dropped`
  - `output_bytes_emitted`
  - `emit_failures`
  - `sequence_anomalies`
  - `write_failures`
  - `resize_failures`
  - `close_failures`
  - `active_sessions`
  - `max_chunk_size`

## Provider Host Rules

- Provider descriptors are always available from `provider_list`, even when disabled.
- AI execution is opt-in and controlled by `provider_routing.ai_feature_enabled`.
- Provider execution is blocked unless:
  - `provider_routing.ai_feature_enabled` is true
  - selected provider is explicitly enabled
- Routing writes are validated:
  - `default_provider` must reference a configured provider id
  - `ollama_model` cannot be blank after trimming
  - `openai_model` cannot be blank after trimming
  - `anthropic_model` cannot be blank after trimming
  - `custom_openai_model` cannot be blank after trimming
- Provider endpoint writes are sanity-checked:
  - endpoint is optional (`null`/empty clears)
  - when provided, endpoint must be an absolute `http` or `https` URL
- API key resolution order for cloud/custom providers:
  - secure keychain value via `provider_api_key_set`
  - provider-specific env fallback (`api_key_env`)
  - explicit auth-missing error if neither exists
- Execution adapters:
  - `ollama` via `POST /api/generate` with `stream=false`
  - `openai` + `custom-openai` via OpenAI-compatible `POST /v1/chat/completions`
  - `anthropic` via `POST /v1/messages`
- Standardized AI failure buckets surfaced by backend messages:
  - routing disabled
  - provider not configured
  - provider disabled
  - provider credentials missing
  - secure key storage unavailable
  - invalid endpoint
  - endpoint unreachable
  - upstream error response
  - response decode failure

## Plugin Host Rules

- Deny-by-default for all plugin capabilities.
- `plugin_grant_capability` validates plugin/capability against the runtime allowlist before mutating grants.
- `plugin_execute` returns structured policy outcomes:
  - `policy_allowed`
  - `policy_denied_missing_grant`
  - `invalid_plugin_id`
  - `capability_not_declared`
- `PluginExecutionResult` remains additive with legacy fields (`accepted`, `message`) and now includes:
  - `reason_code`
  - `payload_bytes`
  - optional `decision { accepted, reasonCode, message }`
- `plugin_grants_snapshot` returns effective grants currently held in memory.
- `plugin_metrics_snapshot` exposes telemetry counters:
  - `grantsTotal`
  - `executionAllowedTotal`
  - `executionDeniedTotal`
  - `executionErrorTotal`
  - `executionTotal`
  - `cumulativeExecutionMs`
  - `lastExecutionMs`
  - `grantedPluginCount`

## Cross-Platform PTY Behavior

- Default shell selection:
  - Windows: `pwsh.exe`
  - macOS: `$SHELL` fallback `/bin/zsh`
  - Linux/Unix: `$SHELL` fallback `/bin/bash`
- Resize and I/O are session-scoped and independent for multi-session support.
- PTY output is emitted in bounded chunks to avoid unbounded event payload growth.
- PTY output pipeline tracks dropped chunks and sequence anomalies for burn-in diagnostics.

## Telemetry

- Runtime uses structured tracing output (`tracing`) with optional OTLP export when `OTEL_EXPORTER_OTLP_ENDPOINT` is set.
- For verbose local logs, set `RUST_LOG` (for example `RUST_LOG=mach_terminal_lib=debug,info`). Failure-path counters in the PTY pipeline also emit `warn!` / `debug!` with `session_id` where applicable.
- Burn-in workflows read machine-readable metrics snapshots to enforce regression thresholds.
