# Mach Terminal — Master Runbook · INDEX

> Federated context for AI agents and developers. Read the file relevant to your task; do not load all of them unless you need a full-system mental model.

## Executive Summary

**Mach Terminal** is a speed-first, local-first **desktop terminal emulator** built on **Tauri v2**. A Rust backend owns the PTY (pseudo-terminal) lifecycle and all OS-touching capabilities; a React + TypeScript + Vite frontend renders the UI and terminal via `xterm.js`. AI provider integrations (OpenAI, Anthropic, Ollama, custom OpenAI-compatible) are **optional, BYO-key, and disabled by default** — they are never a dependency for core terminal behavior.

Distinctive design choices grounded in the code:
- **Tri-mode input per session** (`operator` / `console` / `ai`): cycle with **Ctrl+` `** (sacred chord, never forwarded to PTY). Operator = composer-first with completion/history; Console = raw xterm stdin for tmux/vim/ssh; AI = composer + insight panel with `?`-prefixed AI-only prompts and shell commands still piped to the PTY/history. Mode persists per tab in `WorkspaceLayout.sessions[]`.
- **Composer-first default (Operator mode)**: typing happens in a dedicated composer input; xterm runs with `disableStdin=true` unless Console mode is active.
- **Capability-scoped plugin host** with reason-coded policy decisions and telemetry (`src-tauri/src/plugin_host.rs`).
- **Strict frontend/backend boundary**: every backend interaction goes through Tauri `invoke` commands and `listen` events, funneled through one bridge module (`src/core/terminal.ts`).

## North Star

> A terminal whose baseline is **terminal performance, session reliability, and local control** — with **no cloud lock-in, no account requirement**, and AI as a strictly optional enhancement layered on top of a rock-solid core.

Every change is judged against: does it keep the core terminal fast, reliable, and fully functional with AI off?

## Table of Contents

| File | Use it when you need... |
| --- | --- |
| [`01_ARCHITECTURE.md`](01_ARCHITECTURE.md) | Tech stack, system patterns, end-to-end data flow, external deps/APIs |
| [`02_COMPONENTS_AND_FILES.md`](02_COMPONENTS_AND_FILES.md) | Directory map, module responsibilities, where config/routing/state live |
| [`03_RULES_AND_STANDARDS.md`](03_RULES_AND_STANDARDS.md) | Coding conventions, error handling, state rules, testing/CI gates, gotchas |
| [`04_CURRENT_STATE.md`](04_CURRENT_STATE.md) | What works, what's broken/incomplete, immediate next steps |

## Fast Facts

- **Repo root:** `mach-terminal/` · **Default branch:** `main` · **Version:** `0.1.0`
- **Frontend entry:** `src/main.tsx` → `src/App.tsx` (single large orchestrator component)
- **Backend entry:** `src-tauri/src/main.rs` → `src-tauri/src/lib.rs` (`run()`, command registry)
- **IPC bridge:** `src/core/terminal.ts` (all `invoke`/`listen` wrappers + shared TS types)
- **Run dev:** `npm install && npm run tauri dev`
- **Full test gate:** `npm run test` (= `test:types` + `test:ux` + `test:perf` + `test:pty`)

## Canonical Source Docs (outside this runbook)

- `README.md` — user-facing quick start + doc index (manual QA → `docs/manual-qa.md`)
- `docs/runtime-contracts.md` — wire contracts (events, OSC parsing, PTY coalescing, invoke)
- `docs/continuation-handoff.md` — historical tranche-by-tranche shipping log + open backlog
- `RELEASING.md` — release/promotion pipeline and signing
