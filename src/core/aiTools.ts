import { sliceBufferForRun, type RunLedgerState, type RunRecord } from "./runLedger";
import { trimAiContextExcerpt, type AiPromptContextPayload } from "./terminal";

export const AI_TOOL_GET_COMMAND_OUTPUT = "get_command_output";
export const AI_TOOL_LIST_COMMAND_RUNS = "list_command_runs";

export const AI_TOOL_MAX_OUTPUT_CHARS = 8_000;

export interface AiToolContext {
  sessionId: string;
  runLedger: RunLedgerState;
  sessionBuffers: Record<string, string>;
  sessionBufferOffsets?: Record<string, number>;
}

export interface AiToolCall {
  id: string;
  name: string;
  arguments: string;
}

/** OpenAI-style tool definitions shipped to the provider. */
export const MACH_AI_TOOL_DEFINITIONS = [
  {
    type: "function" as const,
    function: {
      name: AI_TOOL_LIST_COMMAND_RUNS,
      description:
        "List recent commands from the Mach ops command log for the active session. Returns run_id values usable with get_command_output.",
      parameters: {
        type: "object",
        properties: {
          limit: {
            type: "number",
            description: "Max runs to return (default 15, max 40).",
          },
        },
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: AI_TOOL_GET_COMMAND_OUTPUT,
      description:
        "Fetch terminal output captured for a specific command run. Use run_id from list_command_runs.",
      parameters: {
        type: "object",
        properties: {
          run_id: { type: "string", description: "Run id from list_command_runs." },
          max_chars: {
            type: "number",
            description: `Optional output cap (default ${AI_TOOL_MAX_OUTPUT_CHARS}).`,
          },
        },
        required: ["run_id"],
      },
    },
  },
];

export function findRunForSession(
  ctx: AiToolContext,
  runId: string,
): { run: RunRecord; output: string } | null {
  const runs = ctx.runLedger[ctx.sessionId] ?? [];
  const run = runs.find((entry) => entry.id === runId);
  if (!run) {
    return null;
  }
  const buffer = ctx.sessionBuffers[ctx.sessionId] ?? "";
  const output = sliceBufferForRun(buffer, run, ctx.sessionBufferOffsets?.[ctx.sessionId] ?? 0);
  return { run, output };
}

export function listRunsForSession(ctx: AiToolContext, limit = 15): RunRecord[] {
  const runs = ctx.runLedger[ctx.sessionId] ?? [];
  const capped = Math.min(Math.max(limit, 1), 40);
  return runs.slice(-capped);
}

export function formatRunCatalogLine(run: RunRecord): string {
  const time = new Date(run.submittedAtMs).toISOString();
  const pinned = run.pinned ? " pinned" : "";
  return `${run.id} @ ${time}${pinned}: ${run.commandText.replace(/\s+/g, " ").trim()}`;
}

export function buildRunCatalogHint(ctx: AiToolContext, limit = 12): string | undefined {
  const runs = listRunsForSession(ctx, limit);
  if (runs.length === 0) {
    return undefined;
  }
  return runs.map(formatRunCatalogLine).join("\n");
}

function parseToolArgs(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export function resolveAiToolCall(call: Pick<AiToolCall, "name" | "arguments">, ctx: AiToolContext): string {
  const args = parseToolArgs(call.arguments);
  if (call.name === AI_TOOL_LIST_COMMAND_RUNS) {
    const limit = typeof args.limit === "number" ? args.limit : 15;
    const runs = listRunsForSession(ctx, limit);
    if (runs.length === 0) {
      return "No commands logged for this session yet.";
    }
    return runs.map(formatRunCatalogLine).join("\n");
  }
  if (call.name === AI_TOOL_GET_COMMAND_OUTPUT) {
    const runId = typeof args.run_id === "string" ? args.run_id : "";
    if (runId.length === 0) {
      return "Error: run_id is required.";
    }
    const match = findRunForSession(ctx, runId);
    if (!match) {
      return `Error: run_id "${runId}" not found for this session. Call list_command_runs first.`;
    }
    const maxChars =
      typeof args.max_chars === "number" && args.max_chars > 0
        ? Math.min(args.max_chars, AI_TOOL_MAX_OUTPUT_CHARS)
        : AI_TOOL_MAX_OUTPUT_CHARS;
    const trimmed = trimAiContextExcerpt(match.output, maxChars) ?? "";
    if (trimmed.length === 0) {
      return `Command: ${match.run.commandText}\n(no captured output for this run)`;
    }
    return `Command: ${match.run.commandText}\n\nOutput:\n${trimmed}`;
  }
  return `Error: unknown tool "${call.name}".`;
}

/** Assemble the user message body with optional session context (mirrors backend assemble_user_content). */
export function buildToolUserMessage(prompt: string, context?: AiPromptContextPayload | null): string {
  const trimmed = prompt.trim();
  if (!context) {
    return trimmed;
  }
  const lines: string[] = [];
  if (context.cwd && context.cwd.trim().length > 0) {
    lines.push(`cwd: ${context.cwd.trim()}`);
  }
  if (context.shell && context.shell.trim().length > 0) {
    lines.push(`shell: ${context.shell.trim()}`);
  }
  if (context.git_branch && context.git_branch.trim().length > 0) {
    lines.push(`git_branch: ${context.git_branch.trim()}`);
  }
  if (context.command_text && context.command_text.trim().length > 0) {
    lines.push(`command_text:\n${context.command_text.trim()}`);
  }
  if (context.output_excerpt && context.output_excerpt.trim().length > 0) {
    lines.push(`recent_terminal_output_tail:\n${context.output_excerpt.trim()}`);
  }
  if (lines.length === 0) {
    return trimmed;
  }
  return `Session context:\n${lines.join("\n")}\n\n---\n\n${trimmed}`;
}

export function providerSupportsAiTools(providerId: string): boolean {
  return (
    providerId === "openai" ||
    providerId === "custom-openai" ||
    providerId === "ollama" ||
    providerId === "anthropic"
  );
}
