import { describe, expect, it } from "vitest";
import {
  drainChunksUpToByteBudget,
  mergePendingChunks,
  nextSequenceState,
  SEQUENCE_LARGE_JUMP,
} from "./ptyOutputCoalesce";

describe("nextSequenceState", () => {
  it("treats first chunk as ok", () => {
    expect(nextSequenceState(undefined, 1)).toEqual({ status: "ok", next: 1 });
  });

  it("treats strict increment as ok", () => {
    expect(nextSequenceState(5, 6)).toEqual({ status: "ok", next: 6 });
  });

  it("treats small forward gap as resync", () => {
    expect(nextSequenceState(1, 3)).toEqual({ status: "resync", next: 3 });
    expect(nextSequenceState(10, 10 + SEQUENCE_LARGE_JUMP)).toEqual({ status: "resync", next: 10 + SEQUENCE_LARGE_JUMP });
    expect(nextSequenceState(1, 101)).toEqual({ status: "resync", next: 101 });
  });

  it("treats duplicate or rewind as gap", () => {
    expect(nextSequenceState(5, 5)).toEqual({ status: "gap", next: 5 });
    expect(nextSequenceState(5, 4)).toEqual({ status: "gap", next: 4 });
  });

  it("treats large forward jump as gap", () => {
    expect(nextSequenceState(1, 1 + SEQUENCE_LARGE_JUMP + 1)).toEqual({ status: "gap", next: 1 + SEQUENCE_LARGE_JUMP + 1 });
  });
});

describe("mergePendingChunks", () => {
  it("joins all chunks when no cap", () => {
    expect(mergePendingChunks(["a", "b", "c"])).toBe("abc");
  });

  it("respects byte cap with whole chunks first", () => {
    expect(mergePendingChunks(["aa", "bb"], 3)).toBe("aa");
  });
});

describe("drainChunksUpToByteBudget", () => {
  it("returns empty for empty input", () => {
    expect(drainChunksUpToByteBudget([], 10)).toEqual({ merged: "", rest: [] });
  });

  it("consumes all when under budget", () => {
    expect(drainChunksUpToByteBudget(["x", "y"], 10)).toEqual({ merged: "xy", rest: [] });
  });

  it("splits first chunk when it alone exceeds budget", () => {
    const { merged, rest } = drainChunksUpToByteBudget(["abcdef", "gh"], 4);
    expect(merged).toBe("abcd");
    expect(rest).toEqual(["ef", "gh"]);
  });

  it("leaves tail when whole chunks fill budget", () => {
    const { merged, rest } = drainChunksUpToByteBudget(["ab", "cd", "ef"], 4);
    expect(merged).toBe("abcd");
    expect(rest).toEqual(["ef"]);
  });
});
