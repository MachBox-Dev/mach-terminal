import { appendAgentBannerTail, MAX_AGENT_BANNER_TAIL_CHARS, appendAgentPromptTail, MAX_AGENT_PROMPT_TAIL_CHARS, advanceAgentPromptTail } from "./agentTui";
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
  expect(shouldClearAgentAfterNegativeProbe(probed, 5000)).toBe(false);
  expect(shouldClearAgentAfterNegativeProbe(probed, 5000, null)).toBe(false);
  expect(shouldClearAgentAfterNegativeProbe(probed, 5000, true)).toBe(false);
  expect(shouldClearAgentAfterNegativeProbe(probed, 5000, false)).toBe(true);
  expect(shouldClearAgentAfterNegativeProbe({ ...probed, pinned: true }, 5000, false)).toBe(false);
});
it("closes only shell recipients regardless of mixed broadcast target order", () => {
  const agent = createAgentSessionState("agent", getAgentCliProfile("claude"), "command");
  expect(shellExitRecipients(["shell", "agent"], { agent })).toEqual(["shell"]);
  expect(shellExitRecipients(["agent", "shell"], { agent })).toEqual(["shell"]);
  expect(shellExitRecipients(["agent"], { agent })).toEqual([]);
});

it("recognizes Windows batch agent wrappers while preserving non-interactive exclusions", () => {
  expect(detectAgentFromCommandLine("claude.bat")?.id).toBe("claude");
  expect(detectAgentFromCommandLine("C:\\tools\\CODEX.BAT --resume")?.id).toBe("codex");
  expect(detectAgentFromCommandLine("claude.bat --help")).toBeNull();
  expect(detectAgentFromCommandLine("unrelated.bat")).toBeNull();
});

it("recognizes a remote startup banner split across flushes including split ANSI", () => {
  let context = "";
  let state;
  for (const chunk of ["\x1b[3", "3mWelcome to Clau", "de Code!\x1b[0m"]) {
    state = reduceAgentStateOnOutput(state, "remote", chunk, 1000, context);
    context = appendAgentBannerTail(context, chunk);
  }
  expect(state?.agentId).toBe("claude");
});
it("bounds banner context and does not combine output from different sessions", () => {
  const tails = { a: appendAgentBannerTail("", "Welcome to Clau"), b: appendAgentBannerTail("", "de Code!") };
  expect(reduceAgentStateOnOutput(undefined, "b", "de Code!", 1000, tails.b)).toBeUndefined();
  const bounded = appendAgentBannerTail("x".repeat(10000), "Welcome to Clau");
  expect(bounded.length).toBe(MAX_AGENT_BANNER_TAIL_CHARS);
  expect(reduceAgentStateOnOutput(undefined, "a", "de Code!", 1000, bounded)?.agentId).toBe("claude");
});
it("does not replay an old banner on a shell return or an empty flush", () => {
  const context = "Welcome to Claude Code!\n";
  expect(reduceAgentStateOnOutput(undefined, "s", "\x1b]133;A\x07", 1000, context)).toBeUndefined();
  expect(reduceAgentStateOnOutput(undefined, "s", "", 1000, context)).toBeUndefined();
});

it("keeps the current chunk visible to detection even when it exceeds the retained tail cap", () => {
  const chunk = "de Code!\n" + "x".repeat(10000);
  expect(reduceAgentStateOnOutput(undefined, "s", chunk, 1000, "Welcome to Clau")?.agentId).toBe("claude");
  expect(reduceAgentStateOnOutput(undefined, "s", "Welcome to Claude Code!\n" + "x".repeat(10000))?.agentId).toBe("claude");
});


describe("prompt output spanning PTY flushes", () => {
  const initial = () => createAgentSessionState("split", getAgentCliProfile("codex"), "command", { nowMs: 1 });
  const question = "Choose an approach?\r\n";
  const first = "❯ 1. Keep changes\r\n";
  const second = "  2. Discard changes\r\n";

  it("collects a numbered question across three flushes, including split ANSI styling", () => {
    let state = initial();
    let tail = "";
    for (const chunk of [question + "\x1b[3", "2m" + first, "\x1b[0m" + second]) {
      const before = state;
      state = reduceAgentStateOnOutput(state, "split", chunk, 2, "", tail)!;
      tail = advanceAgentPromptTail(tail, chunk, before, state);
    }
    expect(state.activeQuestion?.promptText).toBe("Choose an approach?");
    expect(state.activeQuestion?.options.slice(0, 2).map(o => o.payload)).toEqual(["1\r", "2\r"]);
    expect(state.status).toBe("awaiting_prompt");
    expect(reduceAgentStateOnOutput(state, "split", question + first + second, 3, "", tail)).toBe(state);
  });

  it("does not reuse a question after a screen redraw or work resumes", () => {
    const raw = question + first + second;
    const state = reduceAgentStateOnOutput(initial(), "split", raw, 2)!;
    expect(reduceAgentStateOnOutput(state, "split", raw + "\x1b[2J\x1b[HNew view", 3, "", raw)?.activeQuestion).toBeNull();
    expect(reduceAgentStateOnOutput(state, "split", "• Explored repository", 3, "", raw)?.activeQuestion).toBeNull();
    expect(reduceAgentStateOnOutput(state, "split", "Thinking...", 3, "", raw)?.activeQuestion).toBeNull();
    expect(reduceAgentStateOnOutput(state, "split", "? for shortcuts", 3, "", raw)).toBe(state);
    expect(reduceAgentStateOnOutput(state, "split", "❯\n? for shortcuts", 3, "", raw)?.activeQuestion).toBeNull();
    expect(appendAgentPromptTail(raw, "\x1b[2JNew view")).not.toContain("Choose");
  });

  it("retains a new question header when a redraw replaces the previous question", () => {
    const raw = question + first + second;
    const before = reduceAgentStateOnOutput(initial(), "split", raw, 2)!;
    const header = "\x1b[2J\x1b[HChoose a replacement?\n";
    const cleared = reduceAgentStateOnOutput(before, "split", header, 3, "", raw)!;
    expect(cleared.activeQuestion).toBeNull();
    const tail = advanceAgentPromptTail(raw, header, before, cleared);
    const next = reduceAgentStateOnOutput(cleared, "split", first + second, 4, "", tail);
    expect(next?.activeQuestion?.promptText).toBe("Choose a replacement?");
    const splitReset = reduceAgentStateOnOutput(before, "split", "2JNew view", 3, "", raw + "\x1b[");
    expect(splitReset?.activeQuestion).toBeNull();
  });

  it("does not combine options from different sessions or an answered prompt", () => {
    const tail = appendAgentPromptTail("", question + first);
    expect(reduceAgentStateOnOutput(initial(), "other", second, 3)?.activeQuestion).toBeNull();
    expect(reduceAgentStateOnOutput(initial(), "split", second, 3, "", tail)?.activeQuestion).not.toBeNull();
    expect(reduceAgentStateOnOutput(initial(), "split", second, 4, "", "")?.activeQuestion).toBeNull();
    expect(appendAgentPromptTail("x".repeat(20_000), "y".repeat(20_000))).toHaveLength(MAX_AGENT_PROMPT_TAIL_CHARS);
  });
});

it("retains the distinct permission scopes in Antigravity's command menu", () => {
  const command = "git show 796965c -- src/gui/src/main.rs";
  const menu = [
    "Requesting permission for:",
    command,
    "Run this command?",
    "> 1. Yes, run command",
    "2. Yes, and always allow in this conversation for commands that start with '" + command + "'",
    "3. Yes, and always allow for commands that start with '" + command + "' (Persist to settings.json)",
    "4. No, cancel",
    "↑/↓ Navigate · tab Amend · ctrl+g edit/expand command",
    "esc to cancel",
  ].join("\n");
  const question = detectAgentPromptQuestion(menu);
  expect(question?.promptText).toBe("Run this command?");
  expect(question?.options).toHaveLength(5);
  expect(question?.options[1]?.label).toContain("in this conversation");
  expect(question?.options[2]?.label).toContain("Persist to settings.json");
  expect(question?.options[3]?.variant).toBe("danger");
});
