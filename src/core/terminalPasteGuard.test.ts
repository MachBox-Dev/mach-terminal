import { describe, expect, it } from "vitest";
import {
  classifyPasteRisk,
  decidePasteAction,
  summarizePastePayload,
} from "./terminalPasteGuard";

describe("terminal paste guard", () => {
  it("marks short single-line text as safe", () => {
    expect(classifyPasteRisk("echo hello")).toEqual({ level: "safe", reasons: [] });
  });

  it("requires confirmation for multiline paste", () => {
    const result = classifyPasteRisk("echo one\necho two");
    expect(result.level).toBe("confirm");
    expect(result.reasons).toContain("Contains multiple lines");
  });

  it("requires confirmation for long payloads", () => {
    const result = classifyPasteRisk("x".repeat(501));
    expect(result.level).toBe("confirm");
    expect(result.reasons[0]).toMatch(/Large paste/);
  });

  it("requires confirmation for chaining markers", () => {
    const result = classifyPasteRisk("npm test && npm run build");
    expect(result.level).toBe("confirm");
    expect(result.reasons).toContain("Contains shell chaining operators");
  });
});

describe("summarizePastePayload", () => {
  it("returns exact preview for short single-line input", () => {
    const result = summarizePastePayload("echo hi");
    expect(result).toEqual({
      previewText: "echo hi",
      lineCount: 1,
      charCount: 7,
      truncated: false,
    });
  });

  it("counts mixed LF and CRLF lines as physical lines", () => {
    const result = summarizePastePayload("one\ntwo\r\nthree");
    expect(result.lineCount).toBe(3);
    expect(result.charCount).toBe("one\ntwo\r\nthree".length);
    expect(result.truncated).toBe(false);
  });

  it("truncates preview and appends ellipsis when over the cap", () => {
    const raw = "x".repeat(250);
    const result = summarizePastePayload(raw, 120);
    expect(result.truncated).toBe(true);
    expect(result.previewText.endsWith("...")).toBe(true);
    expect(result.previewText.length).toBe(120 + 3);
    expect(result.charCount).toBe(250);
  });

  it("sanitizes control characters from preview while preserving charCount", () => {
    const raw = "safe\x07\x1b[1mcontent";
    const result = summarizePastePayload(raw);
    expect(result.previewText).toBe("safe[1mcontent");
    expect(result.charCount).toBe(raw.length);
    expect(result.truncated).toBe(false);
  });
});

describe("decidePasteAction", () => {
  it("sends safe payloads directly", () => {
    expect(decidePasteAction({ text: "ls", bypassForSession: false })).toEqual({
      kind: "send",
    });
  });

  it("requests confirmation for risky payloads when bypass is off", () => {
    const decision = decidePasteAction({
      text: "echo a\necho b",
      bypassForSession: false,
    });
    expect(decision.kind).toBe("confirm");
    if (decision.kind === "confirm") {
      expect(decision.risk.reasons).toContain("Contains multiple lines");
    }
  });

  it("skips the guard entirely when the session bypass is set", () => {
    const decision = decidePasteAction({
      text: "rm -rf ./tmp && echo gone",
      bypassForSession: true,
    });
    expect(decision).toEqual({ kind: "send" });
  });

  it("treats empty input as a send no-op at the caller level", () => {
    expect(decidePasteAction({ text: "", bypassForSession: false })).toEqual({
      kind: "send",
    });
  });
});
