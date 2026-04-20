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

### 1) Shell Integration P5 (optional follow-up)

Goal: reduce maintenance overhead by extracting common shell integration logic
into explicit shell strategy helpers and add table-driven matrix tests.

Potential tasks:

- move shell target/expected line resolution to strategy map
- reduce repeated status/install/remove conditionals
- add matrix tests over shell-kind x operation x profile state

### 2) Scripted UX smoke coverage

Goal: convert more UX dogfood checklist coverage into scripted smoke checks.

Anchor files:

- `scripts/*`
- `docs/ux-dogfood-log-template.md`
- relevant UX test targets under `src/*`

## Next Session Startup Checklist

1. Read this file and `README.md` "Next Build Steps".
2. Pick one slice and define todo ids before coding.
3. Run baseline verification:
   - `npm run test:types`
   - `npm run test:ux`
   - `cargo test --manifest-path src-tauri/Cargo.toml`
4. Implement in small commits by logical behavior boundary.
5. Re-run the same verification suite before final commit.

## Recent Commits (most relevant)

- `59f1cef` `:sparkles: feat(shell-integration): add capability-driven cross-shell recovery parity`
- `4c6adc7` `:see_no_evil: chore(git): ignore .cursor workspace metadata`
- `bc82297` `:sparkles: feat(ui): add AI insight workflow and bundled status glyph assets`
- `9e602e8` `:bug: fix(shell-integration): include runtime hook resources and missing settings wiring`
- `3e3721f` `:sparkles: feat(shell-integration): ship P3 onboarding gating and backup recovery`

