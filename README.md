# mach-terminal

A speed-first desktop terminal scaffold with an open extension model. The baseline is terminal performance, session reliability, and local control. AI providers are optional and disabled by default.

## Stack

- Tauri v2 (desktop shell)
- Rust (terminal core boundary and runtime capabilities)
- React + TypeScript + Vite (UI shell)
- xterm.js (`@xterm/xterm` + fit addon) for terminal rendering

## Project Goals

- No cloud lock-in and no account requirement
- Bring your own API keys or run local models
- Capability-scoped plugin surface
- AI is optional and never a dependency for core terminal behavior

## Getting Started

```bash
npm install
npm run tauri dev
```

On first launch, use **Quick start (AI off)** in Settings to get to a working terminal session immediately.  
Advanced provider/routing controls are optional and can be configured later.

## Developer diagnostics

- **Vite dev + debug Tauri:** With `npm run tauri dev`, the header shows **Diagnostics** and the command palette includes **Open diagnostics snapshot** (merged JSON from `runtime_debug_snapshot` and `settings_schema_dump` when the native build has debug assertions).
- **Logs:** JSON logs via `tracing`; narrow noise with `RUST_LOG` (for example `RUST_LOG=mach_terminal_lib=debug,info`).
- **Distributed traces:** Optional OTLP when `OTEL_EXPORTER_OTLP_ENDPOINT` is set (see `docs/runtime-contracts.md`).
- **Tests / CI:** Override history directory with `MACH_TERMINAL_HISTORY_DIR` when exercising persistence (see `src-tauri/src/history_store.rs`).

## Scaffolded Contracts

- `src/core/providers.ts`: provider host registry and statuses (all disabled by default)
- `src/core/plugins.ts`: plugin manifest contracts and capability labels
- `src/core/runtime.ts`: frontend runtime capability types
- `src-tauri/src/terminal_core.rs`: Rust terminal core capability source

Current executable provider path is `ollama`; other providers remain visible as unavailable until adapters land.

## Next Build Steps

1. Add additional provider adapters beyond Ollama (OpenAI/Anthropic/custom OpenAI-compatible)
2. Expand plugin runtime execution contracts and policy telemetry
3. Convert more UX dogfood checks into scripted smoke coverage
4. Harden release promotion automation and signed artifact verification

## UX Dogfood Checklist

Run this checklist before calling a UX slice complete:

Scripted smoke coverage now runs for a focused subset of terminal interaction checks (`test:ux:smoke`): BEL visual flash contract, context-menu open/clamp/paste availability, and safe-paste guard branching. Remaining checklist items below still require manual dogfood verification.

1. Open command palette with `Ctrl/Cmd+K`, navigate with arrow keys, execute with Enter, dismiss with Escape.
2. Split and resize panes rapidly; verify active-pane focus ring and stable terminal resize behavior.
3. Search command history, confirm empty-state messaging, and replay a long command from history.
4. Trigger AI explain/fix from history and verify status feedback appears in the history panel.
5. Use the in-app keyboard shortcut reference and confirm each shortcut triggers the intended action.
6. Switch the active split pane and confirm the terminal accepts keystrokes without clicking inside the pane first (when focus already follows the active pane).
7. Select terminal output, copy with `Ctrl/Cmd+Shift+C`, then paste into the shell with `Ctrl/Cmd+Shift+V` (including a short multiline paste).
8. Print an `https://` URL to the terminal and confirm it opens in the system browser when clicked (only `http`/`https`). Print an absolute path (`echo /etc/hosts` on Unix, or `echo C:\Windows\System32\drivers\etc\hosts` on Windows) and confirm it underlines as a link and opens in the default OS handler when clicked. On Windows, also verify paths with embedded spaces: `echo C:\Program Files` (or a real user path like `echo C:\Users\<Your Name>\Documents\notes.txt`) and a parenthesized location such as `echo C:\Program Files (x86)` should underline as a single link; a quoted path (`echo "C:\Program Files\My App"`) should also link end-to-end with the quotes excluded from the clickable span. Verify UNC support with something like `echo \\server\share\logs\build.log` (or a real reachable share path), and on Unix verify quoted-space paths such as `echo "/opt/My App/bin/start.sh"` also link as one span. Compiler-style `C:\src\main.ts:42:7` and `/src/main.ts:42:7` should link only the path portion. Verify **OSC 8 hyperlinks** by emitting a structured link — bash/zsh: `printf '\e]8;;https://example.com\e\\click me\e]8;;\e\\\n'`, or PowerShell: `"$([char]27)]8;;https://example.com$([char]27)\click me$([char]27)]8;;$([char]27)\"` — and confirm the displayed text ("click me") underlines and opens the URL in the system browser. Then emit an unsafe scheme such as `printf '\e]8;;javascript:alert(1)\e\\payload\e]8;;\e\\\n'` and confirm clicking it is a no-op (no browser open, no alert). On platforms supporting `file://`, try `printf '\e]8;;file:///etc/hosts\e\\hosts\e\\\n'` (Unix) or the Windows equivalent with `file:///C:/Users/...` and confirm the OS file handler opens after the path safety check.
9. Trigger a BEL character (e.g. `printf '\a'` in bash/zsh, or `Write-Host ([char]7)` in PowerShell) and confirm a brief visual flash on the terminal host (independent of OS beep).
10. Open find with `Ctrl/Cmd+Shift+F`, search for a substring in scrollback, and confirm the match counter in the bar updates as you type. Toggle **Whole word** and **Regex**, verify the counter reacts and highlights update. Step forwards/backwards with both `Enter` / `Shift+Enter` and the in-bar `Prev` / `Next` buttons. Clear the query and confirm decorations disappear and the counter empties. Close with Escape.
11. Right-click the terminal: copy a selection, paste from the menu, and use Select all; dismiss the menu by clicking outside or Escape.
12. Open the command palette, run **Find in terminal**, and confirm the find bar opens on the active pane; toggle **Match case** and verify search stepping respects it.
13. Right-click near the bottom-right of the window and confirm the context menu stays fully on-screen after it appears.
14. Scroll the terminal up into history, run sustained output (e.g. `yes` briefly), and confirm the viewport does **not** auto-jump while you are off the bottom; stop the command, run palette **Scroll terminal to bottom**, then confirm new output sticks to the bottom again.
15. In the command palette, run **Find next match**, **Find previous match**, **Clear terminal viewport**, and **Toggle follow output**; verify actions apply only to the focused terminal pane.
16. With two panes visible, keep one pane unfocused and trigger terminal palette commands repeatedly; verify the unfocused pane advances request sequencing but does not execute those actions when focus changes later.
17. Copy a risky multiline payload (e.g. two lines with `rm tmp && ls`) to the clipboard, paste via `Ctrl/Cmd+Shift+V` and via right-click **Paste**; confirm the safe-paste guard appears in both flows with a truncated preview and a line / char count, that **Cancel** (or `Esc`) discards the pending paste with no PTY write, and that **Paste anyway** (or `Enter`) forwards the exact text once with the Paste-anyway button focused on mount. Then tick **Don't ask again this session**, paste another risky payload and verify it skips the card until you switch session. Finally paste a short single-line string and verify it still runs the fast path with no confirmation.
18. Deliberately exit the active shell (`exit` or `Ctrl+D`) and confirm the pane **does not disappear**: the final shell output stays rendered under a centered exit overlay that reads `Session stopped` / `closed` / `error` with the lifecycle message (or `Shell exited.` fallback). Press `Enter` and verify it closes the old session and spawns a fresh one in the same pane slot; exit again, press `Escape`, and verify the session is closed without a replacement. Repeat the flow from the command palette using **Restart active session** and **Close active session** and confirm parity with the overlay buttons.
19. Spawn two sessions, exit each shell, and confirm both tabs keep the session id but now render a leading status dot (sky for `closed`, red for `error`, slate for `stopped`) with an exit tooltip on hover. Click the inline restart glyph on one tab and verify the overlay clears and a fresh shell lands in the same pane without first navigating to it. Click the other exited tab (dead-tab clicks are no longer blocked) to focus its pane so the overlay becomes visible. Then trigger both **Close all exited sessions** and **Restart all exited sessions** from the command palette against a fresh set of exits and verify batch behavior walks tabs left-to-right.
20. Exit a shell with a non-zero status (`bash -c "exit 5"`, `sh -c "exit 127"`, or `cmd /c exit 5`) and confirm the exit overlay shows a dedicated monospaced `Exited with code 5` / `Exited with code 127` line between the `Session stopped` title and the detail paragraph, and that the tab tooltip reads `Session stopped (code 5): shell exited`. Repeat with a clean `exit` (code 0) and verify the overlay still renders `Exited with code 0` and the tooltip still includes `(code 0)`. Finally, close the session via **Close active session** instead of letting it exit naturally and verify the overlay keeps its pre-tranche phrasing with no `.terminal-exit-code` line (the `closed` path intentionally reports no code).
21. Install one of the OSC 7 hooks from the **Shell integration** section below, spawn a fresh session, `cd` into a project directory (e.g. `cd ~/projects/foo` or `cd C:\Users\mike\dev`), then `exit`. Confirm the exit overlay now shows a secondary `Restart will land in <path>` subline under the detail paragraph with the exact cwd you `cd`'d into. Press **Restart**, and confirm the replacement shell boots into that same directory (verify with `pwd` on Unix or `Get-Location` on PowerShell). Then spawn a second session *without* the hook (comment out the PROMPT_COMMAND / precmd / prompt function), `cd` somewhere, exit, and confirm the overlay has **no** `Restart will land in` subline and the restart lands in the profile default cwd exactly like pre-tranche behavior.

Use the reusable execution log template for team handoff and release notes:
- `docs/ux-dogfood-log-template.md`

## Shell integration (OSC 7)

Mach Terminal tracks the live shell working directory via the de-facto `OSC 7` sequence (`ESC ] 7 ; file://<host>/<path> <terminator>`). When the shell emits it on every prompt, the Rust reader thread decodes the path, fires a `pty-cwd-changed` event, and the restart flow lands the replacement shell in the last-known directory instead of snapping back to the profile default. Shells without the hook keep working exactly as before — the feature is a strict opt-in enhancement.

Pick the snippet for your shell and drop it in your rc file. Paths are emitted as `file://<host>/<absolute-path>` with percent-encoded UTF-8:

- **bash** (`~/.bashrc`): append to `PROMPT_COMMAND` so every prompt refresh publishes the current cwd.

  ```bash
  __mach_osc7() { printf '\033]7;file://%s%s\007' "${HOSTNAME}" "${PWD}"; }
  PROMPT_COMMAND="__mach_osc7${PROMPT_COMMAND:+;$PROMPT_COMMAND}"
  ```

- **zsh** (`~/.zshrc`): use the `precmd` hook.

  ```zsh
  __mach_osc7() { printf '\033]7;file://%s%s\007' "${HOST}" "${PWD}"; }
  autoload -Uz add-zsh-hook
  add-zsh-hook precmd __mach_osc7
  ```

- **fish** (`~/.config/fish/config.fish`): wrap the built-in prompt event.

  ```fish
  function __mach_osc7 --on-event fish_prompt
      printf '\033]7;file://%s%s\007' (hostname) "$PWD"
  end
  ```

- **PowerShell** (`$PROFILE`): wrap the `prompt` function so the escape is written on every line draw.

  ```powershell
  $script:__machOriginalPrompt = $function:prompt
  function prompt {
      $path = (Get-Location).ProviderPath
      [Console]::Write("`e]7;file://$([System.Net.Dns]::GetHostName())/$($path -replace '\\','/')`a")
      & $script:__machOriginalPrompt
  }
  ```

After installing, open a fresh Mach session, `cd` somewhere, then `exit` — the exit overlay should surface a `Restart will land in <path>` subline, and pressing **Restart** will boot the new shell in that directory. If nothing shows up, confirm the hook is loaded (`type __mach_osc7` / `Get-Command prompt`) and that your shell isn't stripping escapes before they hit stdout.

## Persistence semantics

- **Workspace layout** is stored in **`workspace_layout.json`** under the Tauri app config directory (same folder as `settings.json`). The UI debounces writes while you split or resize panes. On first run after this change, if a legacy browser snapshot exists in `localStorage` (`mach-terminal.workspace.v1`), it is migrated into the file once and the key is removed. Restored session IDs must still exist after relaunch; ghost IDs are reconciled on load (PTY processes are not resurrected—only layout bindings).
- **Profile, providers, and routing** persist in `settings.json` under the app config directory (see Tauri app config path per OS).
- **Command history** persists in `command_history.json` in the same config directory. If the file is corrupt JSON, it is **renamed** to a `command_history.corrupt-<timestamp>.json` backup and history starts empty; the app shows a **one-time** recovery toast on startup.

## Stability Hardening Checks

Run these checks before marking a stability tranche complete:

1. Spawn multiple sessions, close one externally (exit shell), and verify no stale interactive tab remains.
2. Close/reopen panes and verify active pane/session fallback never lands in an invalid dead-end state.
3. Restart app and confirm workspace snapshot restore picks valid live session bindings only.
4. Corrupt the settings file intentionally (invalid JSON) and verify startup surfaces explicit settings error instead of silent reset.
5. Corrupt `command_history.json`, relaunch, and verify the recovery toast and a `corrupt-*.json` backup next to the config file.
6. Run `npm run test` and confirm lifecycle ordering, settings persistence, and workspace layout persistence tests pass.
7. Run `npm run security:baseline` and confirm dependency vulnerability checks pass for npm runtime deps and Rust crates.

## Runtime-performance smoke (history IO)

Use this when touching history persistence or hot-path IO:

1. Start the app, run ~20 quick commands (press Enter rapidly) and confirm the UI stays responsive.
2. Relaunch and confirm the last few commands appear in History without manual refresh loops.
3. Break history on purpose: edit `command_history.json` into invalid JSON, relaunch, confirm:
   - one-time recovery toast is shown
   - a `command_history.corrupt-*.json` backup exists next to the config file
4. Verify replay from history still writes input into the active session.
5. For sustained PTY output and UI pacing, see **PTY output coalescing (UI)** in `docs/runtime-contracts.md` (sequence policy, RAF batching, per-frame byte cap).

## Provider path smoke (Ollama first)

Run this when touching provider routing, endpoint settings, or AI explain/fix flows:

1. In **Settings**, set `ollama` endpoint to a reachable host (default `http://127.0.0.1:11434`) and save.
2. Enable provider `ollama`, set routing default provider to `ollama`, and save routing config.
3. With AI opt-in **off**, run an AI prompt and confirm request is blocked with explicit guidance.
4. Turn AI opt-in **on**, run **Run AI prompt**, then trigger **Explain** and **Fix** from history; verify loading state and stable final response.
5. Set endpoint to an invalid URL (for example `ftp://localhost:11434`) and confirm the UI surfaces the backend invalid-endpoint error.
6. Set endpoint to an unreachable URL (for example `http://127.0.0.1:1`) and confirm the UI surfaces unreachable-endpoint guidance.

## Shutdown/cleanup smoke (no leaked shells)

Use this when touching `SessionManager` close/exit paths:

1. Create 2-3 sessions, run a command in each, then close them rapidly (tab close + app exit).
2. Relaunch and confirm no ghost sessions are shown.
3. Confirm no orphan shell processes remain after exit:
   - Windows: Task Manager (look for extra `pwsh.exe` / `cmd.exe`)
   - macOS/Linux: `ps`/Activity Monitor (look for extra shells)
4. Trigger sustained output (e.g. `yes` / `dir /s`), then close the session and confirm the app exits quickly without hanging.

For automated signoff of the scripted checks, run:

```bash
npm run stability:signoff
```

The command writes `artifacts/stability-signoff/stability-signoff-report.json` for handoff, including `ga_cutline.ga_candidate_ready` (true only when version check, full tests, and frontend build all pass). Manual GA items (release promotion, signing, onboarding smoke) are documented in `RELEASING.md`.

## Enforced CI/Release gates

- `CI` runs matrix build/test, release smoke, stability signoff (PRs + `master`), and security baseline checks.
- `Release` workflow blocks artifact publishing until preflight gates pass:
  - `npm run check:versions`
  - `npm run test`
  - `npm run stability:signoff`
  - `npm run release:smoke`
  - `npm run security:baseline`
- `Promote stable release` blocks publishing unless the target draft release has successful `CI` + `Release` runs for the tagged commit and latest `Nightly Burn-In` run succeeded.
