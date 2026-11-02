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

## Remaining reliability work

- TER-67: audit the fast-exiting PTY registration/lifecycle race.
- TER-74: move blocking shell-context subprocess probes off the UI thread,
  bound their runtime and avoid repeated elevation probes.
- TER-75: reduce TerminalSurface rerenders during output flushes.
- Reproduce and classify remaining native crashes and mode-switch friction during
  actual work before changing the input model.
