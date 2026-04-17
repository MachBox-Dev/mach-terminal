import { describe, expect, it } from "vitest";
import type { PtyLifecycleEvent } from "./terminal";
import {
  clearExitedInfo,
  deriveExitedInfo,
  isTerminalStatus,
  pruneExitedForSessions,
  type SessionExitedInfo,
} from "./sessionLifecycle";

function makeEvent(partial: Partial<PtyLifecycleEvent>): PtyLifecycleEvent {
  return {
    session_id: "session-1",
    status: "running",
    timestamp_ms: 1_000,
    ...partial,
  };
}

describe("isTerminalStatus", () => {
  it("returns false for non-terminal statuses", () => {
    expect(isTerminalStatus("idle")).toBe(false);
    expect(isTerminalStatus("starting")).toBe(false);
    expect(isTerminalStatus("running")).toBe(false);
  });

  it("returns true for each terminal status", () => {
    expect(isTerminalStatus("stopped")).toBe(true);
    expect(isTerminalStatus("closed")).toBe(true);
    expect(isTerminalStatus("error")).toBe(true);
  });
});

describe("deriveExitedInfo", () => {
  it("returns null for running / starting events", () => {
    expect(deriveExitedInfo(makeEvent({ status: "running" }))).toBeNull();
    expect(deriveExitedInfo(makeEvent({ status: "starting" }))).toBeNull();
  });

  it("projects terminal status with message and timestamp", () => {
    const info = deriveExitedInfo(
      makeEvent({ status: "stopped", message: "shell exited", timestamp_ms: 42 }),
    );
    expect(info).toEqual({
      status: "stopped",
      message: "shell exited",
      timestampMs: 42,
      exitCode: null,
    });
  });

  it("preserves null message when backend omitted one", () => {
    const info = deriveExitedInfo(makeEvent({ status: "closed", timestamp_ms: 7 }));
    expect(info).toEqual({ status: "closed", message: null, timestampMs: 7, exitCode: null });
  });

  it("handles error status", () => {
    const info = deriveExitedInfo(
      makeEvent({ status: "error", message: "read failure", timestamp_ms: 99 }),
    );
    expect(info).toEqual({
      status: "error",
      message: "read failure",
      timestampMs: 99,
      exitCode: null,
    });
  });

  it("round-trips exit_code on stopped events", () => {
    const info = deriveExitedInfo(
      makeEvent({
        status: "stopped",
        message: "shell exited",
        timestamp_ms: 101,
        exit_code: 7,
      }),
    );
    expect(info).toEqual({
      status: "stopped",
      message: "shell exited",
      timestampMs: 101,
      exitCode: 7,
    });
  });

  it("round-trips exit_code zero (clean exit) rather than collapsing to null", () => {
    const info = deriveExitedInfo(
      makeEvent({ status: "stopped", timestamp_ms: 200, exit_code: 0 }),
    );
    expect(info?.exitCode).toBe(0);
  });
});

describe("clearExitedInfo", () => {
  const base: Record<string, SessionExitedInfo> = {
    "session-1": { status: "stopped", message: null, timestampMs: 1, exitCode: 0 },
    "session-2": { status: "error", message: "bad", timestampMs: 2, exitCode: null },
  };

  it("returns a new map without the targeted id", () => {
    const next = clearExitedInfo(base, "session-1");
    expect(next).not.toBe(base);
    expect(next).toEqual({ "session-2": base["session-2"] });
  });

  it("returns the original reference when the id is absent (setState no-op)", () => {
    const next = clearExitedInfo(base, "session-missing");
    expect(next).toBe(base);
  });
});

describe("pruneExitedForSessions", () => {
  const base: Record<string, SessionExitedInfo> = {
    "session-1": { status: "stopped", message: null, timestampMs: 1, exitCode: 0 },
    "session-2": { status: "error", message: "bad", timestampMs: 2, exitCode: null },
    "session-3": { status: "closed", message: null, timestampMs: 3, exitCode: null },
  };

  it("keeps only entries whose id is in the alive set", () => {
    const next = pruneExitedForSessions(base, ["session-1", "session-3"]);
    expect(Object.keys(next).sort()).toEqual(["session-1", "session-3"]);
  });

  it("returns the original reference when every id is alive", () => {
    const next = pruneExitedForSessions(base, ["session-1", "session-2", "session-3"]);
    expect(next).toBe(base);
  });

  it("returns an empty map when no ids are alive", () => {
    const next = pruneExitedForSessions(base, []);
    expect(next).toEqual({});
  });
});
