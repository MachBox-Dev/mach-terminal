import { describe, expect, it } from "vitest";
import { evaluateTerminalUiIntent } from "./terminalUiIntent";
import type { TerminalUiRequest } from "./terminalUiRequest";

function request(kind: TerminalUiRequest["kind"], seq = 1): TerminalUiRequest {
  return { kind, seq };
}

describe("terminal UI intent decision helper", () => {
  it("ignores stale seq on focused pane", () => {
    const result = evaluateTerminalUiIntent({
      request: request("openFind", 3),
      isFocused: true,
      consumedSeq: 3,
      findQuery: "foo",
      followOutput: true,
    });
    expect(result).toEqual({ nextConsumedSeq: 3 });
  });

  it("fast-forwards consumed seq when unfocused without action", () => {
    const result = evaluateTerminalUiIntent({
      request: request("scrollToBottom", 8),
      isFocused: false,
      consumedSeq: 5,
      findQuery: "foo",
      followOutput: true,
    });
    expect(result).toEqual({ nextConsumedSeq: 8 });
  });

  it("emits one action for a fresh focused request", () => {
    const result = evaluateTerminalUiIntent({
      request: request("openFind", 9),
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
      request: request("findNext", 2),
      isFocused: true,
      consumedSeq: 1,
      findQuery: "   ",
      followOutput: true,
    });
    const prev = evaluateTerminalUiIntent({
      request: request("findPrevious", 3),
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
      request: request("toggleFollowOutput", 11),
      isFocused: true,
      consumedSeq: 10,
      findQuery: "foo",
      followOutput: true,
    });
    const on = evaluateTerminalUiIntent({
      request: request("toggleFollowOutput", 12),
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
});
