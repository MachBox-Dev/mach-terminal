/**
 * MachTerm Native AI Coding Agent CLI TUI adaptation engine.
 *
 * Detects when an interactive AI coding agent CLI (Antigravity `agy`, Claude Code `claude`,
 * OpenAI Codex `codex`, Gemini CLI `gemini`, Aider `aider`, OpenCode `opencode`, Cursor `cursor-agent`,
 * Goose `goose`, Sourcegraph Amp `amp`, GitHub Copilot `copilot`, etc.) is active in a PTY session,
 * surfaces its slash commands & workflows, tracks live tool activity, and extracts interactive
 * prompt questions so MachTerm can render native one-click response buttons.
 */

export type AgentCliId =
  | "agy"
  | "claude"
  | "codex"
  | "gemini"
  | "aider"
  | "opencode"
  | "cursor"
  | "goose"
  | "amp"
  | "copilot";

export type AgentCommandCategory = "workflow" | "context" | "session" | "model" | "config" | "discovered";

export interface AgentSlashCommand {
  /** Slash command or key chord, e.g. `/plan` or `/goal`. */
  command: string;
  /** Short human label, e.g. `Plan`. */
  label: string;
  /** Concise explanation shown in the Agent rail and autocomplete. */
  description: string;
  /** Grouping category in the Agent rail. */
  category: AgentCommandCategory;
  /** When true, clicking the command can submit it immediately; when false, populates composer draft. */
  submitImmediately: boolean;
  /** Optional placeholder hint when the command expects arguments (e.g. `<goal description>`). */
  argHint?: string;
}

export interface AgentCliProfile {
  id: AgentCliId;
  name: string;
  shortLabel: string;
  /** Default command used to launch this agent in the terminal. */
  launchCommand: string;
  /** CSS accent color token/hex used for badges and rail highlights. */
  accentColor: string;
  /** Executable names or package invocations that identify this agent on launch. */
  executables: readonly string[];
  /** Built-in slash commands and workflows supported by this agent. */
  slashCommands: readonly AgentSlashCommand[];
}

export interface AgentPromptOption {
  id: string;
  label: string;
  /** Exact payload written to the PTY when clicked (e.g. `"y\r"`, `"1\r"`, `"\x1b"`). */
  payload: string;
  /** Visual style hint for the button. */
  variant: "primary" | "secondary" | "danger" | "ghost";
  /** True when the agent marked this option as `(Recommended)` or default (`[Y/n]`). */
  recommended?: boolean;
  /** Keyboard shortcut hint displayed on the button (e.g. `y`, `1`, `Esc`). */
  keyHint?: string;
}

export type AgentPromptQuestionKind = "confirmation" | "multi_choice" | "plan_proceed";

export interface AgentPromptQuestion {
  id: string;
  kind: AgentPromptQuestionKind;
  /** Extracted question or tool-approval prompt text. */
  promptText: string;
  /** Actionable buttons rendered in the inline AgentPromptBar and AgentRailPanel. */
  options: AgentPromptOption[];
  detectedAtMs: number;
}

export interface AgentActivityEntry {
  id: string;
  kind: "tool" | "command" | "subagent" | "status";
  summary: string;
  atMs: number;
}

export type AgentDetectionSource = "command" | "output" | "process" | "manual";

export type AgentRuntimeStatus = "idle" | "working" | "awaiting_prompt";

export interface AgentSessionState {
  sessionId: string;
  agentId: AgentCliId;
  detectedVia: AgentDetectionSource;
  /** True when manually pinned by the user so shell prompt heuristics won't auto-dismiss it. */
  pinned: boolean;
  /** True when the user clicked × on the inline AgentPromptBar to hide the bottom bar for now. */
  promptBarDismissed?: boolean;
  status: AgentRuntimeStatus;
  launchedCommand?: string;
  detectedAtMs: number;
  lastActivityAtMs: number;
  activeQuestion: AgentPromptQuestion | null;
  discoveredCommands: AgentSlashCommand[];
  recentActivities: AgentActivityEntry[];
}

export type SessionAgentMap = Record<string, AgentSessionState>;

export const AGENT_CLI_PROFILES: readonly AgentCliProfile[] = [
  {
    id: "agy",
    name: "Antigravity (agy)",
    shortLabel: "AGY",
    launchCommand: "agy",
    accentColor: "#00d4b8",
    executables: ["agy", "antigravity", "antigravity-cli", "agy.exe", "agy.cmd", "agy.ps1"],
    slashCommands: [
      {
        command: "/plan",
        label: "Plan",
        description: "Step-by-step planning before execution",
        category: "workflow",
        submitImmediately: true,
      },
      {
        command: "/grill-me",
        label: "Grill Me",
        description: "Interactive design interview to align on decisions",
        category: "workflow",
        submitImmediately: true,
      },
      {
        command: "/boost",
        label: "Boost",
        description: "Deep thinking, multi-perspective planning & verification",
        category: "workflow",
        submitImmediately: true,
      },
      {
        command: "/goal",
        label: "Goal",
        description: "Run a thorough long-running autonomous goal",
        category: "workflow",
        submitImmediately: false,
        argHint: "<goal description>",
      },
      {
        command: "/teamwork",
        label: "Teamwork",
        description: "Coordinate a team of autonomous subagents",
        category: "workflow",
        submitImmediately: true,
      },
      {
        command: "/compact",
        label: "Compact",
        description: "Summarize and compact context window",
        category: "context",
        submitImmediately: true,
      },
      {
        command: "/learn",
        label: "Learn",
        description: "Persist a workflow or correction for future tasks",
        category: "context",
        submitImmediately: true,
      },
      {
        command: "/browser",
        label: "Browser",
        description: "Open web browsing & UI interaction workflow",
        category: "workflow",
        submitImmediately: true,
      },
      {
        command: "/schedule",
        label: "Schedule",
        description: "Run an instruction on a recurring schedule or timer",
        category: "workflow",
        submitImmediately: false,
        argHint: "<schedule instruction>",
      },
      {
        command: "/model",
        label: "Model",
        description: "Switch active Gemini / Antigravity model",
        category: "model",
        submitImmediately: true,
      },
      {
        command: "/status",
        label: "Status",
        description: "Inspect workspace, subagents & background tasks",
        category: "session",
        submitImmediately: true,
      },
      {
        command: "/clear",
        label: "Clear",
        description: "Clear conversation context",
        category: "session",
        submitImmediately: true,
      },
      {
        command: "/help",
        label: "Help",
        description: "List all commands, skills, and shortcuts",
        category: "config",
        submitImmediately: true,
      },
      {
        command: "/exit",
        label: "Exit",
        description: "Exit Antigravity CLI",
        category: "session",
        submitImmediately: true,
      },
    ],
  },
  {
    id: "claude",
    name: "Claude Code",
    shortLabel: "CLAUDE",
    launchCommand: "claude",
    accentColor: "#f59e0b",
    executables: [
      "claude",
      "claude-code",
      "@anthropic-ai/claude-code",
      "claude.exe",
      "claude.cmd",
      "claude.ps1",
    ],
    slashCommands: [
      {
        command: "/compact",
        label: "Compact",
        description: "Compact conversation history with optional focus",
        category: "context",
        submitImmediately: true,
      },
      {
        command: "/review",
        label: "Review",
        description: "Request code review of current changes or PR",
        category: "workflow",
        submitImmediately: true,
      },
      {
        command: "/init",
        label: "Init CLAUDE.md",
        description: "Initialize project CLAUDE.md documentation",
        category: "workflow",
        submitImmediately: true,
      },
      {
        command: "/memory",
        label: "Memory",
        description: "Edit CLAUDE.md project or user memory",
        category: "context",
        submitImmediately: true,
      },
      {
        command: "/model",
        label: "Model",
        description: "Select Claude model (Sonnet, Opus, Haiku)",
        category: "model",
        submitImmediately: true,
      },
      {
        command: "/permissions",
        label: "Permissions",
        description: "View or update tool & shell execution rules",
        category: "config",
        submitImmediately: true,
      },
      {
        command: "/pr_comments",
        label: "PR Comments",
        description: "Fetch and address GitHub pull request review comments",
        category: "workflow",
        submitImmediately: true,
      },
      {
        command: "/cost",
        label: "Cost",
        description: "Show token usage and session cost",
        category: "session",
        submitImmediately: true,
      },
      {
        command: "/doctor",
        label: "Doctor",
        description: "Verify Claude Code installation & environment",
        category: "config",
        submitImmediately: true,
      },
      {
        command: "/vim",
        label: "Vim Mode",
        description: "Toggle Vim input bindings",
        category: "config",
        submitImmediately: true,
      },
      {
        command: "/clear",
        label: "Clear",
        description: "Clear conversation history",
        category: "session",
        submitImmediately: true,
      },
      {
        command: "/help",
        label: "Help",
        description: "List built-in and custom project slash commands",
        category: "config",
        submitImmediately: true,
      },
      {
        command: "/exit",
        label: "Exit",
        description: "Exit Claude Code",
        category: "session",
        submitImmediately: true,
      },
    ],
  },
  {
    id: "codex",
    name: "OpenAI Codex",
    shortLabel: "CODEX",
    launchCommand: "codex",
    accentColor: "#10b981",
    executables: ["codex", "@openai/codex", "codex.exe", "codex.cmd", "codex.ps1"],
    slashCommands: [
      {
        command: "/mode",
        label: "Mode",
        description: "Switch approval mode (suggest / auto-edit / full-auto)",
        category: "config",
        submitImmediately: true,
      },
      {
        command: "/approval",
        label: "Approval Policy",
        description: "Configure command & file write approval policy",
        category: "config",
        submitImmediately: true,
      },
      {
        command: "/model",
        label: "Model",
        description: "Switch OpenAI reasoning model",
        category: "model",
        submitImmediately: true,
      },
      {
        command: "/diff",
        label: "Diff",
        description: "Inspect working tree diff from current session",
        category: "workflow",
        submitImmediately: true,
      },
      {
        command: "/undo",
        label: "Undo",
        description: "Revert last agent change",
        category: "workflow",
        submitImmediately: true,
      },
      {
        command: "/compact",
        label: "Compact",
        description: "Summarize conversation context",
        category: "context",
        submitImmediately: true,
      },
      {
        command: "/clear",
        label: "Clear",
        description: "Clear session context",
        category: "session",
        submitImmediately: true,
      },
      {
        command: "/help",
        label: "Help",
        description: "Show Codex CLI commands",
        category: "config",
        submitImmediately: true,
      },
      {
        command: "/exit",
        label: "Exit",
        description: "Exit Codex CLI",
        category: "session",
        submitImmediately: true,
      },
    ],
  },
  {
    id: "gemini",
    name: "Gemini CLI",
    shortLabel: "GEMINI",
    launchCommand: "gemini",
    accentColor: "#60a5fa",
    executables: ["gemini", "@google/gemini-cli", "gemini.exe", "gemini.cmd", "gemini.ps1"],
    slashCommands: [
      {
        command: "/memory",
        label: "Memory",
        description: "Inspect or reload GEMINI.md context",
        category: "context",
        submitImmediately: true,
      },
      {
        command: "/tools",
        label: "Tools",
        description: "List enabled Gemini CLI tools",
        category: "config",
        submitImmediately: true,
      },
      {
        command: "/mcp",
        label: "MCP Servers",
        description: "Inspect connected Model Context Protocol servers",
        category: "config",
        submitImmediately: true,
      },
      {
        command: "/compress",
        label: "Compress",
        description: "Compress chat history into a compact summary",
        category: "context",
        submitImmediately: true,
      },
      {
        command: "/stats",
        label: "Stats",
        description: "Display token usage and session metrics",
        category: "session",
        submitImmediately: true,
      },
      {
        command: "/chat",
        label: "Chat Checkpoint",
        description: "Save or resume a conversation checkpoint",
        category: "session",
        submitImmediately: false,
        argHint: "save|resume <tag>",
      },
      {
        command: "/clear",
        label: "Clear",
        description: "Clear screen and conversation state",
        category: "session",
        submitImmediately: true,
      },
      {
        command: "/help",
        label: "Help",
        description: "Show Gemini CLI help",
        category: "config",
        submitImmediately: true,
      },
      {
        command: "/quit",
        label: "Quit",
        description: "Exit Gemini CLI",
        category: "session",
        submitImmediately: true,
      },
    ],
  },
  {
    id: "aider",
    name: "Aider",
    shortLabel: "AIDER",
    launchCommand: "aider",
    accentColor: "#34d399",
    executables: ["aider", "aider-chat", "aider.exe", "aider.cmd"],
    slashCommands: [
      {
        command: "/architect",
        label: "Architect",
        description: "Plan and edit using architect/editor dual-model mode",
        category: "workflow",
        submitImmediately: false,
        argHint: "<request>",
      },
      {
        command: "/ask",
        label: "Ask",
        description: "Ask about the codebase without modifying files",
        category: "workflow",
        submitImmediately: false,
        argHint: "<question>",
      },
      {
        command: "/code",
        label: "Code",
        description: "Request direct code edits",
        category: "workflow",
        submitImmediately: false,
        argHint: "<instruction>",
      },
      {
        command: "/add",
        label: "Add Files",
        description: "Add files to the active Aider chat",
        category: "context",
        submitImmediately: false,
        argHint: "<file...>",
      },
      {
        command: "/drop",
        label: "Drop Files",
        description: "Remove files from the active Aider chat",
        category: "context",
        submitImmediately: false,
        argHint: "<file...>",
      },
      {
        command: "/diff",
        label: "Diff",
        description: "Show git diff of changes from last turn",
        category: "workflow",
        submitImmediately: true,
      },
      {
        command: "/undo",
        label: "Undo",
        description: "Undo the last Aider git commit",
        category: "workflow",
        submitImmediately: true,
      },
      {
        command: "/commit",
        label: "Commit",
        description: "Commit pending edits with an AI commit message",
        category: "workflow",
        submitImmediately: true,
      },
      {
        command: "/test",
        label: "Run Test",
        description: "Run test command and share failures with Aider",
        category: "workflow",
        submitImmediately: false,
        argHint: "<command>",
      },
      {
        command: "/tokens",
        label: "Tokens",
        description: "Report context token breakdown",
        category: "session",
        submitImmediately: true,
      },
      {
        command: "/map",
        label: "Repo Map",
        description: "Print the current repository symbol map",
        category: "context",
        submitImmediately: true,
      },
      {
        command: "/clear",
        label: "Clear",
        description: "Clear chat message history",
        category: "session",
        submitImmediately: true,
      },
      {
        command: "/help",
        label: "Help",
        description: "List Aider slash commands",
        category: "config",
        submitImmediately: true,
      },
      {
        command: "/exit",
        label: "Exit",
        description: "Exit Aider",
        category: "session",
        submitImmediately: true,
      },
    ],
  },
  {
    id: "opencode",
    name: "OpenCode",
    shortLabel: "OPENCODE",
    launchCommand: "opencode",
    accentColor: "#a78bfa",
    executables: ["opencode", "opencode-ai", "opencode.exe", "opencode.cmd", "opencode.ps1"],
    slashCommands: [
      {
        command: "/init",
        label: "Init AGENTS.md",
        description: "Analyze repository and generate AGENTS.md",
        category: "workflow",
        submitImmediately: true,
      },
      {
        command: "/compact",
        label: "Compact",
        description: "Compact current session history",
        category: "context",
        submitImmediately: true,
      },
      {
        command: "/models",
        label: "Models",
        description: "Switch provider and model",
        category: "model",
        submitImmediately: true,
      },
      {
        command: "/sessions",
        label: "Sessions",
        description: "List and switch OpenCode sessions",
        category: "session",
        submitImmediately: true,
      },
      {
        command: "/new",
        label: "New Session",
        description: "Start a fresh OpenCode session",
        category: "session",
        submitImmediately: true,
      },
      {
        command: "/undo",
        label: "Undo",
        description: "Undo last message and file modifications",
        category: "workflow",
        submitImmediately: true,
      },
      {
        command: "/redo",
        label: "Redo",
        description: "Redo undone changes",
        category: "workflow",
        submitImmediately: true,
      },
      {
        command: "/share",
        label: "Share",
        description: "Create a shareable link for this session",
        category: "session",
        submitImmediately: true,
      },
      {
        command: "/help",
        label: "Help",
        description: "Show OpenCode commands and keybindings",
        category: "config",
        submitImmediately: true,
      },
      {
        command: "/exit",
        label: "Exit",
        description: "Exit OpenCode",
        category: "session",
        submitImmediately: true,
      },
    ],
  },
  {
    id: "cursor",
    name: "Cursor Agent",
    shortLabel: "CURSOR",
    launchCommand: "cursor-agent",
    accentColor: "#38bdf8",
    executables: ["cursor-agent", "cursor-cli", "cursor-agent.exe", "cursor-agent.cmd", "cursor-agent.ps1"],
    slashCommands: [
      {
        command: "/plan",
        label: "Plan Mode",
        description: "Switch to interactive planning mode",
        category: "workflow",
        submitImmediately: true,
      },
      {
        command: "/agent",
        label: "Agent Mode",
        description: "Switch to autonomous coding agent mode",
        category: "workflow",
        submitImmediately: true,
      },
      {
        command: "/ask",
        label: "Ask Mode",
        description: "Switch to read-only codebase Q&A mode",
        category: "workflow",
        submitImmediately: true,
      },
      {
        command: "/review",
        label: "Review",
        description: "Review working tree changes",
        category: "workflow",
        submitImmediately: true,
      },
      {
        command: "/model",
        label: "Model",
        description: "Select active Cursor model",
        category: "model",
        submitImmediately: true,
      },
      {
        command: "/compact",
        label: "Compact",
        description: "Compact conversation context",
        category: "context",
        submitImmediately: true,
      },
      {
        command: "/clear",
        label: "Clear",
        description: "Start a new conversation",
        category: "session",
        submitImmediately: true,
      },
      {
        command: "/help",
        label: "Help",
        description: "List Cursor Agent CLI commands",
        category: "config",
        submitImmediately: true,
      },
      {
        command: "/exit",
        label: "Exit",
        description: "Exit Cursor Agent CLI",
        category: "session",
        submitImmediately: true,
      },
    ],
  },
  {
    id: "goose",
    name: "Block Goose",
    shortLabel: "GOOSE",
    launchCommand: "goose",
    accentColor: "#fb923c",
    executables: ["goose", "goose.exe", "goose.cmd"],
    slashCommands: [
      {
        command: "/plan",
        label: "Plan",
        description: "Generate an action plan",
        category: "workflow",
        submitImmediately: true,
      },
      {
        command: "/mode",
        label: "Mode",
        description: "Switch Goose autonomy mode",
        category: "config",
        submitImmediately: true,
      },
      {
        command: "/prompts",
        label: "Prompts",
        description: "Browse available prompt templates",
        category: "workflow",
        submitImmediately: true,
      },
      {
        command: "/extension",
        label: "Extensions",
        description: "Manage MCP tool extensions",
        category: "config",
        submitImmediately: true,
      },
      {
        command: "/clear",
        label: "Clear",
        description: "Clear session context",
        category: "session",
        submitImmediately: true,
      },
      {
        command: "/help",
        label: "Help",
        description: "Show Goose CLI commands",
        category: "config",
        submitImmediately: true,
      },
      {
        command: "/exit",
        label: "Exit",
        description: "Exit Goose CLI",
        category: "session",
        submitImmediately: true,
      },
    ],
  },
  {
    id: "amp",
    name: "Sourcegraph Amp",
    shortLabel: "AMP",
    launchCommand: "amp",
    accentColor: "#f43f5e",
    executables: ["amp", "@sourcegraph/amp", "amp.exe", "amp.cmd"],
    slashCommands: [
      {
        command: "/compact",
        label: "Compact",
        description: "Compact thread context",
        category: "context",
        submitImmediately: true,
      },
      {
        command: "/threads",
        label: "Threads",
        description: "Browse or switch Amp threads",
        category: "session",
        submitImmediately: true,
      },
      {
        command: "/tools",
        label: "Tools",
        description: "Inspect enabled tools and MCP servers",
        category: "config",
        submitImmediately: true,
      },
      {
        command: "/permissions",
        label: "Permissions",
        description: "Configure tool permissions",
        category: "config",
        submitImmediately: true,
      },
      {
        command: "/model",
        label: "Model",
        description: "Switch model",
        category: "model",
        submitImmediately: true,
      },
      {
        command: "/help",
        label: "Help",
        description: "Show Amp commands",
        category: "config",
        submitImmediately: true,
      },
      {
        command: "/exit",
        label: "Exit",
        description: "Exit Amp",
        category: "session",
        submitImmediately: true,
      },
    ],
  },
  {
    id: "copilot",
    name: "GitHub Copilot CLI",
    shortLabel: "COPILOT",
    launchCommand: "copilot",
    accentColor: "#818cf8",
    executables: ["copilot", "github-copilot-cli", "copilot.exe", "copilot.cmd"],
    slashCommands: [
      {
        command: "/explain",
        label: "Explain",
        description: "Explain a command or code snippet",
        category: "workflow",
        submitImmediately: false,
        argHint: "<command>",
      },
      {
        command: "/suggest",
        label: "Suggest",
        description: "Suggest a shell or git command",
        category: "workflow",
        submitImmediately: false,
        argHint: "<intent>",
      },
      {
        command: "/model",
        label: "Model",
        description: "Select Copilot model",
        category: "model",
        submitImmediately: true,
      },
      {
        command: "/clear",
        label: "Clear",
        description: "Clear current Copilot session",
        category: "session",
        submitImmediately: true,
      },
      {
        command: "/help",
        label: "Help",
        description: "Show Copilot CLI help",
        category: "config",
        submitImmediately: true,
      },
      {
        command: "/exit",
        label: "Exit",
        description: "Exit Copilot CLI",
        category: "session",
        submitImmediately: true,
      },
    ],
  },
];

const PROFILE_BY_ID: Record<AgentCliId, AgentCliProfile> = AGENT_CLI_PROFILES.reduce(
  (acc, profile) => {
    acc[profile.id] = profile;
    return acc;
  },
  {} as Record<AgentCliId, AgentCliProfile>,
);

export function getAgentCliProfile(id: AgentCliId): AgentCliProfile {
  return PROFILE_BY_ID[id];
}

/** Strip ANSI CSI, OSC, and control sequences so TUI output can be inspected reliably. */
export function stripAnsiSequences(raw: string): string {
  return raw
    // OSC sequences: ESC ] ... (BEL or ESC \)
    .replace(/\x1b\][\s\S]*?(?:\x07|\x1b\\)/g, "")
    // Cursor row positioning / screen clear sequences in full-screen TUIs -> newline
    .replace(/\x1b\[(?:\d+;?\d*[Hf]|\d*[BEd]|2J)/g, "\n")
    // Cursor forward movement -> space
    .replace(/\x1b\[\d*C/g, " ")
    // Remaining CSI sequences: ESC [ ... final byte
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "")
    // Single-char ESC sequences
    .replace(/\x1b[@-_]/g, "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n");
}

const SHELL_WRAPPERS = new Set([
  "sudo",
  "env",
  "npx",
  "pnpx",
  "bunx",
  "uvx",
  "pipx",
  " poetry",
  "dotenv",
  "cross-env",
]);

const SUBCOMMAND_NON_INTERACTIVE_FLAGS = new Set([
  "--version",
  "-v",
  "-V",
  "--help",
  "-h",
  "help",
  "version",
  "update",
  "upgrade",
  "install",
  "uninstall",
  "auth",
  "login",
  "logout",
]);

function normalizeTokenExecutable(token: string): string {
  const unquoted = token.replace(/^['"]+|['"]+$/g, "").trim();
  const parts = unquoted.split(/[/\\]/);
  return (parts[parts.length - 1] ?? unquoted).toLowerCase();
}

/**
 * Detect whether a submitted command line launches an interactive AI coding agent CLI.
 * Ignores one-shot version/help/install invocations (e.g. `agy --version`, `claude --help`).
 */
export function detectAgentFromCommandLine(commandLine: string): AgentCliProfile | null {
  const trimmed = commandLine.trim();
  if (!trimmed || trimmed.startsWith("#")) {
    return null;
  }

  // Split chained shell commands (`cd foo && agy`) and inspect the last segment.
  const segments = trimmed
    .split(/(?:&&|\|\||;)/)
    .map((s) => s.trim())
    .filter(Boolean);
  const lastSegment = segments[segments.length - 1];
  if (!lastSegment) {
    return null;
  }

  const rawTokens = lastSegment.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g);
  if (!rawTokens || rawTokens.length === 0) {
    return null;
  }

  // Skip leading `KEY=VALUE` env assignments and wrapper runners (`npx`, `bunx`, `uvx`, `sudo`).
  let idx = 0;
  while (idx < rawTokens.length) {
    const tok = rawTokens[idx]!;
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(tok)) {
      idx += 1;
      continue;
    }
    const norm = normalizeTokenExecutable(tok);
    if (SHELL_WRAPPERS.has(norm)) {
      idx += 1;
      // Skip wrapper flags like `npx -y` or `uvx --from ...`
      while (idx < rawTokens.length && rawTokens[idx]!.startsWith("-")) {
        idx += 1;
      }
      continue;
    }
    break;
  }

  if (idx >= rawTokens.length) {
    return null;
  }

  const primaryToken = rawTokens[idx]!.replace(/^['"]+|['"]+$/g, "");
  const primaryNorm = normalizeTokenExecutable(primaryToken);
  const restArgs = rawTokens.slice(idx + 1).map((t) => t.replace(/^['"]+|['"]+$/g, ""));

  // Check `gh copilot` two-word invocation
  if ((primaryNorm === "gh" || primaryNorm === "gh.exe") && restArgs[0]?.toLowerCase() === "copilot") {
    const afterCopilot = restArgs.slice(1);
    if (afterCopilot.some((arg) => SUBCOMMAND_NON_INTERACTIVE_FLAGS.has(arg.toLowerCase()))) {
      return null;
    }
    return PROFILE_BY_ID.copilot;
  }

  // Ignore one-shot flags like `--version`, `--help`, `-p` (print mode)
  if (
    restArgs.some(
      (arg) =>
        SUBCOMMAND_NON_INTERACTIVE_FLAGS.has(arg.toLowerCase()) ||
        arg === "-p" ||
        arg === "--print",
    )
  ) {
    return null;
  }

  for (const profile of AGENT_CLI_PROFILES) {
    const matches = profile.executables.some((exe) => {
      const exeLower = exe.toLowerCase();
      return primaryNorm === exeLower || primaryToken.toLowerCase() === exeLower;
    });
    if (matches) {
      return profile;
    }
  }

  return null;
}

const OUTPUT_BANNER_SIGNATURES: ReadonlyArray<{ id: AgentCliId; pattern: RegExp }> = [
  { id: "agy", pattern: /\b(?:Antigravity\s+CLI\s+v?\d+\.\d+|Welcome\s+to\s+Antigravity|\bagy\s+v\d+\.\d+)/i },
  { id: "claude", pattern: /(?:Claude\s+Code\s+v?\d+\.\d+|Welcome\s+to\s+Claude\s+Code|✻\s+Welcome\s+to\s+Claude)/i },
  { id: "codex", pattern: /(?:^\s*OpenAI\s+Codex\b|\bcodex(?:\s+CLI)?\s+v\d+\.\d+)/im },
  { id: "gemini", pattern: /\b(?:Gemini\s+CLI\s+v?\d+\.\d+|Welcome\s+to\s+Gemini\s+CLI)/i },
  { id: "aider", pattern: /\b(?:Aider\s+v\d+\.\d+\.\d+|aider\s+is\s+waiting\s+for\s+your\s+input)/i },
  { id: "opencode", pattern: /\b(?:opencode\s+v\d+\.\d+|Welcome\s+to\s+OpenCode)/i },
  { id: "cursor", pattern: /\b(?:Cursor\s+Agent\s+CLI\s+v?\d+|Welcome\s+to\s+Cursor\s+Agent)/i },
  { id: "goose", pattern: /\b(?:starting\s+goose\s+session|Goose\s+is\s+ready)/i },
  { id: "amp", pattern: /\b(?:Sourcegraph\s+Amp\s+v?\d+|Welcome\s+to\s+Amp\b)/i },
  { id: "copilot", pattern: /\b(?:GitHub\s+Copilot\s+CLI\s+v?\d+|Welcome\s+to\s+GitHub\s+Copilot)/i },
];

/**
 * Inspect stripped PTY output for unmistakable startup banners of AI coding agent TUIs.
 */
export function detectAgentFromOutputChunk(cleanOutput: string): AgentCliProfile | null {
  for (const sig of OUTPUT_BANNER_SIGNATURES) {
    if (sig.pattern.test(cleanOutput)) {
      return PROFILE_BY_ID[sig.id];
    }
  }
  return null;
}

/**
 * Detect whether a submitted input while an agent is active is an agent-exit command.
 */
export function isAgentExitCommand(input: string): boolean {
  const normalized = input.trim().toLowerCase();
  return (
    normalized === "/exit" ||
    normalized === "/quit" ||
    normalized === "/q" ||
    normalized === "exit" ||
    normalized === "quit"
  );
}

/**
 * Detect whether a raw PTY output chunk indicates that an interactive TUI agent
 * has exited and returned control to the underlying shell.
 */
export function hasAgentExitOutputSignal(rawChunk: string, cleanOutput?: string): boolean {
  // 1. Alternate Screen Buffer exit (`CSI ? 1049 l`, `CSI ? 1047 l`, `CSI ? 47 l`)
  //    without re-entering alternate screen after it in the same chunk.
  const lastAltLeave = Math.max(
    rawChunk.lastIndexOf("\x1b[?1049l"),
    rawChunk.lastIndexOf("\x1b[?1047l"),
    rawChunk.lastIndexOf("\x1b[?47l"),
  );
  const lastAltEnter = Math.max(
    rawChunk.lastIndexOf("\x1b[?1049h"),
    rawChunk.lastIndexOf("\x1b[?1047h"),
    rawChunk.lastIndexOf("\x1b[?47h"),
  );
  if (lastAltLeave !== -1 && lastAltLeave > lastAltEnter) {
    return true;
  }

  // 2. Shell prompt return (PowerShell `PS C:\...>`, OSC 133 prompt start `]133;A`)
  if (rawChunk.includes("\x1b]133;A") || rawChunk.includes("\x1b]133;D")) {
    return true;
  }

  const clean = cleanOutput ?? stripAnsiSequences(rawChunk);
  const lines = clean
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  const lastLine = lines[lines.length - 1] ?? "";
  if (/^PS (?:[A-Za-z]:\\|[~\/])[^>\n]{0,140}>\s*$/.test(lastLine)) {
    return true;
  }
  return false;
}

/**
 * Parse interactive questions, tool approval prompts, or numbered multiple-choice menus
 * from the trailing lines of an active agent's terminal output.
 */
export function detectAgentPromptQuestion(cleanOutput: string, nowMs = Date.now()): AgentPromptQuestion | null {
  const lines = cleanOutput
    .split("\n")
    .map((line) =>
      line
        .replace(/[│╭╮╰╯─═┌┐└┘├┤┬┴┼▀▄█▌▐]/g, " ")
        .replace(/\?\s+for\s+shortcuts.*$/i, "")
        .replace(/\s+/g, " ")
        .trim(),
    )
    .filter((line) => line.length > 0 && !/^#{1,6}\s/.test(line));

  if (lines.length === 0) {
    return null;
  }

  const tailLines = lines.slice(-14);

  // 1. Check for numbered multiple-choice options (e.g. Claude Code / Antigravity / Codex menus):
  //    `❯ 1. Yes` / `2. Yes, and don't ask again` / `3. No`
  //    or `1. (Recommended) Option A` / `2. Option B`
  //    or `[1] Option A` / `[2] Option B`
  const numberedOptionRegex = /^(?:[❯>*•→]\s*)?(?:\[(\d+)\]|(\d+)[.)])\s+(.+)$/;
  const numberedMatches: Array<{ lineIdx: number; num: string; text: string }> = [];

  for (let i = 0; i < tailLines.length; i++) {
    const match = tailLines[i]!.match(numberedOptionRegex);
    if (match) {
      const num = (match[1] ?? match[2])!;
      const text = match[3]!.trim();
      if (text.length > 0 && text.length <= 96) {
        numberedMatches.push({ lineIdx: i, num, text });
      }
    }
  }

  // Require at least 2 sequential numbered options starting at 1 (e.g., 1 and 2) near the end of output
  if (numberedMatches.length >= 2) {
    const firstOpt = numberedMatches[0]!;
    const lastOpt = numberedMatches[numberedMatches.length - 1]!;
    const startsAtOne = firstOpt.num === "1" && numberedMatches[1]?.num === "2";
    const nearBottom = tailLines.length - 1 - lastOpt.lineIdx <= 3;

    if (startsAtOne && nearBottom) {
      let promptText = "Agent is asking you to choose an option:";
      for (let j = firstOpt.lineIdx - 1; j >= 0; j--) {
        const candidate = tailLines[j]!;
        if (candidate.length >= 4 && candidate.length <= 160 && !numberedOptionRegex.test(candidate)) {
          promptText = candidate;
          break;
        }
      }

      const options: AgentPromptOption[] = numberedMatches.slice(0, 6).map((item, idx) => {
        const isRecommended = /\(recommended\)/i.test(item.text) || idx === 0;
        const cleanLabel = item.text.replace(/\(recommended\)\s*/i, "").trim();
        const isNegative = /^(?:no\b|cancel\b|deny\b|reject\b|abort\b)/i.test(cleanLabel);
        return {
          id: `opt-${item.num}`,
          label: `${item.num}. ${cleanLabel.length > 48 ? `${cleanLabel.slice(0, 45)}…` : cleanLabel}`,
          payload: `${item.num}\r`,
          variant: isNegative ? "danger" : isRecommended ? "primary" : "secondary",
          recommended: isRecommended,
          keyHint: item.num,
        };
      });

      options.push({
        id: "opt-esc",
        label: "Cancel",
        payload: "\x1b",
        variant: "ghost",
        keyHint: "Esc",
      });

      return {
        id: `q-multi-${nowMs}`,
        kind: "multi_choice",
        promptText,
        options,
        detectedAtMs: nowMs,
      };
    }
  }

  // 2. Check for Yes / No / Always confirmation prompts in the last 4 lines (only short prompt lines, never long prose)
  const recentTail = tailLines.slice(-4);
  for (let i = recentTail.length - 1; i >= 0; i--) {
    const line = recentTail[i]!;
    if (line.length > 160) {
      continue;
    }

    // Explicit [Y/n], [y/N], (y/n), (y/n/a), [y/n/a], (yes/no)
    const explicitYnBracket = /(?:\[(?:y\/n(?:\/a)?|yes\/no)\]|\((?:y\/n(?:\/a)?|yes\/no)\))/i.test(line);
    // Or a short line that starts with an explicit approval/question lead-in and ends with `?`
    const isApprovalQuestionLine =
      line.length <= 140 &&
      /\?(?:\s*(?:\[[^\]]+\]|\([^)]+\)))?$/.test(line) &&
      /^(?:[❯>?•✦!]\s*)?(?:allow|approve|do you want to|would you like to|proceed with|apply changes|run command|execute command|overwrite|create file|delete file)\b/i.test(
        line,
      );

    if (explicitYnBracket || isApprovalQuestionLine) {
      const hasAlways =
        /\b(?:y\/n\/a|always|\(a\)lways|\[a\]lways|don't ask again)\b/i.test(line) ||
        recentTail.some((l) => l.length <= 140 && /\b(?:always allow|\(a\)lways)\b/i.test(l));
      const defaultNo = /\[y\/N\]|\(y\/N\)/.test(line);

      const options: AgentPromptOption[] = [
        {
          id: "confirm-yes",
          label: "Yes / Approve",
          payload: "y\r",
          variant: defaultNo ? "secondary" : "primary",
          recommended: !defaultNo,
          keyHint: "y",
        },
      ];

      if (hasAlways) {
        options.push({
          id: "confirm-always",
          label: "Always Allow",
          payload: "a\r",
          variant: "secondary",
          keyHint: "a",
        });
      }

      options.push(
        {
          id: "confirm-no",
          label: "No / Deny",
          payload: "n\r",
          variant: defaultNo ? "primary" : "danger",
          recommended: defaultNo,
          keyHint: "n",
        },
        {
          id: "confirm-esc",
          label: "Cancel",
          payload: "\x1b",
          variant: "ghost",
          keyHint: "Esc",
        },
      );

      return {
        id: `q-confirm-${nowMs}`,
        kind: "confirmation",
        promptText: line,
        options,
        detectedAtMs: nowMs,
      };
    }

    // 3. Check for "Press Enter to continue" / "Proceed with plan?"
    if (
      line.length <= 140 &&
      /\b(?:press enter to (?:continue|proceed|confirm)|proceed with (?:the )?plan\?)/i.test(line)
    ) {
      return {
        id: `q-proceed-${nowMs}`,
        kind: "plan_proceed",
        promptText: line,
        options: [
          {
            id: "proceed-enter",
            label: "Proceed",
            payload: "\r",
            variant: "primary",
            recommended: true,
            keyHint: "Enter",
          },
          {
            id: "proceed-esc",
            label: "Cancel",
            payload: "\x1b",
            variant: "ghost",
            keyHint: "Esc",
          },
        ],
        detectedAtMs: nowMs,
      };
    }
  }

  return null;
}

/**
 * Dynamically discover slash commands printed in an agent's `/help` or startup output,
 * e.g. `  /my-skill   Run custom project skill`.
 */
export function extractDiscoveredSlashCommands(
  cleanOutput: string,
  existingBuiltins: readonly AgentSlashCommand[],
): AgentSlashCommand[] {
  const builtinSet = new Set(existingBuiltins.map((c) => c.command.toLowerCase()));
  const discovered: AgentSlashCommand[] = [];
  const seen = new Set<string>();

  const lines = cleanOutput.split("\n");
  // Match lines like `  /foo-bar   Description of foo-bar` or `• /foo-bar - Description`
  const slashLineRegex = /^\s*(?:[•*-]\s*)?(\/[a-zA-Z][a-zA-Z0-9_-]{1,28})(?:\s+<[^>]+>)?(?:\s+[-–:]\s+|\s{2,})(.{4,90})$/;

  for (const rawLine of lines) {
    const match = rawLine.trimEnd().match(slashLineRegex);
    if (!match) {
      continue;
    }
    const command = match[1]!.trim();
    const description = match[2]!.trim();
    const lower = command.toLowerCase();
    // Filter out file paths like `/usr/local/bin` or `/dev/null`
    if (builtinSet.has(lower) || seen.has(lower) || command.includes("/", 1)) {
      continue;
    }
    seen.add(lower);
    const rawName = command.slice(1).replace(/[-_]+/g, " ");
    const label = rawName.charAt(0).toUpperCase() + rawName.slice(1);
    discovered.push({
      command,
      label,
      description,
      category: "discovered",
      submitImmediately: true,
    });
  }

  return discovered;
}

/**
 * Extract recent tool calls / file edits / shell runs printed by the coding agent TUI.
 */
export function extractAgentActivities(cleanOutput: string, nowMs = Date.now()): AgentActivityEntry[] {
  const entries: AgentActivityEntry[] = [];
  const lines = cleanOutput
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  const toolRegex =
    /^(?:[⏺●✦⚡▸>]\s*)?(?:(Read|Write|Edit|MultiEdit|Bash|Run|Glob|Grep|LS|Task|Subagent|read_file|write_file|edit_file|run_command|invoke_subagent|search_web)\s*\(([^)\n]{1,80})\)|(?:Running|Executing|Reading|Editing)\s+`?([^\s`]{2,70})`?)/i;

  for (const line of lines.slice(-12)) {
    const match = line.match(toolRegex);
    if (!match) {
      continue;
    }
    const toolName = match[1];
    const toolArg = match[2];
    const actionTarget = match[3];
    const summary = toolName ? `${toolName}(${toolArg ?? ""})` : line.slice(0, 72);
    const kind: AgentActivityEntry["kind"] =
      toolName && /subagent|task/i.test(toolName)
        ? "subagent"
        : toolName && /bash|run/i.test(toolName)
          ? "command"
          : actionTarget
            ? "tool"
            : "tool";
    entries.push({
      id: `act-${nowMs}-${entries.length}`,
      kind,
      summary,
      atMs: nowMs,
    });
  }

  return entries;
}

export function createAgentSessionState(
  sessionId: string,
  profile: AgentCliProfile,
  detectedVia: AgentDetectionSource,
  options?: { launchedCommand?: string; pinned?: boolean; nowMs?: number },
): AgentSessionState {
  const now = options?.nowMs ?? Date.now();
  return {
    sessionId,
    agentId: profile.id,
    detectedVia,
    pinned: options?.pinned ?? false,
    status: "idle",
    launchedCommand: options?.launchedCommand,
    detectedAtMs: now,
    lastActivityAtMs: now,
    activeQuestion: null,
    discoveredCommands: [],
    recentActivities: [],
  };
}

/**
 * Merge all built-in + dynamically discovered slash commands for an active agent session.
 */
export function getAgentCommandsForSession(state: AgentSessionState | null | undefined): AgentSlashCommand[] {
  if (!state) {
    return [];
  }
  const profile = getAgentCliProfile(state.agentId);
  if (state.discoveredCommands.length === 0) {
    return [...profile.slashCommands];
  }
  const seen = new Set(profile.slashCommands.map((c) => c.command.toLowerCase()));
  const extras = state.discoveredCommands.filter((c) => !seen.has(c.command.toLowerCase()));
  return [...profile.slashCommands, ...extras];
}

/**
 * Filter agent slash commands when the user types a `/` prefix in the composer.
 */
export function matchAgentSlashCommands(
  draft: string,
  state: AgentSessionState | null | undefined,
): AgentSlashCommand[] {
  if (!state) {
    return [];
  }
  const trimmed = draft.trimStart();
  if (!trimmed.startsWith("/")) {
    return [];
  }
  // Only match while typing the first token (e.g. `/pl`)
  if (/\s/.test(trimmed)) {
    return [];
  }
  const query = trimmed.toLowerCase();
  const commands = getAgentCommandsForSession(state);
  return commands.filter(
    (cmd) =>
      cmd.command.toLowerCase().startsWith(query) ||
      cmd.label.toLowerCase().includes(query.slice(1)),
  );
}

const MAX_DISCOVERED_COMMANDS = 24;
const MAX_RECENT_ACTIVITIES = 20;

/**
 * Advance or create the `AgentSessionState` for a session given a new raw PTY output chunk.
 */
export function reduceAgentStateOnOutput(
  current: AgentSessionState | undefined,
  sessionId: string,
  rawChunk: string,
  nowMs = Date.now(),
): AgentSessionState | undefined {
  const clean = stripAnsiSequences(rawChunk);
  if (current && !current.pinned && hasAgentExitOutputSignal(rawChunk, clean)) {
    return undefined;
  }
  if (!clean.trim()) {
    return current;
  }

  let state = current;
  if (!state) {
    const detectedProfile = detectAgentFromOutputChunk(clean);
    if (!detectedProfile) {
      return undefined;
    }
    state = createAgentSessionState(sessionId, detectedProfile, "output", { nowMs });
  }

  const profile = getAgentCliProfile(state.agentId);
  const allBuiltins = [...profile.slashCommands, ...state.discoveredCommands];
  const newlyDiscovered = extractDiscoveredSlashCommands(clean, allBuiltins);
  const discoveredCommands =
    newlyDiscovered.length > 0
      ? [...state.discoveredCommands, ...newlyDiscovered].slice(-MAX_DISCOVERED_COMMANDS)
      : state.discoveredCommands;

  const newActivities = extractAgentActivities(clean, nowMs);
  const recentActivities =
    newActivities.length > 0
      ? [
          ...state.recentActivities,
          ...newActivities.filter(
            (entry) =>
              state!.recentActivities[state!.recentActivities.length - 1]?.summary !== entry.summary,
          ),
        ].slice(-MAX_RECENT_ACTIVITIES)
      : state.recentActivities;

  const detectedQuestion = detectAgentPromptQuestion(clean, nowMs);
  const tailLines = clean
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(-6);
  const tailText = tailLines.join("\n");

  const hasActiveSpinnerInBottomLines = /\b(?:Working\.{2,3}|Thinking\.{2,3}|Generating\.{2,3}|Analyzing\.{2,3})\b/i.test(
    tailLines.slice(-3).join("\n"),
  );
  const isIdlePromptSignal =
    !hasActiveSpinnerInBottomLines &&
    (/\?\s+for\s+shortcuts/i.test(tailText) || /(?:^|\n)\s*(?:[❯>]|codex>|aider>)\s*$/m.test(tailText));

  const isWorkingSignal =
    !isIdlePromptSignal &&
    (hasActiveSpinnerInBottomLines ||
      /\b(?:Thinking\s+for\s+\d+|^•\s+Explored\b)/im.test(tailText) ||
      newActivities.length > 0);

  const nextQuestion = detectedQuestion ?? (isIdlePromptSignal ? null : state.activeQuestion);
  const nextStatus: AgentRuntimeStatus = nextQuestion
    ? "awaiting_prompt"
    : isWorkingSignal
      ? "working"
      : isIdlePromptSignal
        ? "idle"
        : state.status;

  const nextPromptBarDismissed = detectedQuestion ? false : state.promptBarDismissed;

  if (
    state === current &&
    discoveredCommands === state.discoveredCommands &&
    recentActivities === state.recentActivities &&
    nextQuestion === state.activeQuestion &&
    nextStatus === state.status &&
    nextPromptBarDismissed === state.promptBarDismissed
  ) {
    return state;
  }

  return {
    ...state,
    status: nextStatus,
    promptBarDismissed: nextPromptBarDismissed,
    lastActivityAtMs: nowMs,
    activeQuestion: nextQuestion,
    discoveredCommands,
    recentActivities,
  };
}
