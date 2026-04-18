import { describe, expect, it } from "vitest";
import { evaluateTerminalUiIntent } from "./terminalUiIntent";

describe("terminal UI intent decision helper", () => {
  it("ignores stale seq on focused pane", () => {
    const result = evaluateTerminalUiIntent({
      request: { kind: "openFind", seq: 3 },
      isFocused: true,
      consumedSeq: 3,
      findQuery: "foo",
      followOutput: true,
    });
    expect(result).toEqual({ nextConsumedSeq: 3 });
  });

  it("fast-forwards consumed seq when unfocused without action", () => {
    const result = evaluateTerminalUiIntent({
      request: { kind: "scrollToBottom", seq: 8 },
      isFocused: false,
      consumedSeq: 5,
      findQuery: "foo",
      followOutput: true,
    });
    expect(result).toEqual({ nextConsumedSeq: 8 });
  });

  it("emits one action for a fresh focused request", () => {
    const result = evaluateTerminalUiIntent({
      request: { kind: "openFind", seq: 9 },
      isFocused: true,
      consumedSeq: 8,
      findQuery: "",
      followOutput: true,
    });
    expect(result).toEqual({
      nextConsumedSeq: 9,
      action: { type: "openFind" },
    });
  });

  it("uses explicit no-op for find next/previous with empty query", () => {
    const next = evaluateTerminalUiIntent({
      request: { kind: "findNext", seq: 2 },
      isFocused: true,
      consumedSeq: 1,
      findQuery: "   ",
      followOutput: true,
    });
    const prev = evaluateTerminalUiIntent({
      request: { kind: "findPrevious", seq: 3 },
      isFocused: true,
      consumedSeq: 2,
      findQuery: "",
      followOutput: true,
    });
    expect(next).toEqual({ nextConsumedSeq: 2 });
    expect(prev).toEqual({ nextConsumedSeq: 3 });
  });

  it("toggles follow output off then on with scroll restore", () => {
    const off = evaluateTerminalUiIntent({
      request: { kind: "toggleFollowOutput", seq: 11 },
      isFocused: true,
      consumedSeq: 10,
      findQuery: "foo",
      followOutput: true,
    });
    const on = evaluateTerminalUiIntent({
      request: { kind: "toggleFollowOutput", seq: 12 },
      isFocused: true,
      consumedSeq: 11,
      findQuery: "foo",
      followOutput: false,
    });
    expect(off).toEqual({
      nextConsumedSeq: 11,
      action: { type: "setFollowOutput", followOutput: false, scrollToBottom: false },
    });
    expect(on).toEqual({
      nextConsumedSeq: 12,
      action: { type: "setFollowOutput", followOutput: true, scrollToBottom: true },
    });
  });

  it("emits jumpSearch when query non-empty", () => {
    const result = evaluateTerminalUiIntent({
      request: { kind: "jumpSearch", seq: 4, query: "  npm test  " },
      isFocused: true,
      consumedSeq: 3,
      findQuery: "",
      followOutput: true,
    });
    expect(result).toEqual({
      nextConsumedSeq: 4,
      action: { type: "jumpSearch", query: "npm test" },
    });
  });

  it("skips jumpSearch when query empty after trim", () => {
    const result = evaluateTerminalUiIntent({
      request: { kind: "jumpSearch", seq: 5, query: "   " },
      isFocused: true,
      consumedSeq: 4,
      findQuery: "",
      followOutput: true,
    });
    expect(result).toEqual({ nextConsumedSeq: 5 });
  });
});
