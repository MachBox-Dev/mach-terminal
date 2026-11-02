import { shouldClearAgentAfterNegativeProbe, shellExitRecipients } from "./agentTui";
import { describe, expect, it } from "vitest";
import {
  createAgentSessionState,
  detectAgentFromCommandLine,
  detectAgentFromOutputChunk,
  detectAgentPromptQuestion,
  extractAgentActivities,
  extractDiscoveredSlashCommands,
  getAgentCliProfile,
  isAgentExitCommand,
  matchAgentSlashCommands,
  reduceAgentStateOnOutput,
  stripAnsiSequences,
} from "./agentTui";

describe("agentTui detection & parsing", () => {
  it("detects major AI coding agent CLIs from command lines", () => {
    expect(detectAgentFromCommandLine("agy")?.id).toBe("agy");
    expect(detectAgentFromCommandLine("cd C:\\repo && agy --resume")?.id).toBe("agy");
    expect(detectAgentFromCommandLine("claude")?.id).toBe("claude");
    expect(detectAgentFromCommandLine("npx -y @anthropic-ai/claude-code")?.id).toBe("claude");
    expect(detectAgentFromCommandLine("OPENAI_API_KEY=sk-123 codex --full-auto")?.id).toBe("codex");
    expect(detectAgentFromCommandLine("gemini")?.id).toBe("gemini");
    expect(detectAgentFromCommandLine("aider --model sonnet")?.id).toBe("aider");
    expect(detectAgentFromCommandLine("opencode")?.id).toBe("opencode");
    expect(detectAgentFromCommandLine("cursor-agent")?.id).toBe("cursor");
    expect(detectAgentFromCommandLine("goose")?.id).toBe("goose");
    expect(detectAgentFromCommandLine("amp")?.id).toBe("amp");
    expect(detectAgentFromCommandLine("gh copilot")?.id).toBe("copilot");
  });

  it("ignores non-interactive --version, --help, and -p invocations", () => {
    expect(detectAgentFromCommandLine("agy --version")).toBeNull();
    expect(detectAgentFromCommandLine("claude --help")).toBeNull();
    expect(detectAgentFromCommandLine("claude -p 'explain this'")).toBeNull();
    expect(detectAgentFromCommandLine("git status")).toBeNull();
  });

  it("detects agent startup banners from ANSI-styled PTY output", () => {
    const ansiBanner = "\x1b[36m✦ Welcome to Antigravity CLI v2.0\x1b[0m\r\nType /help for commands.";
    const clean = stripAnsiSequences(ansiBanner);
    expect(detectAgentFromOutputChunk(clean)?.id).toBe("agy");

    const claudeBanner = "\x1b[33m✻ Welcome to Claude Code!\x1b[0m";
    expect(detectAgentFromOutputChunk(stripAnsiSequences(claudeBanner))?.id).toBe("claude");
  });

  it("extracts numbered multiple-choice prompt questions and builds clickable options", () => {
    const output = [
      "╭────────────────────────────────────────────────────────╮",
      "│ Which UI surfaces should adapt when an agent starts?   │",
      "│ ❯ 1. (Recommended) Dedicated 'Agent' tab in OpsRail    │",
      "│   2. Floating action bar above Composer                │",
      "│   3. No, cancel and ask me something else              │",
      "╰────────────────────────────────────────────────────────╯",
    ].join("\n");

    const question = detectAgentPromptQuestion(output, 1000);
    expect(question).not.toBeNull();
    expect(question?.kind).toBe("multi_choice");
    expect(question?.promptText).toContain("Which UI surfaces should adapt");
    expect(question?.options).toHaveLength(4); // 3 numbered + Cancel (Esc)
    expect(question?.options[0]).toMatchObject({
      label: "1. Dedicated 'Agent' tab in OpsRail",
      payload: "1\r",
      variant: "primary",
      recommended: true,
      keyHint: "1",
    });
    expect(question?.options[2]?.variant).toBe("danger");
    expect(question?.options[3]?.payload).toBe("\x1b");
  });

  it("extracts Yes / No / Always confirmation prompts", () => {
    const output = "Allow tool execution `npm test`? (y/n/a)";
    const question = detectAgentPromptQuestion(output, 2000);
    expect(question).not.toBeNull();
    expect(question?.kind).toBe("confirmation");
    expect(question?.options.map((o) => o.payload)).toEqual(["y\r", "a\r", "n\r", "\x1b"]);
  });

  it("discovers custom slash commands from agent output", () => {
    const agyProfile = getAgentCliProfile("agy");
    const helpOutput = [
      "Available commands:",
      "  /plan          Step-by-step planning",
      "  /deploy-prod   Deploy current release to production cluster",
      "  /sync-linear   Sync audit issues to Linear workspace",
    ].join("\n");

    const discovered = extractDiscoveredSlashCommands(helpOutput, agyProfile.slashCommands);
    expect(discovered.map((c) => c.command)).toEqual(["/deploy-prod", "/sync-linear"]);
    expect(discovered[0]?.category).toBe("discovered");
  });

  it("extracts live tool calls and subagent activities", () => {
    const chunk = [
      "⏺ Read(src/App.tsx)",
      "⏺ Edit(src/core/agentTui.ts)",
      "⏺ invoke_subagent(Codebase Researcher)",
    ].join("\n");
    const acts = extractAgentActivities(chunk, 3000);
    expect(acts).toHaveLength(3);
    expect(acts[0]?.summary).toBe("Read(src/App.tsx)");
    expect(acts[2]?.kind).toBe("subagent");
  });

  it("matches slash commands in composer draft", () => {
    const state = createAgentSessionState("session-1", getAgentCliProfile("agy"), "command");
    const matches = matchAgentSlashCommands("/gr", state);
    expect(matches.map((m) => m.command)).toEqual(["/grill-me"]);
  });

  it("reduces output chunks into AgentSessionState", () => {
    const next = reduceAgentStateOnOutput(
      undefined,
      "session-1",
      "\x1b[32mWelcome to Antigravity\x1b[0m\n  /custom-flow   Run custom project flow\nDo you want to proceed? [Y/n]",
      5000,
    );
    expect(next).toBeDefined();
    expect(next?.agentId).toBe("agy");
    expect(next?.status).toBe("awaiting_prompt");
    expect(next?.activeQuestion?.kind).toBe("confirmation");
    expect(next?.discoveredCommands.map((c) => c.command)).toEqual(["/custom-flow"]);
  });

  it("recognizes agent exit commands", () => {
    expect(isAgentExitCommand("/exit")).toBe(true);
    expect(isAgentExitCommand("/quit")).toBe(true);
    expect(isAgentExitCommand("exit")).toBe(true);
    expect(isAgentExitCommand("/plan")).toBe(false);
  });

  it("does not misdetect Codex or trigger false-positive approval prompt on full-screen agy README redraws", () => {
    const fullScreenRedraw = [
      "\x1b[1;1H> view the readme and summarize",
      "\x1b[3;1H#### Current Status (Supervised Alpha on Windows)",
      "\x1b[5;1H• Approved local-model profiles route tasks across pinned Cursor/Codex CLI workers and reusable specialist agentlets.",
      "\x1b[7;1H• Core Loop: Choose a task -> execute in an isolated worktree -> review the result.",
      "\x1b[10;1H> ? for shortcuts Gemini 4 Argon · medium",
    ].join("");

    const clean = stripAnsiSequences(fullScreenRedraw);
    expect(detectAgentFromOutputChunk(clean)).toBeNull();
    expect(detectAgentPromptQuestion(clean)).toBeNull();

    const workingState = {
      ...createAgentSessionState("session-1", getAgentCliProfile("agy"), "output"),
      status: "working" as const,
    };
    const afterRedraw = reduceAgentStateOnOutput(workingState, "session-1", fullScreenRedraw, 6000);
    expect(afterRedraw?.agentId).toBe("agy");
    expect(afterRedraw?.activeQuestion).toBeNull();
    expect(afterRedraw?.status).toBe("idle");
  });

  it("preserves nested alternate-screen exits and clears confirmed shell returns", () => {
    const active = createAgentSessionState("session-1", getAgentCliProfile("agy"), "process");

    // 1. Alternate screen leave (\x1b[?1049l)
    for (const mode of [1049, 1047, 47]) {
      expect(reduceAgentStateOnOutput(active, "session-1", `\x1b[?${mode}l\x1b[?25h`, 7000)).toBe(active);
    }
    expect(reduceAgentStateOnOutput(active, "session-1", "\x1b[?1049l\x1b]133;A\x07", 7000)).toBeUndefined();

    // 2. PowerShell prompt return (`PS C:\...>`)
    expect(reduceAgentStateOnOutput(active, "session-1", "PS C:\\Users\\whobs\\dev\\mach-terminal> ", 7100)).toBeUndefined();
  });
});

it("does not duplicate repainted tool activities or turn idle state into working", () => {
  const tools = "⏺ Read(a)\n⏺ Edit(b)\n⏺ Edit(b)";
  const initial = createAgentSessionState("s", getAgentCliProfile("claude"), "command");
  const first = reduceAgentStateOnOutput(initial, "s", tools, 1000)!;
  expect(first.recentActivities).toHaveLength(2);
  const idle = { ...first, status: "idle" as const };
  expect(reduceAgentStateOnOutput(idle, "s", tools, 2000)).toBe(idle);
});

it("retains interpreter-backed and manually selected agents on negative process matches", () => {
  for (const via of ["command", "output", "manual"] as const) {
    const state = createAgentSessionState("s", getAgentCliProfile("claude"), via, { nowMs: 0 });
    expect(shouldClearAgentAfterNegativeProbe(state, 5000)).toBe(false);
    expect(shouldClearAgentAfterNegativeProbe(state, 5000, true)).toBe(false);
    expect(shouldClearAgentAfterNegativeProbe(state, 5000, false)).toBe(true);
  }
  const probed = createAgentSessionState("s", getAgentCliProfile("claude"), "process", { nowMs: 0 });
  expect(shouldClearAgentAfterNegativeProbe(probed, 5000)).toBe(true);
  expect(shouldClearAgentAfterNegativeProbe({ ...probed, pinned: true }, 5000)).toBe(false);
});
it("closes only shell recipients regardless of mixed broadcast target order", () => {
  const agent = createAgentSessionState("agent", getAgentCliProfile("claude"), "command");
  expect(shellExitRecipients(["shell", "agent"], { agent })).toEqual(["shell"]);
  expect(shellExitRecipients(["agent", "shell"], { agent })).toEqual(["shell"]);
  expect(shellExitRecipients(["agent"], { agent })).toEqual([]);
});
