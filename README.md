# Mach Terminal

A speed-first, local-first desktop terminal — part of the [Mach](https://machbox.dev) suite.

**No account. No cloud lock-in. AI is optional and off by default.**

| | |
| --- | --- |
| **Download** | [Releases](https://github.com/MachBox-Dev/mach-terminal/releases) (pre-release builds while we dogfood) |
| **Site** | [terminal.machbox.dev](https://terminal.machbox.dev) |
| **License** | [Apache-2.0](LICENSE) |

Also in the suite: [Mach Triage](https://mach-triage.com) (flagship work-queue app).

---

## Quick start

**Users:** grab the latest `.msi` / `.dmg` / `.deb` from [Releases](https://github.com/MachBox-Dev/mach-terminal/releases).

**Developers:**

```bash
git clone https://github.com/MachBox-Dev/mach-terminal.git
cd mach-terminal
npm install
npm run tauri dev
```

On first launch, **Quick start (AI off)** gets you a working shell immediately. Providers and routing are in Settings when you want them.

---

## What you get

- **Multi-tab + split panes** — workspace layout persists across restarts; tabs respawn with their last shell and directory.
- **Composer-first input** — completion, history, and safe multiline paste; **Operator** vs **Commander** modes (`Ctrl+\``).
- **Shell profile picker** — native shells, WSL distros, custom args; pick per tab on **New tab**.
- **Command history** — persisted locally with corruption recovery.
- **Optional AI** — OpenAI, Anthropic, Ollama, or any OpenAI-compatible endpoint; keys in the OS keychain.
- **Shell integration** — optional OSC 7 (live cwd) and OSC 133 (command markers); one-click install from Settings.

Core terminal behavior does not depend on AI, plugins, or network.

---

## Privacy

- No account required for the terminal or BYOK/local AI.
- API keys live in the OS keychain, not plaintext settings.
- No telemetry by default — structured logs stay local unless you set `OTEL_EXPORTER_OTLP_ENDPOINT`.

Details: [`docs/runtime-contracts.md`](docs/runtime-contracts.md).

---

## Development

```bash
npm run test:types          # TypeScript
npm run test:ux             # Vitest unit + smoke
cargo test --manifest-path src-tauri/Cargo.toml   # Rust (close the app if the .exe is locked)
npm run test              # Full frontend gate
```

Before a PR: [`CONTRIBUTING.md`](CONTRIBUTING.md) · design principles: [`PRINCIPLES.md`](PRINCIPLES.md).

---

## Documentation

| Doc | Contents |
| --- | --- |
| [`docs/runtime-contracts.md`](docs/runtime-contracts.md) | IPC, events, PTY pacing, persistence paths |
| [`docs/shell-integration.md`](docs/shell-integration.md) | OSC 7 / OSC 133 hook snippets |
| [`docs/signing-setup.md`](docs/signing-setup.md) | Release updater + OS code signing |
| [`RELEASING.md`](RELEASING.md) | Tag, promote, CI gates |
| [`docs/manual-qa.md`](docs/manual-qa.md) | Manual dogfood + stability checklists |
| [`CHANGELOG.md`](CHANGELOG.md) | Shipped changes |

---

## Stack

Tauri v2 · Rust (PTY + capabilities) · React + TypeScript + Vite · xterm.js
