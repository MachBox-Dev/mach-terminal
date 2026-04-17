import { describe, expect, it } from "vitest";
import type { PtyCwdChangedEvent } from "./terminal";
import {
  applyCwdChange,
  clearCwd,
  getRestartCwd,
  pruneCwdForSessions,
  type SessionCwdMap,
} from "./sessionCwd";

function event(session_id: string, cwd: string, timestamp_ms = 0): PtyCwdChangedEvent {
  return { session_id, cwd, timestamp_ms };
}

describe("applyCwdChange", () => {
  it("inserts a cwd for a previously unknown session", () => {
    const next = applyCwdChange({}, event("s1", "/home/mike"));
    expect(next).toEqual({ s1: "/home/mike" });
  });

  it("overwrites an existing cwd when the path changes", () => {
    const next = applyCwdChange({ s1: "/home/mike" }, event("s1", "/tmp"));
    expect(next).toEqual({ s1: "/tmp" });
  });

  it("returns the same reference when the cwd is unchanged (setState bailout)", () => {
    const prev: SessionCwdMap = { s1: "/tmp" };
    const next = applyCwdChange(prev, event("s1", "/tmp"));
    expect(next).toBe(prev);
  });

  it("ignores empty cwds (defensive: backend should never send them)", () => {
    const prev: SessionCwdMap = { s1: "/tmp" };
    const next = applyCwdChange(prev, event("s1", ""));
    expect(next).toBe(prev);
  });

  it("does not affect other session entries", () => {
    const prev: SessionCwdMap = { s1: "/a", s2: "/b" };
    const next = applyCwdChange(prev, event("s1", "/c"));
    expect(next).toEqual({ s1: "/c", s2: "/b" });
    expect(next).not.toBe(prev);
  });
});

describe("clearCwd", () => {
  it("removes the session entry", () => {
    const next = clearCwd({ s1: "/tmp", s2: "/x" }, "s1");
    expect(next).toEqual({ s2: "/x" });
  });

  it("returns the same reference when the id is absent (bailout)", () => {
    const prev: SessionCwdMap = { s1: "/tmp" };
    const next = clearCwd(prev, "nope");
    expect(next).toBe(prev);
  });

  it("is a no-op on an empty map", () => {
    const prev: SessionCwdMap = {};
    const next = clearCwd(prev, "s1");
    expect(next).toBe(prev);
  });
});

describe("pruneCwdForSessions", () => {
  it("drops entries for ids missing from the alive list", () => {
    const next = pruneCwdForSessions({ s1: "/a", s2: "/b", s3: "/c" }, ["s1", "s3"]);
    expect(next).toEqual({ s1: "/a", s3: "/c" });
  });

  it("returns the same reference when nothing was pruned", () => {
    const prev: SessionCwdMap = { s1: "/a", s2: "/b" };
    const next = pruneCwdForSessions(prev, ["s1", "s2"]);
    expect(next).toBe(prev);
  });

  it("handles the empty-alive case by dropping everything", () => {
    const next = pruneCwdForSessions({ s1: "/a" }, []);
    expect(next).toEqual({});
  });
});

describe("getRestartCwd", () => {
  it("prefers the tracked live cwd over the fallback", () => {
    expect(getRestartCwd({ s1: "/live" }, "s1", "/default")).toBe("/live");
  });

  it("falls back to the profile cwd when no live cwd is tracked", () => {
    expect(getRestartCwd({}, "s1", "/default")).toBe("/default");
  });

  it("returns null when both the tracked cwd and fallback are missing", () => {
    expect(getRestartCwd({}, "s1", null)).toBeNull();
    expect(getRestartCwd({}, "s1", undefined)).toBeNull();
    expect(getRestartCwd({}, "s1", "")).toBeNull();
  });

  it("treats an empty tracked string as absent and uses the fallback", () => {
    expect(getRestartCwd({ s1: "" }, "s1", "/default")).toBe("/default");
  });
});
