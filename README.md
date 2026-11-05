# Mach Terminal

A speed-first, local-first desktop terminal built on **Tauri v2 (Rust)** and **React 19 + xterm.js (WebGL)** — part of the [Mach](https://machbox.dev) suite.

**No account required. No cloud lock-in. AI is strictly optional and off by default.**

| | |
| --- | --- |
| **Download** | [GitHub Releases](https://github.com/MachBox-Dev/mach-terminal/releases) (`.msi` / `.dmg` / `.deb` pre-release dogfood builds) |
| **Site** | [terminal.machbox.dev](https://terminal.machbox.dev) · Suite sibling: [Mach Triage](https://mach-triage.com) |
| **License** | [Apache-2.0](LICENSE) · Principles: [`PRINCIPLES.md`](PRINCIPLES.md) |

---

## Quick Start

### Install a Release Build
Grab the latest installer for your OS from [Releases](https://github.com/MachBox-Dev/mach-terminal/releases):
- **Windows:** `.msi` or `-setup.exe` (uses ConPTY; refreshes `PATH` directly from User + Machine registry so `winget`/`scoop`/`mise` shims work immediately)
- **macOS:** `.dmg` (Apple Silicon & Intel)
- **Linux:** `.deb`

On first launch, click **Quick start (AI off)** to drop straight into a working shell. Everything in the core terminal works offline forever without touching a provider or account.

### Run from Source

**Prerequisites:** [Node.js LTS](https://nodejs.org/) (v20+), [Rust stable toolchain](https://rustup.rs/), and [Tauri v2 platform dependencies](https://v2.tauri.app/start/prerequisites/) (WebView2 on Windows, Xcode CLI tools on macOS, `webkit2gtk` + build-essential on Linux).

```bash
git clone https://github.com/MachBox-Dev/mach-terminal.git
cd mach-terminal
npm install

# Launch the desktop app in dev mode (cleans up stale dev processes automatically)
npm run dev:tauri
# Or directly via the Tauri CLI:
npm run tauri dev
```

---

## How Mach Terminal Works Day-to-Day

### 1. Two Input Modes: Operator vs. Commander (`Ctrl+\``)

Press **`Ctrl+\``** (or use the Command Palette `Ctrl/Cmd+K`) at any time to toggle between two input postures:

| Mode | How Input Works | Best For |
| --- | --- | --- |
| **Operator Mode** *(default)* | Typing happens in the **Group Composer** below the terminal panes. Supports native shell `Tab` completion (`pwsh`, `zsh`, `bash` + cwd-aware path/command index), history browsing (`Up`/`Down`), multi-line editing (`Shift+Enter`), safe paste review, and one-key AI toggling (`?`). | Everyday shell work, multi-pane orchestration, composing multi-line commands, and CLI coding agents. |
| **Commander Mode** | Keystrokes go directly to **raw xterm.js stdin** in the focused pane. The composer locks out of the way. | Full-screen TUIs (`vim`, `nvim`, `tmux`, `htop`, `lazygit`), interactive prompts, and raw terminal apps. |

> **Smart CLI Agent Handoff:** When you launch a supported CLI coding agent in **Operator Mode**, Mach Terminal automatically allows direct keyboard interaction in the terminal viewport while keeping the composer and inline Agent HUD available below.

---

### 2. Tabs, Splits, and Focus vs. Target

Each tab hosts a binary split tree of **up to 6 independent PTY panes** with draggable resize handles (double-click any divider to reset 50/50).

In multi-pane tabs, Mach separates **Focus** from **Composer Target** so you can inspect or scroll one pane while firing commands into another:

- **Focused Pane (Cyan left bar):** Receives keyboard shortcuts, Commander stdin, Find (`Ctrl/Cmd+Shift+F`), and serves as active context for the Ops Rail.
  - Switch focus: **Click a pane**, or press **`Ctrl+Alt+1..9`** (Windows/Linux) / **`Alt+1..9`** (macOS).
- **Target Pane (Purple bottom bar):** Receives commands submitted from the Operator **Group Composer** (`Enter`, `Tab` completion, `exit`).
  - Switch target without moving focus: **Click a pane pill** in the composer header, or press **`Ctrl+Alt+Shift+1..9`** (Windows/Linux) / **`Alt+Shift+1..9`** (macOS).
- **Broadcast Mode:** Send composer input to **all Operator panes** in the active tab at once.
  - **One-shot broadcast:** Click **Broadcast** in the composer (or `Ctrl/Cmd+Shift+B` / `Alt+Shift+B`) — sends the next `Enter` to all panes, then disarms.
  - **Sticky broadcast:** **Shift+click Broadcast** (or `Ctrl/Cmd+Alt+Shift+B`) — stays armed across commands until you click it again or run **Disarm broadcast** from the palette.

---

### 3. Native CLI Coding Agent HUD & Launcher (Zero Config)

Mach Terminal natively detects local CLI coding agents running inside your shell — **with Mach AI completely disabled**:

- **Supported CLIs:** `agy` (Antigravity), `claude` (Claude Code), `codex`, `gemini`, `aider`, `opencode`, `cursor-agent`, `goose`, `amp`, and `copilot`.
- **Automatic Detection:** Combines command invocation parsing, TUI startup banner matching, and background OS process-tree inspection (`pty_inspect_session_process`) so interpreter-backed CLIs and subshells are tracked accurately without flashing console windows.
- **Inline Agent HUD (`AgentPromptBar`):** Appears above the composer when an agent is active:
  - One-click slash-command pills (`/help`, `/clear`, `/compact`, `/model`, etc.) + expandable **Commands (N)** drawer.
  - Interactive confirmation cards when an agent prompts for tool permissions or numbered choices (`y` / `n` / `all` / `1..9` / `Esc`), rendered as a viewport overlay so prompt redraws never resize your PTY.
  - Quick **`Esc`** interrupt and probe-guarded **`Quit CLI`** button (safely exits the foreground agent without killing your underlying shell).
- **Ops Rail Agent Tab (`Alt+O` → Agent):** One-click launcher grid for installed coding agents, active profile selector, pin toggle, and searchable slash-command reference.

---

### 4. Shell Profile Picker, WSL & Saved Presets

- **Instant Default Tab (`Ctrl/Cmd+T` or `+`):** Spawns immediately using your default profile.
- **Shell Picker (`Shift+Click +` or Palette → *New tab with shell picker*):**
  - Auto-detects installed host shells (`pwsh`, Windows PowerShell, `cmd.exe`, Git Bash, `zsh`, `bash`, `/etc/shells`) and enumerates **WSL distributions** (`wsl.exe -d <distro>`).
  - Save custom **Shell Presets** (executable + custom arguments like `-NoLogo` or `--login`) in **Settings → Terminal profile**; saved presets appear at the top of the picker and as direct quick-launch commands in the Command Palette (`Ctrl/Cmd+K`).
- **Cold-Restart Workspace Restore:** Window splits, custom tab names (`F2` or double-click tab), per-tab shell + arguments, last working directory, and per-session AI chat threads automatically respawn where you left off across app restarts.

---

### 5. Shell Integration (OSC 7 & OSC 133)

Optional, one-click shell hooks for `pwsh`, `bash`, and `zsh` (with automatic rc/profile backup and restore in **Settings → Shell integration**):

- **OSC 7 (Live `cwd`):** Updates the session's current directory on every prompt so split panes, session restarts, and cold app launches land in your exact working directory.
- **OSC 133 (Command boundaries & exit codes):** Powers live command status in the status strip, captures command runs in the Ops Rail, and enables the non-zero exit failure assist shortcut (**`Ctrl+Enter`** on an empty composer after a failed command).

Manual setup snippets: [`docs/shell-integration.md`](docs/shell-integration.md).

---

### 6. Ops Rail & Optional BYOK / Local AI (`Alt+O`)

Press **`Alt+O`** to toggle the resizable right-hand **Ops Rail**, which houses three tabs:

1. **Runs (Command Log):** Per-session ledger of submitted commands. Filter, pin, jump to output in the scrollback buffer (`Alt+Up` / `Alt+Down` / `Alt+Enter`), or click **Explain** / **Safer** on any entry.
2. **AI (Per-Session Chat):** Strictly opt-in (**Settings → AI providers**).
   - **Providers:** **Ollama** (local, default `http://127.0.0.1:11434`), **OpenAI**, **Anthropic**, or any **Custom OpenAI-compatible** endpoint.
   - **Quick Ask from Composer:** Press **`?`** in an empty Operator composer to flip the submit chip from `Cmd` to `AI` (without typing `?` into your draft).
   - **Ask AI on Selection:** Highlight any terminal output → right-click → **Ask AI** to attach the snippet with line numbers.
   - **Read-Only Command-Log Tools:** When enabled, the AI can call `list_command_runs` and `get_command_output` (up to 4 tool rounds) to inspect recent session output without manual copy-pasting.
3. **Agent:** Launch and control local CLI coding agents (`claude`, `codex`, `agy`, etc.).

---

### 7. Terminal Ergonomics & Safety Guards

- **Raw-Bytes IPC + WebGL Rendering:** PTY output streams over a dedicated binary Tauri `Channel` (bypassing JSON event serialization) with streaming UTF-8 boundary decoding, RAF frame coalescing, external-store scrollback subscriptions (zero React re-renders per output chunk), and `@xterm/addon-webgl` (with automatic DOM fallback).
- **Safe Multiline Paste Guard:** Pasting multiline payloads, long scripts (>500 chars), or shell chaining tokens (`&&`, `||`, `;`, `|`) via `Ctrl/Cmd+Shift+V` or right-click opens an inline preview card (**Paste anyway** / **Cancel** / **Don't ask again this session**) before bytes touch the PTY.
- **Modifier-Click Links (`Ctrl/Cmd+Click`):** Plain clicks select text without accidental launches. `Ctrl+Click` (Windows/Linux) or `Cmd+Click` (macOS) opens `http(s)://` URLs, OSC 8 hyperlinks, and local filesystem paths (including quoted paths, Windows `C:\...` paths with spaces, UNC paths, and `file.ts:line:col` compiler output). Unsafe URI schemes are blocked.
- **Cross-App Deep Links (`machterm://`):** Same-machine URL schemes `machterm://composer?text=...` and `machterm://ai-note?text=...&label=...` let sibling tools (like Mach Triage's Armory) hand off commands or context as **reviewable drafts** — never auto-executed or auto-sent. See [`docs/deep-link-contract.md`](docs/deep-link-contract.md).

---

## Keyboard Shortcuts

Every shortcut below is also searchable in the **Command Palette (`Ctrl/Cmd+K`)**.

| Shortcut (Win/Linux · macOS) | Action |
| --- | --- |
| `Ctrl+K` · `Cmd+K` | Open **Command Palette** |
| `Ctrl+\`` | Cycle input mode (**Operator** ↔ **Commander**) |
| `Ctrl+T` · `Cmd+T` | New tab (instant default profile) |
| `Shift+Click +` | New tab with **Shell Profile Picker** |
| `F2` *(or double-click tab)* | Rename active tab |
| `Ctrl+\` · `Cmd+\` | Split pane vertically (side-by-side columns) |
| `Ctrl+Shift+\` · `Cmd+Shift+\` | Split pane horizontally (stacked rows) |
| `Ctrl+W` · `Cmd+W` | Close focused pane (or tab if solo pane) |
| `Ctrl+Alt+1..9` · `Alt+1..9` | **Focus** pane 1–9 (keyboard & Ops Rail context) |
| `Ctrl+Alt+Shift+1..9` · `Alt+Shift+1..9` | **Target** pane 1–9 (routes Operator composer input) |
| `Ctrl+Shift+B` *(or `Alt+Shift+B`)* | Arm **one-shot broadcast** to all Operator panes in tab |
| `Ctrl+Alt+Shift+B` · `Cmd+Alt+Shift+B` | Arm **sticky broadcast** to all Operator panes in tab |
| `?` *(in empty Operator composer)* | Toggle composer submit between **Shell (`Cmd`)** and **AI (`AI`)** |
| `Ctrl+Enter` *(after failed command)* | Ask AI about the last non-zero exit command (requires OSC 133 + AI enabled) |
| `Ctrl+Shift+C` · `Cmd+Shift+C` | Copy terminal selection to clipboard |
| `Ctrl+Shift+V` · `Cmd+Shift+V` | Paste from clipboard (with safe-paste guard) |
| `Ctrl+Shift+F` · `Cmd+Shift+F` | Find in terminal buffer (supports Match Case, Whole Word, Regex) |
| `Ctrl+Click` · `Cmd+Click` | Open URL or local file path under cursor |
| `Alt+O` | Toggle **Ops Rail** (Runs / AI / Agent) |
| `Alt+Up` / `Alt+Down` / `Alt+Enter` | Navigate & jump to entries in the Ops Rail command log |
| `Ctrl+H` · `Cmd+H` | Refresh command history & runtime metrics |
| `Ctrl+Shift+E` · `Cmd+Shift+E` | AI explain latest command |

---

## Privacy & Local Data Storage

- **No account required** for the terminal, shell integration, CLI agent HUD, or BYOK/local AI.
- **API keys live in the OS keychain** (Windows Credential Manager, macOS Keychain, Linux Secret Service via `keyring`) — never in plaintext config files.
- **No telemetry by default** — structured `tracing` logs stay local unless you explicitly set `OTEL_EXPORTER_OTLP_ENDPOINT`.
- **Graceful corruption recovery** — if a JSON state file is ever corrupted, Mach Terminal backs it up as `<name>.corrupt-<timestamp>.json` and recovers cleanly instead of crashing or silently wiping your history.

### Config Directory Locations

| OS | Path |
| --- | --- |
| **Windows** | `%APPDATA%\com.machbox.terminal\` |
| **macOS** | `~/Library/Application Support/com.machbox.terminal/` |
| **Linux** | `~/.config/com.machbox.terminal/` |

Files stored in the config directory:
- `settings.json` — terminal profile, saved shell presets, provider endpoints/models, shell integration preferences.
- `workspace_layout.json` — persisted tab groups, binary split trees, session restore descriptors (`shell`, `args`, `cwd`, custom tab `name`, `chatKey`).
- `command_history.json` — local command history (up to 3,000 entries; override path with `MACH_TERMINAL_HISTORY_DIR`).

---

## Development & Verification

> **Note on Windows:** Close any running instance of Mach Terminal before running `cargo test` or `npm test` so the binary isn't locked by the OS.

```bash
# Fast frontend checks
npm run test:types          # TypeScript typecheck (tsc --noEmit)
npm run test:ux             # Full Vitest unit + component test suite (500+ tests)
npm run test:ux:smoke       # UX interaction & accessibility smoke suite

# Rust backend checks
npm run test:pty            # Rust unit + integration tests (cargo test --tests)
npm run test:perf           # Release-mode PTY byte pipeline throughput gate (>= 100 MiB/s floor)
npm run test:invoke:smoke   # Shell integration IPC wire-shape contract check

# Full pre-PR gate (runs test:types + test:ux + test:perf + test:pty)
npm test

# Production desktop bundle
npm run release:build       # Verifies version sync, builds Vite frontend, and bundles Tauri installer

# Security audit
npm run security:baseline   # npm audit + cargo audit
```

Before opening a pull request, read [`CONTRIBUTING.md`](CONTRIBUTING.md) and [`PRINCIPLES.md`](PRINCIPLES.md). Every commit requires a DCO sign-off (`git commit -s`).

---

## Architecture Overview

```text
mach-terminal/
├── src/                    # React 19 + TypeScript frontend (Vite)
│   ├── components/         # UI surfaces (TerminalSurface, GroupComposer, PaneLayout, OpsRail, AgentPromptBar, ...)
│   ├── core/               # Pure unit-tested logic + single IPC bridge (src/core/terminal.ts)
│   ├── hooks/              # PTY stream, session boot, workspace focus, group composer, provider AI hooks
│   └── state/              # Workspace reducer, binary split tree, external scrollback store, session registry
├── src-tauri/              # Rust backend (Tauri v2)
│   ├── src/                # session_manager (portable-pty), osc7/osc133, shell_detect, agent_inspect,
│   │                       # provider_host (reqwest), provider_secrets (keyring), settings, workspace_store
│   └── tests/              # Integration tests (PTY lifecycle, persistence recovery, provider host, IPC wire shape)
├── scripts/                # Dev cleanup, burn-in gates, stability signoff, release signing helpers
└── docs/                   # Runtime contracts, shell integration snippets, deep-link spec, QA checklists
```

---

## Documentation Index

| Document | Contents |
| --- | --- |
| [`PRINCIPLES.md`](PRINCIPLES.md) | Non-negotiable product & architecture constraints (local-first, AI-optional, open-core split) |
| [`CONTRIBUTING.md`](CONTRIBUTING.md) | Development workflow, PR gates, commit format, and DCO sign-off |
| [`docs/runtime-contracts.md`](docs/runtime-contracts.md) | IPC commands, raw-bytes PTY channel framing, events, persistence schemas, and safety rules |
| [`docs/shell-integration.md`](docs/shell-integration.md) | Manual OSC 7 / OSC 133 hook snippets for `pwsh`, `bash`, `zsh`, and `fish` |
| [`docs/deep-link-contract.md`](docs/deep-link-contract.md) | `machterm://ai-note` and `machterm://composer` URL schemes and safety guarantees |
| [`docs/manual-qa.md`](docs/manual-qa.md) | Manual dogfood & cross-platform QA checklist |
| [`docs/signing-setup.md`](docs/signing-setup.md) | Tauri updater keypair & OS code-signing setup |
| [`RELEASING.md`](RELEASING.md) | Release tagging, promotion workflow, and CI gates |
| [`SECURITY.md`](SECURITY.md) | Vulnerability reporting policy |
| [`CHANGELOG.md`](CHANGELOG.md) | Release history and shipped changes |
