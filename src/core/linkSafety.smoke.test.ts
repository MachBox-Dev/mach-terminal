import { describe, expect, it, vi } from "vitest";
import { activateTerminalLink, resolveTerminalLinkActivation } from "./terminalLinkActivation";
import { mergeHttpAndFileLinksForLine } from "./terminalLinkRanges";

describe("Terminal link safety smoke contracts", () => {
  it("extracts mixed http and local-file spans from one line", () => {
    const merged = mergeHttpAndFileLinksForLine(
      "Read https://example.com/docs and C:\\Users\\mike\\notes.txt for details.",
    );
    expect(merged).toEqual([
      {
        kind: "http",
        start: 5,
        endExclusive: 29,
        url: "https://example.com/docs",
      },
      {
        kind: "file",
        start: 34,
        endExclusive: 57,
        path: "C:\\Users\\mike\\notes.txt",
      },
    ]);
  });

  it("keeps allow/deny activation policy stable", () => {
    expect(resolveTerminalLinkActivation("https://example.com").kind).toBe("http");
    expect(resolveTerminalLinkActivation("file:///etc/hosts").kind).toBe("file");
    expect(resolveTerminalLinkActivation("javascript:alert(1)")).toEqual({
      kind: "rejected",
      reason: "unsupported scheme",
    });
    expect(resolveTerminalLinkActivation("file://server/share/log.txt")).toEqual({
      kind: "rejected",
      reason: "malformed or remote file uri",
    });
  });

  it("routes only accepted links into openers", () => {
    const openUrl = vi.fn();
    const openPath = vi.fn();

    const httpDecision = activateTerminalLink("https://example.com/path", { openUrl, openPath });
    const fileDecision = activateTerminalLink("file:///etc/hosts", { openUrl, openPath });
    const rejectedDecision = activateTerminalLink("javascript:alert(1)", { openUrl, openPath });

    expect(httpDecision.kind).toBe("http");
    expect(fileDecision.kind).toBe("file");
    expect(rejectedDecision.kind).toBe("rejected");
    expect(openUrl).toHaveBeenCalledWith("https://example.com/path");
    expect(openPath).toHaveBeenCalledWith("/etc/hosts");
    expect(openUrl).toHaveBeenCalledTimes(1);
    expect(openPath).toHaveBeenCalledTimes(1);
  });

  /**
   * Compiler-style diagnostics append `:line:col`. The clickable span must be path-only so the
   * opener receives a real filesystem path (`normalizeFilePathForOpen` strips the suffix).
   */
  it("limits merged file-link spans to path-only for compiler-style Windows paths", () => {
    const line = "error in C:\\src\\main.ts:42:7 missing semicolon";
    const merged = mergeHttpAndFileLinksForLine(line);
    const file = merged.find((m) => m.kind === "file");
    expect(file).toBeDefined();
    expect(file!.path).toBe("C:\\src\\main.ts");
    const underline = line.slice(file!.start, file!.endExclusive);
    expect(underline).toBe("C:\\src\\main.ts");
    expect(underline.includes(":42")).toBe(false);
  });

  it("limits merged file-link spans to path-only for compiler-style Unix paths", () => {
    const line = "at /src/main.ts:42:7 while compiling";
    const merged = mergeHttpAndFileLinksForLine(line);
    const file = merged.find((m) => m.kind === "file");
    expect(file).toBeDefined();
    expect(file!.path).toBe("/src/main.ts");
    const underline = line.slice(file!.start, file!.endExclusive);
    expect(underline).toBe("/src/main.ts");
    expect(underline).not.toMatch(/:\d+/);
  });
});
