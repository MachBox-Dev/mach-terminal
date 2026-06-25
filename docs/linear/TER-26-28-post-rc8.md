# Linear backlog — post rc.8 (current cycle)

> **Status:** Shipped — merged to `main` @ `3c0bafd` (2026-06-25). TER-26/27/28 marked **Done** in Linear.

## TER-26 — Provider UX unification (Track B)

**Linear:** [TER-26](https://linear.app/mach-triage/issue/TER-26/unify-provideronboarding-status-strings-and-error-semantics) · Cycle 2

**Title:** Unify provider/onboarding status strings and error semantics

**Description:**  
Settings and onboarding share `buildProviderCards`, but onboarding still uses batch save and local error helpers while `useProviderAiState` hardcodes failure strings for explain/fix/history AI. Centralize every user-facing provider/AI status in `providerUiState.ts` so the same backend failure maps to the same copy on every surface.

**Acceptance:**
- [ ] All provider mutation failure toasts use `providerUiState` helpers (settings + onboarding)
- [ ] History explain/fix pending/success/failure strings are canonical in `providerUiState`
- [ ] `providerUiState.smoke.test.ts` covers onboarding fallbacks + history AI contracts
- [ ] No duplicated status literals in `FirstRunSetup.tsx` / `useProviderAiState.ts`

**Estimate:** M

---

## TER-27 — Phase 2 perf spike (Track C)

**Linear:** [TER-27](https://linear.app/mach-triage/issue/TER-27/pty-flow-control-baseline-phase-2-perf-spike) · Cycle 2

**Title:** PTY flow-control baseline + Phase 2 perf spike doc

**Description:**  
Phase 0/1 hot path is shipped (WebGL, Channel, UTF-8 streaming). `MAX_PENDING_CHUNKS` is effectively dead at 8 KB reads. Document Phase 2 options (reader coalesce, channel backpressure, native GPU grid) and add a unit-tested backpressure helper so drop behavior is explicit before we change semantics.

**Acceptance:**
- [ ] `docs/phase2-perf-spike.md` — profiling plan, go/no-go criteria, spike scope
- [ ] `enqueue_output_chunk` (or equivalent) unit-tested; documents when drops occur
- [ ] No production behavior regression without profiling sign-off

**Estimate:** M

---

## TER-28 — Dogfood → scripted smoke (Track D)

**Linear:** [TER-28](https://linear.app/mach-triage/issue/TER-28/script-tab-focus-routing-and-cross-surface-provider-ux-smoke) · Cycle 2

**Title:** Script tab-focus routing and cross-surface provider UX contracts

**Description:**  
`docs/manual-qa.md` still has manual-only rows for tab switch focus and settings/palette coordination. Add vitest smoke contracts for workspace focus routing and extend provider smoke coverage so CI catches UX regressions while rc.8 bakes.

**Acceptance:**
- [ ] `workspaceFocus.smoke.test.ts` — focus event + `selectTabGroup` target/focus sync
- [ ] Provider smoke covers onboarding fallbacks + history AI status parity
- [ ] `docs/manual-qa.md` scripted section updated

**Estimate:** S
