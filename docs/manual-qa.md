# Manual QA checklists

Use these when dogfooding a UX slice, stability tranche, or release candidate. Scripted smoke covers a subset automatically (`npm run test:ux:smoke`); the items below still need human eyes.

Log results with [`ux-dogfood-log-template.md`](ux-dogfood-log-template.md).

---

## Scripted smoke (automated)

`npm run test:ux:smoke` exercises: command-palette keyboard lifecycle, terminal find, link safety (including compiler-style paths), exited-session lifecycle, pane-focus routing, history replay, provider UX gating, AI explain/fix status, composer completion/prediction, BEL flash, context menu, safe-paste guard.

---

## Multi-pane workspace (TER-11)

1. Split to 3–4 panes (`Ctrl/Cmd+\`); each pane gets an independent shell; tab bar shows one grouped tab (`wsl · +2` for 3+ panes).
2. Drag split handles; double-click handle resets 50/50; restart app — proportions restore from `workspace_layout` v2.
3. Operator mode: single group composer below panes; Commander leaf hides group composer and accepts raw xterm input.
4. `Alt+1…6` (Windows: `Ctrl+Alt+1…6`) focuses/targets pane N; composer pills match walk order.
5. Broadcast toggle (composer button or palette **Toggle broadcast mode**): Enter sends to all operator panes once, then broadcast auto-off.
6. Close a middle pane — tree collapses cleanly; active pane fallback never dead-ends.
7. At 6-pane cap, split replaces the inactive pane session (displaced PTY closed).

---

## UX dogfood

1. Open command palette with `Ctrl/Cmd+K`, navigate with arrow keys, execute with Enter, dismiss with Escape.
2. Split and resize panes rapidly; verify active-pane focus ring and stable terminal resize behavior.
3. Search command history, confirm empty-state messaging, and replay a long command from history.
4. Trigger AI explain/fix from history and verify status feedback appears in the history panel.
5. Use the in-app keyboard shortcut reference and confirm each shortcut triggers the intended action.
6. Switch the active split pane and confirm the terminal accepts keystrokes without clicking inside the pane first (when focus already follows the active pane).
7. Select terminal output, copy with `Ctrl/Cmd+Shift+C`, then paste into the shell with `Ctrl/Cmd+Shift+V` (including a short multiline paste).
8. **Links:** `https://` opens in browser; absolute paths underline and open in the OS handler; Windows paths with spaces and UNC; compiler-style `path:line:col` links only the path portion; OSC 8 hyperlinks work; `javascript:` OSC 8 is a no-op.
9. BEL character (`printf '\a'` / `Write-Host ([char]7)`) — brief visual flash on the terminal host.
10. Find (`Ctrl/Cmd+Shift+F`): counter updates, whole word / regex toggles, prev/next, clear and close.
11. Context menu: copy, paste, select all; dismiss on outside click or Escape.
12. Palette **Find in terminal** opens find bar on active pane; **Match case** respected.
13. Context menu near bottom-right stays fully on-screen.
14. Scroll up, run sustained output — viewport does not auto-jump; **Scroll terminal to bottom** restores follow behavior.
15. Palette find next/prev, clear viewport, toggle follow output — focused pane only.
16. Unfocused pane does not execute palette terminal commands when focus changes later.
17. Safe-paste guard for risky multiline payloads; **Don't ask again this session**; single-line fast path.
18. Exit shell — overlay stays, **Restart** / **Escape** / palette parity.
19. Multiple exited tabs — status dots, inline restart, batch close/restart all exited.
20. Non-zero exit codes on overlay and tooltip; **Close active session** path has no code line.
21. OSC 7 hook — restart lands in last `cd` directory; without hook, profile default cwd.
22. Composer scroll: `Ctrl+Alt+Page Up/Down` pages output without stealing focus; assist metrics toggle in release builds.

### Composer input

- Typing only in the composer; xterm is output + selection.
- Focus follows composer when clicking output area.
- See [`shell-integration.md`](shell-integration.md) for minimal prompt + OSC 7.

---

## Stability hardening

1. Spawn multiple sessions, close one externally — no stale interactive tab.
2. Close/reopen panes — active pane/session fallback never dead-ends.
3. Restart app — workspace restore binds only live sessions.
4. Corrupt `settings.json` — explicit settings error, not silent reset.
5. Corrupt `command_history.json` — recovery toast + `corrupt-*.json` backup.
6. `npm run test` — lifecycle, settings, workspace persistence green.
7. `npm run security:baseline` — npm + cargo audit pass.

---

## History IO smoke

1. ~20 rapid commands — UI stays responsive.
2. Relaunch — recent commands in History without manual refresh.
3. Break history JSON — one-time toast + backup file.
4. Replay from history writes to active session.

PTY pacing: see **PTY output coalescing** in [`runtime-contracts.md`](runtime-contracts.md).

---

## Provider path smoke (Ollama first)

1. Settings: `ollama` endpoint reachable, save.
2. Enable `ollama`, set as routing default.
3. AI opt-in **off** — prompt blocked with guidance.
4. AI opt-in **on** — Run AI prompt, Explain, Fix from history.
5. Invalid URL (`ftp://…`) — backend error surfaced.
6. Unreachable URL — unreachable guidance surfaced.

---

## Shutdown / cleanup

1. Create 2–3 sessions, close rapidly — no ghost sessions on relaunch.
2. No orphan shell processes after exit (Task Manager / `ps`).
3. Sustained output then close — app exits without hanging.

---

## Automated signoff

```bash
npm run stability:signoff
```

Writes `artifacts/stability-signoff/stability-signoff-report.json` including `ga_cutline.ga_candidate_ready`.

---

## CI / release gates

- **CI:** matrix build/test, release smoke, stability signoff (PRs + `main`), security baseline.
- **Release:** preflight (`check:versions`, `test`, `stability:signoff`, `release:smoke`, `security:baseline`) before artifacts publish.
- **Promote stable:** draft release needs green CI + Release for tagged commit + latest Nightly Burn-In.

See [`RELEASING.md`](../RELEASING.md).

---

## Persistence reference

| Data | Location |
| --- | --- |
| Workspace layout | `workspace_layout.json` (app config dir); legacy `localStorage` migrated once |
| Profile, providers, routing | `settings.json` |
| Command history | `command_history.json` (corrupt → renamed backup + empty start) |

Override history dir in tests: `MACH_TERMINAL_HISTORY_DIR`.

---

## Developer diagnostics

- **Vite dev + debug Tauri:** header **Diagnostics** + palette **Open diagnostics snapshot**.
- **Logs:** `RUST_LOG=mach_terminal_lib=debug,info` (JSON via `tracing`).
