import { describe, expect, it } from "vitest";
import {
  deleteSessionRecordKey,
  pruneRecordByAliveIds,
  pruneSessionTransientRefs,
  type SessionTransientRefs,
} from "./sessionRegistry";

describe("pruneRecordByAliveIds", () => {
  it("drops keys not in alive set", () => {
    const next = pruneRecordByAliveIds({ a: 1, b: 2, c: 3 }, ["a", "c"]);
    expect(next).toEqual({ a: 1, c: 3 });
  });

  it("returns same reference when nothing to prune", () => {
    const current = { a: 1 };
    expect(pruneRecordByAliveIds(current, ["a"])).toBe(current);
  });
});

describe("deleteSessionRecordKey", () => {
  it("returns same reference when key missing", () => {
    const current = { a: 1 };
    expect(deleteSessionRecordKey(current, "missing")).toBe(current);
  });
});

describe("pruneSessionTransientRefs", () => {
  it("removes stale ids from all transient ref maps", () => {
    const refs: SessionTransientRefs = {
      pendingOutputRef: { current: { dead: ["x"], live: [] } },
      lastSequenceRef: { current: { dead: 1, live: 2 } },
      resizeThrottleRef: { current: { dead: 99, live: 1 } },
      sessionCommandLineRef: { current: { dead: "cmd", live: "ok" } },
    };
    pruneSessionTransientRefs(["live"], refs);
    expect(refs.pendingOutputRef.current).toEqual({ live: [] });
    expect(refs.lastSequenceRef.current).toEqual({ live: 2 });
    expect(refs.resizeThrottleRef.current).toEqual({ live: 1 });
    expect(refs.sessionCommandLineRef.current).toEqual({ live: "ok" });
  });
});
