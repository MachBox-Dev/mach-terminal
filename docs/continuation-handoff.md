# Continuation Handoff

Last updated: 2026-04-20

## Purpose

Use this document to resume work in new sessions without re-discovering context.
It captures what shipped recently, what is still open, and the safest next
execution path.

## Current Repo State

- Branch: `master`
- Stack: Tauri v2 + Rust backend, React/TypeScript frontend, xterm.js renderer
- Latest completed tranche: enhancement tranche 3 (unified UX follow-through + OSC 133 + invoke signoff wiring) — see git log for commit hash
- Invoke transport: `npm run test:invoke:strict` is part of **`npm run stability:signoff`** on Linux and macOS only; Windows still skips strict invoke in that script because mock-webview runs can hit `STATUS_ENTRYPOINT_NOT_FOUND`

## Recently Shipped Slices

### Enhancement tranche 3 (composer scroll, assist metrics, OSC 133, CI)

- **Composer scroll:** `Ctrl+Alt+Page Up` / `Page Down` pages xterm output while the composer stays focused; pure helper in [`src/core/composerOutputScroll.ts`](../src/core/composerOutputScroll.ts) + smoke in [`src/core/composerInput.smoke.test.ts`](../src/core/composerInput.smoke.test.ts).
- **Assist metrics profile flag:** `show_composer_assist_metrics` on [`TerminalProfile`](../src-tauri/src/models.rs) / [`profilePatch`](../src/core/terminal.ts) + Settings toggle; [`TerminalSurface.tsx`](../src/components/TerminalSurface.tsx) shows metrics when `import.meta.env.DEV` **or** the flag is set.
- **OSC 133:** Incremental decoder [`src-tauri/src/osc133.rs`](../src-tauri/src/osc133.rs), PTY reader emits `pty-command-marker` (see [`docs/runtime-contracts.md`](runtime-contracts.md)); UI shows latest hint on [`MachStatusStrip.tsx`](../src/components/MachStatusStrip.tsx). Optional copy-paste snippets in [`src/core/machShellSnippets.ts`](../src/core/machShellSnippets.ts).
- **Invoke / signoff:** [`scripts/stability-signoff.mjs`](../scripts/stability-signoff.mjs) runs strict invoke off Windows; expanded wire assertions in [`src-tauri/tests/shell_integration_invoke_smoke.rs`](../src-tauri/tests/shell_integration_invoke_smoke.rs).

### Shell Integration P3 (Windows-first)

- Added shell integration settings persistence and patch/get APIs.
- Added onboarding CTA gating semantics with explicit "Not now".
- Added backup list/restore for pwsh with backend-validated backup ids.
- Added shell health diagnostics (`healthy`, `stale`, `missing`, `error`).
- Added settings UI recovery flow and related tests.

Primary files:

- `src-tauri/src/shell_integration.rs`
- `src-tauri/src/models.rs`
- `src-tauri/src/lib.rs`
- `src/components/FirstRunSetup.tsx`
- `src/components/ShellIntegrationSection.tsx`
- `src/core/terminal.ts`

### Shell Integration P4 (cross-shell parity, throughput-first)

- Extended status contract with per-shell capabilities:
  - `supportsBackupRestore`
  - `supportsProfileOverride`
- Generalized backup list/restore parity across `pwsh`, `bash`, `zsh`.
- Added health diagnostics parity for `bash` and `zsh`.
- Refactored settings UI to render backup/recovery controls from capabilities
instead of pwsh-only branches.
- Updated frontend and backend tests for capability-driven behavior.

Primary files:

- `src-tauri/src/shell_integration.rs`
- `src/components/ShellIntegrationSection.tsx`
- `src/core/terminal.ts`
- `src/components/ShellIntegrationSection.test.ts`
- `src/core/shellIntegrationSettings.test.ts`

### AI workflow + status strip assets

- Added AI insight panel and composer-level explain/safer actions.
- Added bounded prompt-context plumbing into AI requests.
- Bundled custom status strip glyph assets + symbol font fallback.

Primary files:

- `src/App.tsx`
- `src/components/AiInsightPanel.tsx`
- `src/components/TerminalSurface.tsx`
- `src/hooks/useProviderAiState.ts`
- `src-tauri/src/provider_host.rs`
- `src/core/statusStripGlyphAssets.ts`
- `public/*.png`, `public/fonts/*`

### Provider expansion tranche (OpenAI + Anthropic + custom)

- Added executable adapters for `openai`, `anthropic`, and `custom-openai`.
- Added secure provider key storage using OS credential keychain + Tauri commands:
  - `provider_api_key_set`
  - `provider_api_key_clear`
  - `provider_api_key_status`
- Extended provider routing models beyond Ollama:
  - `openai_model`
  - `anthropic_model`
  - `custom_openai_model`
- Updated Settings and onboarding advanced AI flows:
  - in-app API key entry/clear controls
  - stored-key status indicators
  - per-provider model routing fields
- Extended provider host and settings persistence tests for new contracts.

Primary files:

- `src-tauri/src/provider_host.rs`
- `src-tauri/src/provider_secrets.rs`
- `src-tauri/src/lib.rs`
- `src-tauri/src/models.rs`
- `src-tauri/src/settings.rs`
- `src/hooks/useProviderAiState.ts`
- `src/components/AppSettingsModal.tsx`
- `src/components/FirstRunSetup.tsx`
- `src/core/terminal.ts`
- `src/core/providerUiState.ts`

### Plugin runtime contract expansion (policy + telemetry)

- Formalized plugin bridge contracts with structured request/decision types.
- Added capability allowlist validation + reason-coded policy decisions.
- Added plugin telemetry snapshots for grants/executions/timing diagnostics.
- Added grants snapshot introspection for diagnostics surfaces.
- Updated settings plugin demo to show grant decisions + runtime plugin telemetry.

Primary files:

- `src-tauri/src/models.rs`
- `src-tauri/src/plugin_host.rs`
- `src-tauri/src/lib.rs`
- `src/core/terminal.ts`
- `src/core/plugins.ts`
- `src/components/AppSettingsModal.tsx`
- `src/App.tsx`
- `docs/runtime-contracts.md`

### Shell Integration P5 (strategy-map dispatch + matrix guards)

- Refactored shell integration mutation/recovery operations to use canonical shell strategy dispatch.
- Added canonical shell kind normalization (`powershell` -> `pwsh`) with consistent unknown-shell error handling.
- Removed repeated operation-level shell-kind branching in:
  - install
  - remove
  - backups list
  - backup restore
- Added backend matrix-style tests for shell kind normalization/strategy parity and frontend helper regression tests.

Primary files:

- `src-tauri/src/shell_integration.rs`
- `src/components/ShellIntegrationSection.tsx`
- `src/components/ShellIntegrationSection.test.ts`
- `docs/runtime-contracts.md`

### UX smoke vertical slice (TerminalSurface contracts)

- Added deterministic smoke tests for `TerminalSurface` interaction contracts:
  - context-menu clamp behavior near viewport edges
  - context-menu paste enabled/disabled contract
  - safe-paste guard branching for risky payloads
  - BEL visual flash timing contract
- Added additive `TerminalSurface` helper exports to keep assertions stable without runtime behavior drift.
- Added dedicated `test:ux:smoke` script and wired it into:
  - `stability-signoff`
  - `nightly-burnin`
- Updated README UX checklist notes to mark this subset as scripted.

Primary files:

- `src/components/TerminalSurface.tsx`
- `src/components/TerminalSurface.smoke.test.ts`
- `package.json`
- `scripts/stability-signoff.mjs`
- `scripts/nightly-burnin.mjs`
- `README.md`

### UX smoke expansion batch (palette/find + link safety + exit lifecycle)

- Expanded `test:ux:smoke` targeting to auto-discover smoke suites by `smoke.test.ts` suffix (no per-file script rewrites).
- Added deterministic smoke contracts for:
  - command-palette keyboard lifecycle and focused find intent flow
  - terminal link extraction + activation policy (allow http/https + safe file, reject unsafe schemes/remote file hosts)
  - exited-session lifecycle composition (overlay summary, tab tooltip code suffix, batch order, restart cwd fallback)
- Kept quality gates unchanged (signoff + nightly already invoke `test:ux:smoke`) while broadening smoke coverage surface.

Primary files:

- `package.json`
- `src/components/CommandPalette.tsx`
- `src/core/paletteFind.smoke.test.ts`
- `src/core/linkSafety.smoke.test.ts`
- `src/core/exitLifecycle.smoke.test.ts`
- `README.md`

### UX smoke tranche (pane focus + follow output contracts)

- Added deterministic smoke coverage for pane-focus and follow-output behavior:
  - focused-only terminal UI request consumption with seq fast-forward semantics
  - no deferred command replay when a previously unfocused pane later gains focus
  - follow-output toggle contract (`setFollowOutput`) and scroll-to-bottom coupling
  - deterministic split/close active-pane fallback under rapid close transitions
- Expanded workspace unit coverage by extracting active-pane fallback selection into a pure helper used by `closePane`.
- `test:ux:smoke` auto-discovers this tranche via `*.smoke.test.ts` naming; no gate rewiring required.

Primary files:

- `src/core/paneFocus.smoke.test.ts`
- `src/state/workspace.ts`
- `src/state/workspace.test.ts`
- `README.md`

### UX smoke tranche (history replay + AI explain/fix contracts)

- Added deterministic smoke coverage for checklist items `3` and `4` behavior contracts:
  - case-insensitive history search filtering
  - dual empty-state messaging (`no history` vs `no search matches`)
  - replay/explain/fix handlers receiving full command text (not truncated display text)
  - explain/fix wiring from settings modal callbacks into history panel handlers
- Added AI orchestration contract tests for history actions:
  - explain/fix intent mapping (`explain_command`, `fix_command`)
  - prompt shaping and stable pending/success/failure status strings
- Strengthened backend history semantics guards:
  - newest-first query ordering with limit enforcement
  - case-insensitive + session-scoped filtering
  - replay newline normalization contract

Primary files:

- `src/components/HistoryPanel.tsx`
- `src/components/HistoryPanel.smoke.test.ts`
- `src/components/AppSettingsModal.tsx`
- `src/hooks/useProviderAiState.ts`
- `src/hooks/useProviderAiState.test.ts`
- `src-tauri/src/session_manager.rs`
- `README.md`

### Composer roadmap tranche 1+2 (completion + prediction/history)

- Composer-first input model is now fully enforced in UI behavior:
  - xterm pane remains non-interactive for stdin (`disableStdin=true`)
  - completion/prediction/history live in the composer only
- Added backend completion command (`composer_complete`) with:
  - cwd-aware path completion (relative, absolute, quoted, `~` expansion)
  - command-name completion from PATH executable scan + shell builtin index
  - cache invalidation for PATH command index (time + PATH-key aware)
- Added frontend completion/prediction/history engines and deterministic tests:
  - pure completion state/cycle helpers
  - pure history navigation + prediction acceptance guards
  - smoke contracts covering completion cycling + prediction/history acceptance semantics
- Added composer discoverability/hardening hooks:
  - fallback message when completion probing fails
  - bounded history window for prediction/history browsing
  - lightweight assist metrics line (request count, accept count, avg completion latency)

Primary files:

- `src-tauri/src/composer_completion.rs`
- `src-tauri/src/lib.rs`
- `src/core/composerCompletion.ts`
- `src/core/composerHistory.ts`
- `src/core/composerInput.smoke.test.ts`
- `src/components/TerminalSurface.tsx`
- `src/App.tsx`
- `src/components/SplitWorkspace.tsx`
- `src/core/terminal.ts`
- `README.md`

### Shell status consolidation (P5 follow-up)

- Refactored shell status construction to use shared backend derivation/builders across `pwsh`, `bash`, and `zsh`.
- Consolidated duplicate marker/expected-line/health logic used by:
  - `pwsh_shell_status`
  - `unix_profile_shell_status`
- Consolidated resolved/unresolved row construction while preserving payload semantics:
  - `profilePathSource` (`override` / `auto` / omitted)
  - `backupCount` optionality
  - `health` values and error/null behavior
- Added parity-focused backend tests covering:
  - expected-line match vs stale mismatch
  - resolved/unresolved source semantics
  - cross-shell row invariants for status composition

Primary files:

- `src-tauri/src/shell_integration.rs`
- `docs/runtime-contracts.md`

### Shell status contract guards (error paths + wire shape)

- Added backend contract tests for shell-status rows covering:
  - invalid pwsh override path semantics (`profileResolved=false`, `health=error`, `profilePathSource=override`)
  - unresolved auto path semantics (`profilePathSource` omitted/null, `backupCount` null)
  - serialized wire-shape invariants (`profilePath`, `backupCount`, `profilePathSource`, `error`)
  - canonical shell row ordering/capability invariants (`pwsh`, `bash`, `zsh`)
- Generalized select settings/shell-integration helpers to runtime-generic `AppHandle<R>` signatures to keep test harness pathways compatible across runtimes.

Primary files:

- `src-tauri/src/shell_integration.rs`
- `src-tauri/src/settings.rs`
- `docs/runtime-contracts.md`

### Shell invoke transport bootstrap (non-blocking phased rollout)

- Added initial invoke-transport smoke spec for `shell_integration_status`:
  - `src-tauri/tests/shell_integration_invoke_smoke.rs`
  - assertions cover canonical shell row ordering and key pwsh error/null/source semantics.
- Added non-blocking invoke runner:
  - `npm run test:invoke:smoke` (`scripts/invoke-smoke.mjs`)
  - executes feature-gated (`invoke-smoke`) ignored invoke smoke tests with failure-tolerant behavior for phased adoption.
- Current environment caveat: Windows mock-webview runtime can fail with `STATUS_ENTRYPOINT_NOT_FOUND`; runner is intentionally non-blocking until transport stability is proven.

Primary files:

- `src-tauri/tests/shell_integration_invoke_smoke.rs`
- `scripts/invoke-smoke.mjs`
- `package.json`
- `src-tauri/Cargo.toml`
- `docs/runtime-contracts.md`

### Shell invoke promotion wiring (strict path + expanded contracts)

- Hardened invoke harness gating and diagnostics:
  - `invoke-smoke` now enables `tauri/test` only when requested, so baseline `cargo test` stays unaffected.
  - invoke runner now reports structured failure details (exit status/signal + entrypoint caveat hints).
- Expanded invoke transport assertions:
  - top-level payload shape (`scriptVersion`, `shellDir`, `shells`)
  - canonical row order remains `pwsh`, `bash`, `zsh`
  - cross-shell capability + allowed-health invariants now asserted at transport boundary
- Added staged invoke scripts:
  - `npm run test:invoke:smoke` (non-blocking, failure-tolerant)
  - `npm run test:invoke:strict` (opt-in strict, failure-propagating)
- Added backend guard parity coverage for top-level shell integration status serialization to reduce transport-vs-backend drift.

Primary files:

- `src-tauri/tests/shell_integration_invoke_smoke.rs`
- `src-tauri/src/shell_integration.rs`
- `scripts/invoke-smoke.mjs`
- `package.json`
- `src-tauri/Cargo.toml`
- `docs/runtime-contracts.md`

## Important Contracts

### Shell integration status contract

Each shell row now includes:

- `health`
- `backupCount`
- `capabilities.supportsBackupRestore`
- `capabilities.supportsProfileOverride`

This is the contract UI code should consume for feature visibility. Avoid
re-introducing shell-kind hardcoded branching in components.

### Backup/restore safety model

- Backup files live beside profile in `.mach-terminal-shell-backups`.
- Restore selection is by backend-issued `backupId`, not raw file paths.
- Backend validates backup candidates by filename pattern and profile target.

### Onboarding prompt semantics

`onboardingInstallPromptSeen` should only be set by:

- successful shell hook install from onboarding, or
- explicit onboarding "Not now" action

Do not set this flag from general onboarding Save/Quick start/Skip flows.

## Known Observations

- `settings_persistence` concurrent-write test can fail transiently on Windows
due to filesystem timing/race behavior; rerun has historically passed.
- PowerShell profile warnings in local shell startup can appear in tool output
and are unrelated to app tests.

## Open Backlog (Recommended Priority)

### 1) Shell Integration P5 follow-up (status-path consolidation)

Goal: continue P5 by promoting invoke-level command tests for `shell_integration_status` from non-blocking smoke to stable blocking coverage once runtime entrypoint issues are resolved.

Potential tasks:

- clear Windows mock/webview `STATUS_ENTRYPOINT_NOT_FOUND` runtime failures so strict invoke can run on Windows the same way it already runs on Linux/macOS signoff
- optional: add `test:invoke:strict` to the main **matrix** CI job (currently strict invoke is only in `stability:signoff` off Windows)
- continue expanding invoke coverage to additional shell-status edge cases while preserving payload contract keys/casing

## Next Session Startup Checklist

1. Read this file and `README.md` "Next Build Steps".
2. Pick one slice and define todo ids before coding.
3. Run baseline verification:
  - `npm run test:types`
  - `npm run test:ux`
  - `npm run test:ux:smoke`
  - `cargo test --manifest-path src-tauri/Cargo.toml`
4. If touching invoke transport, run both modes and record behavior:
  - `npm run test:invoke:smoke`
  - `npm run test:invoke:strict`
5. Implement in small commits by logical behavior boundary.
6. Re-run the same verification suite before final commit.

## Recent Commits (most relevant)

- `58bc84a` `:sparkles: feat(composer): tighten prediction and history acceptance model`
- `817b5d1` `:sparkles: feat(composer): add completion engine and composer assist flows`
- `52e12cc` `:white_check_mark: test(ux-smoke): add pane focus and follow-output contracts`
- `c49ccd6` `:white_check_mark: test(shell-integration): add strict invoke promotion path and parity guards`
- `30f7896` `:white_check_mark: test(shell-integration): scaffold non-blocking invoke transport smoke`
- `5737453` `:white_check_mark: test(shell-integration): lock shell status wire-shape and error-path contracts`
- `26ab423` `:recycle: refactor(shell-integration): consolidate shell status builders and parity guards`