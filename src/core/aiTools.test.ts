import { describe, expect, it } from "vitest";
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
});
