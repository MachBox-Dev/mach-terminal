import { describe, expect, it, vi } from "vitest";
import { executeAiWithTools } from "./aiToolRunner";
import { appendCommandSubmitted } from "./runLedger";
import {
  AI_TOOL_GET_COMMAND_OUTPUT,
  AI_TOOL_LIST_COMMAND_RUNS,
  findRunForSession,
  formatRunCatalogLine,
  resolveAiToolCall,
} from "./aiTools";

describe("aiTools", () => {
  const ctx = (() => {
    const ledger = appendCommandSubmitted(
      {},
      {
        sessionId: "s1",
        commandText: "npm test",
        submittedAtMs: 1,
        sequence: 1,
        bufferLengthBefore: 0,
      },
    );
    return {
      sessionId: "s1",
      runLedger: ledger,
      sessionBuffers: { s1: "ok\nFAIL\n" },
    };
  })();

  it("lists runs for session", () => {
    const run = ctx.runLedger.s1?.[0];
    expect(run).toBeDefined();
    const result = resolveAiToolCall(
      { name: AI_TOOL_LIST_COMMAND_RUNS, arguments: "{}" },
      ctx,
    );
    expect(result).toContain("npm test");
    expect(result).toContain(run!.id);
  });

  it("fetches output by run id", () => {
    const run = ctx.runLedger.s1?.[0]!;
    const result = resolveAiToolCall(
      { name: AI_TOOL_GET_COMMAND_OUTPUT, arguments: JSON.stringify({ run_id: run.id }) },
      ctx,
    );
    expect(result).toContain("npm test");
    expect(result).toContain("FAIL");
  });

  it("reports missing run ids", () => {
    const result = resolveAiToolCall(
      { name: AI_TOOL_GET_COMMAND_OUTPUT, arguments: '{"run_id":"missing"}' },
      ctx,
    );
    expect(result).toContain("not found");
  });

  it("uses absolute run positions when older output has been evicted", () => {
    const run = { ...ctx.runLedger.s1[0], bufferStart: 120_000, bufferEnd: 120_005 };
    const shifted = {
      ...ctx, runLedger: { s1: [run] }, sessionBuffers: { s1: "olderHELLOnewer" },
      sessionBufferOffsets: { s1: 119_995 },
    };
    expect(findRunForSession(shifted, run.id)?.output).toBe("HELLO");
  });

  it("formats catalog lines", () => {
    const run = ctx.runLedger.s1?.[0]!;
    expect(formatRunCatalogLine(run)).toContain(run.id);
    expect(findRunForSession(ctx, run.id)?.output).toContain("FAIL");
  });

  it("runs a final tool-free synthesis call when maxRounds is exhausted", async () => {
    const execute = vi
      .fn()
      .mockResolvedValueOnce({
        provider_id: "openai",
        output: "",
        finish_reason: "tool_calls",
        tool_calls: [{ id: "call-1", name: "list_command_runs", arguments: "{}" }],
      })
      .mockResolvedValueOnce({
        provider_id: "openai",
        output: "Final synthesized answer",
        finish_reason: "stop",
      });

    const res = await executeAiWithTools(
      { session_id: "s1", prompt: "What failed?", provider_id: "openai", intent: "freeform" },
      {
        enabled: true,
        providerId: "openai",
        toolContext: ctx,
        userMessageBody: "What failed?",
        maxRounds: 1,
        execute,
      },
    );

    expect(execute).toHaveBeenCalledTimes(2);
    expect(execute.mock.calls[1][0].enable_tools).toBe(false);
    expect(res.output).toBe("Final synthesized answer");
  });
});
