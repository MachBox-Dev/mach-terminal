import { describe, expect, it } from "vitest";
import { formatExitSummary, summarizeExitedInfo } from "./sessionExitSummary";
import type { SessionExitedInfo, TerminalSessionStatus } from "./sessionLifecycle";

const STATUSES: TerminalSessionStatus[] = ["stopped", "closed", "error"];

describe("formatExitSummary headline", () => {
  it.each(STATUSES)("prefixes the status verbatim for %s", (status) => {
    expect(formatExitSummary({ status, message: null, exitCode: null }).headline).toBe(
      `Session ${status}`,
    );
  });
});

describe("formatExitSummary detail", () => {
  it("uses the trimmed backend message when provided", () => {
    expect(
      formatExitSummary({ status: "stopped", message: "  shell exited  ", exitCode: null }).detail,
    ).toBe("shell exited");
  });

  it("falls back to the stopped default when message is null", () => {
    expect(formatExitSummary({ status: "stopped", message: null, exitCode: null }).detail).toBe(
      "Shell exited.",
    );
  });

  it("falls back to the stopped default when message is whitespace-only", () => {
    expect(formatExitSummary({ status: "stopped", message: "   ", exitCode: null }).detail).toBe(
      "Shell exited.",
    );
  });

  it("falls back to the closed default when message is empty", () => {
    expect(formatExitSummary({ status: "closed", message: "", exitCode: null }).detail).toBe(
      "Session closed.",
    );
  });

  it("falls back to the error default when message is null", () => {
    expect(formatExitSummary({ status: "error", message: null, exitCode: null }).detail).toBe(
      "Shell reader hit an error.",
    );
  });

  it("prefers the error message over the fallback when present", () => {
    expect(
      formatExitSummary({ status: "error", message: "reader failure: eof", exitCode: null }).detail,
    ).toBe("reader failure: eof");
  });
});

describe("formatExitSummary codeLine", () => {
  it("is null when exitCode is null", () => {
    expect(formatExitSummary({ status: "stopped", message: null, exitCode: null }).codeLine).toBe(
      null,
    );
  });

  it("renders the numeric code for non-zero exits", () => {
    expect(formatExitSummary({ status: "stopped", message: null, exitCode: 7 }).codeLine).toBe(
      "Exited with code 7",
    );
  });

  it("renders exit code 0 explicitly (clean exit still reports)", () => {
    expect(formatExitSummary({ status: "stopped", message: null, exitCode: 0 }).codeLine).toBe(
      "Exited with code 0",
    );
  });

  it("renders negative / signal-shaped codes without reinterpreting them", () => {
    expect(formatExitSummary({ status: "stopped", message: null, exitCode: 143 }).codeLine).toBe(
      "Exited with code 143",
    );
    expect(formatExitSummary({ status: "stopped", message: null, exitCode: -1 }).codeLine).toBe(
      "Exited with code -1",
    );
  });

  it("is populated on any status that carries an exit code, even closed / error", () => {
    expect(formatExitSummary({ status: "closed", message: null, exitCode: 0 }).codeLine).toBe(
      "Exited with code 0",
    );
    expect(formatExitSummary({ status: "error", message: "boom", exitCode: 137 }).codeLine).toBe(
      "Exited with code 137",
    );
  });
});

describe("summarizeExitedInfo", () => {
  it("delegates to formatExitSummary with the stored fields", () => {
    const info: SessionExitedInfo = {
      status: "stopped",
      message: "shell exited",
      timestampMs: 42,
      exitCode: 7,
    };
    expect(summarizeExitedInfo(info)).toEqual({
      headline: "Session stopped",
      detail: "shell exited",
      codeLine: "Exited with code 7",
    });
  });

  it("drops the codeLine when exitCode is null on the stored info", () => {
    const info: SessionExitedInfo = {
      status: "closed",
      message: "session closed by user",
      timestampMs: 0,
      exitCode: null,
    };
    expect(summarizeExitedInfo(info).codeLine).toBeNull();
  });
});
