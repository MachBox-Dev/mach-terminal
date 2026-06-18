# Contributing to Mach Terminal

Thanks for considering a contribution. Mach Terminal is a speed-first, local-first
desktop terminal built on Tauri v2 (Rust backend) + React/TypeScript (frontend).
Before you start, read [`PRINCIPLES.md`](PRINCIPLES.md) — contributions that break
those promises (e.g. making the core depend on AI, or requiring an account) will
not be merged regardless of code quality.

## Ground rules

- **The core works with AI off.** Never make core terminal behavior depend on a
  provider, a network call, or an account.
- **Respect the boundary.** All OS-touching work lives in the Rust core
  (`src-tauri/`); the frontend reaches it only through the single IPC bridge
  (`src/core/terminal.ts`). Keep Rust DTOs (`models.rs`) and TS types in lockstep.
- **Prefer pure helpers.** Logic belongs in unit-testable functions under
  `src/core/*` / `src/state/*`, with colocated tests — not buried in React effects.
- **Fail gracefully.** Backend commands return `Result<_, String>` with user-facing
  messages; the frontend wraps every `invoke` in try/catch.

## Development setup

```bash
npm install
npm run tauri dev
```

Requires a recent Node LTS and the Rust toolchain (stable). See the Tauri v2
prerequisites for your OS (system webview + build tools).

## Before you open a PR — run the gate

```bash
npm run test:types
npm run test:ux
npm run test:ux:smoke
cargo test --manifest-path src-tauri/Cargo.toml
# if you touched the invoke transport:
npm run test:invoke:smoke && npm run test:invoke:strict
```

PRs should be focused, include tests for new pure logic, and keep wire-shape
keys/casing stable across the IPC boundary.

## Commit style

`:gitmoji: type(scope): summary` (gitmoji per https://gitmoji.dev). Optional bullet
body. Do **not** add commit trailers other than the DCO sign-off described below.

## Developer Certificate of Origin (DCO)

This project uses the [Developer Certificate of Origin](https://developercertificate.org/)
instead of a CLA. It's lightweight: by signing off, you certify you wrote the code
(or have the right to submit it) and that it can be distributed under this project's
license.

Add a `Signed-off-by` line to every commit using your real name and email:

```
Signed-off-by: Jane Doe <jane@example.com>
```

The easy way is `git commit -s`, which appends it automatically. PRs whose commits
are not signed off cannot be merged.

> Note on licensing: contributions are accepted under [Apache-2.0](LICENSE). The
> maintainers may distribute the project, including under the open-core model
> described in `PRINCIPLES.md`. If a separate contributor agreement is ever
> required for a specific contribution, it will be requested explicitly in the PR.

## Reporting bugs / requesting features

Open an issue with reproduction steps, your OS/version, and the Mach Terminal
version. For security issues, **do not open a public issue** — see
[`SECURITY.md`](SECURITY.md).

## Code of Conduct

Participation is governed by [`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md).
