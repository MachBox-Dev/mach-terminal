# Continuation Handoff

Last updated: 2026-04-20

## Purpose

Use this document to resume work in new sessions without re-discovering context.
It captures what shipped recently, what is still open, and the safest next
execution path.

## Current Repo State

- Branch: `master`
- Working tree: expected clean after latest commits
- Stack: Tauri v2 + Rust backend, React/TypeScript frontend, xterm.js renderer

## Recently Shipped Slices

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

### 1) Scripted UX smoke coverage (expand beyond current smoke batch)

Goal: extend scripted smoke coverage from the current palette/find + link-safety + exit-lifecycle + pane-focus/follow-output batch to additional UX dogfood checklist items.

Anchor files:

- `scripts/*`
- `docs/ux-dogfood-log-template.md`
- relevant UX test targets under `src/*`

### 2) Shell Integration P5 follow-up (status-path consolidation)

Goal: continue P5 by promoting invoke-level command tests for `shell_integration_status` from non-blocking smoke to stable blocking coverage once runtime entrypoint issues are resolved.

Potential tasks:

- clear Windows mock/webview `STATUS_ENTRYPOINT_NOT_FOUND` runtime failures so strict invoke path becomes reliable
- promote strict invoke path into `stability:signoff` / CI only after repeatable multi-OS passes
- continue expanding invoke coverage to additional shell-status edge cases while preserving payload contract keys/casing

## Next Session Startup Checklist

1. Read this file and `README.md` "Next Build Steps".
2. Pick one slice and define todo ids before coding.
3. Run baseline verification:
   - `npm run test:types`
   - `npm run test:ux`
   - `npm run test:ux:smoke`
   - `cargo test --manifest-path src-tauri/Cargo.toml`
4. Implement in small commits by logical behavior boundary.
5. Re-run the same verification suite before final commit.

## Recent Commits (most relevant)

- `59f1cef` `:sparkles: feat(shell-integration): add capability-driven cross-shell recovery parity`
- `4c6adc7` `:see_no_evil: chore(git): ignore .cursor workspace metadata`
- `bc82297` `:sparkles: feat(ui): add AI insight workflow and bundled status glyph assets`
- `9e602e8` `:bug: fix(shell-integration): include runtime hook resources and missing settings wiring`
- `3e3721f` `:sparkles: feat(shell-integration): ship P3 onboarding gating and backup recovery`

