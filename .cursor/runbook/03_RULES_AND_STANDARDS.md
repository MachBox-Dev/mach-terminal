# 03 · Rules & Standards

## Prime Directive

The terminal must stay fast, reliable, and **fully functional with AI disabled**. AI/provider code is optional and must never become a load-bearing dependency of core terminal behavior. If a change couples the core to a provider, it's wrong.

## Coding Conventions

### TypeScript / React
- **Strict TS** (`tsc --noEmit` is a gate). No `any` smuggling; prefer explicit interfaces mirroring backend DTOs.
- **Naming:** `camelCase` functions/vars, `PascalCase` components/types, `SCREAMING_SNAKE` module-level constants (e.g. `MAX_SESSION_BUFFER`, `DEFAULT_KEYMAP`).
- **Wire types are `snake_case`** to match Rust serde DTOs (e.g. `session_id`, `font_size`, `exit_code`). Do not "fix" these to camelCase — they're the serialization contract. (Some newer payloads use camelCase, e.g. plugin/shell-integration types; match whatever the Rust side serializes — check `models.rs`.)
- **Purity discipline:** put logic in `src/core/*` or `src/state/*` as pure functions; keep React effects/IPC in `App.tsx`/components. New non-trivial logic should be a pure helper with a colocated test.
- **IPC isolation:** only `src/core/terminal.ts` (and `tauriRuntime.ts`) may import from `@tauri-apps/api`. Everything else goes through the bridge wrappers.
- **Comments:** explain *why* / non-obvious constraints only (this codebase has dense, intent-rich comments on hot paths — preserve them). Don't narrate the obvious.
- **Expensive singletons must mount once.** Effects that construct heavyweight, stateful objects (the `xterm` instance in `TerminalSurface.tsx`) MUST run with `[]` deps and reach the latest callbacks/props through refs updated during render. Never list a `useCallback`/inline-handler in such an effect's dep array — parents pass fresh handler identities every render, so the object would be disposed and recreated on a render loop. (This was the root cause of the "shell constantly restarting/refreshing" bug originally misattributed to WebKitGTK on WSLg.) Also: state setters fed by high-frequency UI signals (scroll/follow-output) should return the *same* reference when the value is unchanged to avoid needless re-render churn.

### Rust
- Edition 2021. Each `#[tauri::command]` is `#[instrument]`-traced (skip large/sensitive args with `skip(...)`).
- **Commands return `Result<T, String>`** — errors are user-facing strings surfaced in the UI. Validate inputs at the command boundary.
- Shared mutable state uses `Arc<Mutex<...>>`; lock errors are mapped to descriptive `String`s, never `unwrap()` on locks in command paths.
- Keep DTOs in `models.rs`; derive `Serialize`/`Deserialize`. Any new field crossing IPC must be mirrored in `src/core/terminal.ts`.

## The Cross-Boundary Change Checklist (do all of these together)

Adding/altering a backend command or event:
1. Implement logic in the owning module (`session_manager.rs`, `settings.rs`, etc.).
2. Add `#[tauri::command]` wrapper in `lib.rs`.
3. Register it in `generate_handler![...]` in `lib.rs`.
4. Add/extend the DTO in `models.rs`.
5. Mirror the type + add an `invoke`/`listen` wrapper in `src/core/terminal.ts`.
6. Consume from `App.tsx` / a hook / a component.
7. Add tests on both sides (Rust unit/integration + TS unit/smoke).
8. If it changes a wire contract, update `docs/runtime-contracts.md`.

> Forgetting step 3 (registry) or step 5 (bridge) is the classic silent breakage.

## Error Handling Protocol (fail gracefully, always)

- **Backend:** return `Result<_, String>` with actionable messages. Validate provider ids against `KNOWN_PROVIDER_IDS`, endpoints to `http`/`https` only, plugin capabilities against the allowlist.
- **Frontend:** wrap every `invoke` call site in `try/catch`; route messages to `setRuntimeError` (persistent strip w/ "Open settings") or `setTransientRuntimeError` (auto-dismiss toast ~4.2s).
- **Convergent teardown:** treat "session does not exist" on close as success and run local cleanup anyway (backend may have already reaped it after natural exit). See `App.closeSession`.
- **Corruption recovery, not crashes:** corrupt `command_history.json`/`settings.json` are renamed to timestamped backups and the app continues with a one-time recovery toast — never silently reset, never hard-fail startup.
- **Output stream anomalies:** `ptyOutputCoalesce` classifies `duplicate` (drop), `gap` (surface runtime error), `resync` (debug log). Don't bypass this — late bytes must not resurrect a dead session.
- **AI failures:** must be non-fatal and clearly messaged; stale responses are discarded via the supersession guard in `useProviderAiState.ts`.

## State Management Rules

- **No global store.** Source of truth = `App.tsx` `useState` + backend persistence. Don't introduce Redux/Zustand without a strong reason; prefer pure reducer helpers.
- **Per-session keyed maps** (`Record<sessionId, ...>`) for buffers/status/cwd/exit/UI-surface/osc133 — and they must be **pruned when sessions die** (see the `useEffect` on `[sessions]` in `App.tsx`). Add new per-session maps to that prune logic.
- **Layout** mutates only through `src/state/workspace.ts` pure functions (`splitActivePane`, `closePane`, `setPaneSession`, `reconcileWorkspace`, etc.); never mutate pane arrays inline.
- **Persistence is debounced/atomic**, not write-on-every-keystroke (workspace `~320ms` debounce; settings atomic-write-rename with retry).
- **Restored sessions are reconciled** against live backend sessions on load (ghost ids dropped; PTYs are not resurrected).

## Testing Requirements

- **Full gate:** `npm run test` = `test:types` (tsc) + `test:ux` (vitest) + `test:pty` (`cargo test`).
- **Smoke subset:** `npm run test:ux:smoke` (auto-discovers `*.smoke.test.ts`).
- **Invoke transport:** `npm run test:invoke:smoke` / `:strict`. On Unix, full transport via `cargo test ... --features invoke-smoke --test shell_integration_invoke_smoke`.
- **Rust:** unit tests inline + integration tests in `src-tauri/tests/` (`pty_behavior.rs`, `provider_host_behavior.rs`). Override history dir with `MACH_TERMINAL_HISTORY_DIR` in tests.
- **Bias toward pure helpers + colocated tests.** When you add behavior, prefer extracting a pure function and testing it deterministically over testing through React.
- **Security baseline:** `npm run security:baseline` (= `npm audit --omit=dev --audit-level=high` + `cargo audit --deny warnings`).
- **Stability signoff:** `npm run stability:signoff` → `artifacts/stability-signoff/stability-signoff-report.json` (`ga_cutline.ga_candidate_ready`).

## Deployment Pipeline (CI/CD)

- **`ci.yml`** (every push/PR): matrix build/test on `ubuntu-22.04` includes release smoke (debug deb) after tests on a warmed runner; stability signoff on PR/`main`/`master`; security baseline.
- **`release.yml`** (tag push): preflight gates that BLOCK publishing — `check:versions`, `test`, `stability:signoff`, `release:smoke`, `security:baseline` — then build/sign/checksum/publish. Linux release builds use `--bundles deb` only.
- **`promote-release.yml`**: promotes a draft only if tagged commit has green `CI` + `Release` and the latest `Nightly Burn-In` passed.
- **`nightly-burnin.yml`** (cron): burn-in + threshold gates (`config/burnin-thresholds*.json`).
- **Versions must stay in sync** across `package.json`, `Cargo.toml`, `tauri.conf.json`, `CHANGELOG.md` (`check:versions` enforces).
- **Commit style (per repo + Mike's rule):** `[TICKET] :gitmoji: type(scope): summary`; bullet body with `* :gitmoji: ...`; **no commit trailers**. See `docs/continuation-handoff.md` "Recent Commits".

## Gotchas / Tech Debt / Landmines

- **`.cursor/` is gitignored** (`.gitignore` line `.cursor/`). This runbook lives there and is **not version-controlled by default** — see note in `04_CURRENT_STATE.md`. `.cursorrules` (repo root) IS tracked.
- **Windows ConPTY EOF:** the PTY master must be dropped (`take()`) before joining the reader thread or `read()` may never return EOF. Don't reorder teardown in `session_manager.rs` (`close_session_handle`). Covered by `pty_reader_thread_finishes_after_child_kill`.
- **`tauri/test` (MockRuntime) only on non-Windows.** Enabling the `test` feature on the lib crate breaks Windows lib tests with `STATUS_ENTRYPOINT_NOT_FOUND`. Invoke smoke uses a split Unix-integration / Windows-lib-fallback layout (see `Cargo.toml` + handoff "Shell invoke transport").
- **Composer-first input is intentional:** xterm has `disableStdin=true`. Do not "fix" the viewport to accept stdin — typing belongs in the composer. Focus follows the composer.
- **Debug-only commands:** `runtime_debug_snapshot` and `settings_schema_dump` error unless built with debug assertions. Diagnostics UI only appears in `import.meta.env.DEV`.
- **CSP is `null`** — the trust boundary is the Rust command surface, not the webview. Keep validating at the boundary.
- **Per-session map leaks:** any new `Record<sessionId,...>` you add MUST be added to the prune effect, or you leak state for dead sessions.
- **Keymap vs input fields:** the global keydown handler bails when focus is in `INPUT`/`TEXTAREA`/contentEditable — terminal commands route through focused-pane intents, not raw global shortcuts, when typing. **Exception:** `pane.focus*` / `pane.target*` / split / close / broadcast still work from the group composer field.
- **Multi-pane focus vs target:** `activePaneId` (Focus) and `targetPaneId` (Target) are **independent** in Operator mode. Focus hotkeys (`Ctrl+Alt+N` Win) must not retarget the composer; target hotkeys (`Ctrl+Alt+Shift+N` Win) must not move xterm focus. Composer `exit` closes the **target** pane only. `closePane` syncs both ids to the survivor.
- **OSC 7 / OSC 133 are opt-in:** absence of these events is the expected steady state; never assume cwd/markers are present.
- **API keys never touch settings files** — keychain only. Don't add key fields to `settings.json` DTOs.
- **Architecture is still "feature islands":** provider UX state is duplicated between `FirstRunSetup` and `useProviderAiState`; unifying it is the top backlog item (see `04_CURRENT_STATE.md`).
