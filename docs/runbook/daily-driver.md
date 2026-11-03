# Windows daily-driver hardening

The first November 2026 reliability pass addresses TER-65, TER-66 and the
group-composer behavior in TER-71. These changes require native Windows
dogfooding before daily-driver readiness can be claimed.

## Output positions

`SessionBufferStore.getSnapshot` supplies retained text, a monotonic
`totalAppended` position, and the absolute `startOffset` of retained text.
Positions count UTF-16 code units. Consumers must never infer new output from
the retained string length: it stops growing at the retention cap, and repeated
output may leave the retained string identical.

Terminal rendering uses `sessionBufferDelta`; a consumer behind the retained
window replays that window. Run ledger positions are absolute stream positions.
Copied run output, failure excerpts and AI tools subtract the retained window's
offset. `getAll` captures a copy of the buffer map so asynchronous AI requests
retain text consistent with their captured offsets.

## Completion and input modes

Completion requests and responses use textarea-compatible UTF-16 positions.
Rust converts requests to UTF-8 byte offsets before scanning real characters,
then converts replacement bounds back to UTF-16.

GroupComposer uses the hook's keyboard handler. Completion cycling updates the
replacement end and request key after every candidate; cursor selection applies
after React commits the controlled textarea value. Mode changes on the same pane
must move focus while preserving the Operator draft and never submitting it.

## Verification and acceptance

- `npm run test:ux -- --dir src` tests this checkout without discovering nested
  worktrees. Mounted interaction tests use jsdom as a development dependency.
- `npm run build` checks types and builds the frontend.
- `cargo test --manifest-path src-tauri/Cargo.toml --tests` checks the backend
  and real PTY integration.
- Invoke smoke and strict smoke use the documented Windows serialization fallback.
- Native acceptance still needs sustained output beyond 120K characters,
  repeated mode switches, Unicode completion, splits, resize, shutdown and restore.
  Automated component tests do not establish native WebView/GPU stability.

QA builds must use a separate app identifier and deep-link scheme. Runtime
registration follows configured schemes rather than hardcoding `machterm`.
Build-only verification does not establish successful startup or state isolation.

## Reliability follow-up after PR #79

`codex/daily-driver-reliability` is rebased onto main's PR #79 merge
(`c806ab6`). The next candidate tranche covers:

- TER-67: the reader waits until the session is registered and `running` has
  been emitted. Failed registration/notification cancels the reader and tears
  down the child and ConPTY handles. Frontend lifecycle and spawn/restore status
  updates reject `running` after a terminal status for the same session id.
- TER-74: shell context runs on a blocking worker, with a two-second deadline
  and 8 KiB output cap per subprocess. Diff reuses the branch result. Windows
  elevation uses the process token rather than launching PowerShell. Shared
  polling caches up to 64 directory/settings requests, including in-flight
  requests; a hidden clock schedules no interval.
- TER-75: TerminalSurface subscribes imperatively to output snapshots rather
  than rerendering on each store update; absolute output positions still drive
  the existing write pump and retention recovery.
- The PR #79 split-prompt follow-up retains an 8 KiB per-session prompt tail.
  Numbered options and ANSI sequences may span flushes. Screen resets, answers,
  dismissal, agent exit and resumed work invalidate stale context. A shortcuts
  footer alone does not dismiss a visible question. Backend command acknowledgments
  cannot erase a newer prompt received on the separate output channel.
- Workspace focus honors active agents even in Operator mode, preserving the
  draft while directing keystrokes to raw terminal input.

Regressions cover split options/redraws, stale-question clearing, capped output
without React renders, subscription cleanup, agent focus, probe time/output
bounds, shared polling, clock visibility and late lifecycle/spawn responses.
The real fast-exit regression uses `cmd /C exit 1` on Windows (`sh -c exit 1`
on Unix), forces an already-exited child before registration and tests emit
failure cleanup. It exercises startup registration and reaping; the existing
PTY integration tests separately cover output/EOF and nonzero exit codes.

## Remaining reliability work

- Run the native acceptance checklist above against a newly built isolated QA
  executable. Automated checks do not establish native startup, WebView/GPU
  behavior, long-running agent interaction or production state isolation.
- Reproduce and classify remaining crashes and mode-switch friction during actual
  work before changing the input model. This tranche does not claim all freezes
  and crashes are resolved.
