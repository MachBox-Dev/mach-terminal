# Mach Terminal — Principles

These are the load-bearing promises of this project. They are not marketing.
They are constraints that every change — community or maintainer — is judged
against. A change that violates one of these is wrong by definition, no matter
how clever it is.

## North Star

> A terminal whose baseline is **terminal performance, session reliability, and
> local control** — with **no cloud lock-in and no account requirement** — and
> AI as a strictly optional enhancement layered on top of a rock-solid core.

## The Non-Negotiables

1. **The core terminal works with AI fully disabled.** AI is an enhancement,
   never a dependency. If the AI layer, a provider, or a network call breaks,
   the terminal keeps spawning shells, rendering output, and persisting state.

2. **No account is ever required for the core terminal or for bring-your-own-key
   (BYOK) / local AI.** You can use Mach Terminal forever without signing into
   anything. Any future hosted service (e.g. "Mach Cloud") is strictly opt-in and
   never gates core functionality. BYOK and local providers (e.g. Ollama) remain
   first-class, permanently.

3. **Local-first by default.** Credentials live in the OS keychain, never in
   plaintext settings. No telemetry is required to use the app; any telemetry is
   opt-in and clearly documented.

4. **Fail gracefully, never silently reset.** Corrupt state is recovered or
   backed up with a user-visible notice — never wiped without a trace. Backend
   commands return user-facing error messages; the frontend handles them.

5. **The boundary is the contract.** All OS-touching capability lives in the Rust
   core; the frontend talks to it only through the single IPC bridge. Cross-boundary
   changes keep the Rust DTOs and TypeScript types in lockstep.

6. **Speed is a feature.** The hot path (keystroke → PTY → render) stays paced,
   bounded, and backpressure-aware. Regressions in input latency or output
   throughput are bugs, not trade-offs.

## What This Means For The Open-Core Split

Mach Terminal is open source under Apache-2.0. The commercial **Mach Cloud**
service (managed AI relay, accounts, billing, suite integration) is a separate,
proprietary component that talks to this client over a standard, documented,
OpenAI-compatible interface. The open client contains no secret sauce — the value
of the hosted service is the service, not lock-in. The principles above guarantee
the open client never degrades into a funnel for the paid one.
