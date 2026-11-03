import { describe, expect, it } from "vitest";
import {
  deleteSessionRecordKey,
  clearSessionTransientRefs,
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
      lifecycleStatusRef: { current: { dead: "stopped", live: "running" } },
      agentPromptTailsRef: { current: { dead: "old prompt", live: "1. Yes" } },
      agentBannerTailsRef: { current: { dead: "Welcome to Clau", live: "partial" } },
      agentQuitInFlightRef: { current: { dead: true, live: true } },
      dismissedAgentSessionsRef: { current: { dead: true, live: true } },
      pendingOutputRef: { current: { dead: ["x"], live: [] } },
      lastSequenceRef: { current: { dead: 1, live: 2 } },
      resizeThrottleRef: { current: { dead: 99, live: 1 } },
      sessionCommandLineRef: { current: { dead: "cmd", live: "ok" } },
    };
    pruneSessionTransientRefs(["live"], refs);
    expect(refs.lifecycleStatusRef?.current).toEqual({ live: "running" });
    expect(refs.agentPromptTailsRef?.current).toEqual({ live: "1. Yes" });
    expect(refs.agentBannerTailsRef?.current).toEqual({ live: "partial" });
    expect(refs.agentQuitInFlightRef?.current).toEqual({ live: true });
    expect(refs.dismissedAgentSessionsRef?.current).toEqual({ live: true });
    expect(refs.pendingOutputRef.current).toEqual({ live: [] });
    expect(refs.lastSequenceRef.current).toEqual({ live: 2 });
    expect(refs.resizeThrottleRef.current).toEqual({ live: 1 });
    expect(refs.sessionCommandLineRef.current).toEqual({ live: "ok" });
    clearSessionTransientRefs("live", refs);
    expect(refs.lifecycleStatusRef?.current).toEqual({});
    expect(refs.agentPromptTailsRef?.current).toEqual({});
    expect(refs.agentBannerTailsRef?.current).toEqual({});
    expect(refs.agentQuitInFlightRef?.current).toEqual({});
    expect(refs.dismissedAgentSessionsRef?.current).toEqual({});
  });
});
