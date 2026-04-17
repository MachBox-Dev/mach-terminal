import { describe, expect, it, vi } from "vitest";
import {
  activateTerminalLink,
  resolveTerminalLinkActivation,
} from "./terminalLinkActivation";

describe("resolveTerminalLinkActivation", () => {
  it("accepts https URLs", () => {
    const r = resolveTerminalLinkActivation("https://example.com/path");
    expect(r.kind).toBe("http");
    expect(r.target).toBe("https://example.com/path");
  });

  it("accepts http URLs", () => {
    const r = resolveTerminalLinkActivation("http://example.com");
    expect(r.kind).toBe("http");
    expect(r.target).toBe("http://example.com");
  });

  it("rejects javascript: URIs", () => {
    expect(resolveTerminalLinkActivation("javascript:alert(1)").kind).toBe("rejected");
  });

  it("rejects data: URIs", () => {
    expect(resolveTerminalLinkActivation("data:text/html,<script>").kind).toBe("rejected");
  });

  it("rejects unknown schemes", () => {
    expect(resolveTerminalLinkActivation("vscode://open?file=/etc/hosts").kind).toBe("rejected");
    expect(resolveTerminalLinkActivation("ftp://example.com").kind).toBe("rejected");
  });

  it("rejects empty or non-string input", () => {
    expect(resolveTerminalLinkActivation("").kind).toBe("rejected");
    // @ts-expect-error testing runtime tolerance
    expect(resolveTerminalLinkActivation(null).kind).toBe("rejected");
    // @ts-expect-error testing runtime tolerance
    expect(resolveTerminalLinkActivation(undefined).kind).toBe("rejected");
  });

  it("accepts file:// with absolute Unix path", () => {
    const r = resolveTerminalLinkActivation("file:///etc/hosts");
    expect(r.kind).toBe("file");
    expect(r.target).toBe("/etc/hosts");
  });

  it("accepts file:// with encoded spaces", () => {
    const r = resolveTerminalLinkActivation("file:///opt/My%20App/bin/start.sh");
    expect(r.kind).toBe("file");
    expect(r.target).toBe("/opt/My App/bin/start.sh");
  });

  it("accepts file:// with localhost host", () => {
    const r = resolveTerminalLinkActivation("file://localhost/etc/hosts");
    expect(r.kind).toBe("file");
    expect(r.target).toBe("/etc/hosts");
  });

  it("rejects file:// with non-local host", () => {
    expect(resolveTerminalLinkActivation("file://other-host/etc/hosts").kind).toBe("rejected");
  });

  it("decodes Windows drive-letter file URIs to backslash paths", () => {
    const r = resolveTerminalLinkActivation("file:///C:/Users/Mike/notes.txt");
    expect(r.kind).toBe("file");
    expect(r.target).toBe("C:\\Users\\Mike\\notes.txt");
  });

  it("decodes Windows drive-letter with spaces via percent encoding", () => {
    const r = resolveTerminalLinkActivation("file:///C:/Program%20Files/App/run.exe");
    expect(r.kind).toBe("file");
    expect(r.target).toBe("C:\\Program Files\\App\\run.exe");
  });

  it("rejects file:// paths containing parent traversal", () => {
    expect(resolveTerminalLinkActivation("file:///etc/../passwd").kind).toBe("rejected");
    expect(resolveTerminalLinkActivation("file:///C:/foo/../bar").kind).toBe("rejected");
  });

  it("rejects malformed file URIs", () => {
    expect(resolveTerminalLinkActivation("file://").kind).toBe("rejected");
    expect(resolveTerminalLinkActivation("file:/etc/hosts").kind).toBe("rejected");
  });

  it("rejects file:// with shell metacharacters in path", () => {
    expect(resolveTerminalLinkActivation("file:///tmp/foo;rm").kind).toBe("rejected");
  });

  it("rejects file:// with malformed percent-encoding", () => {
    expect(resolveTerminalLinkActivation("file:///etc/%ZZhosts").kind).toBe("rejected");
  });
});

describe("activateTerminalLink", () => {
  function makeOpeners() {
    return {
      openUrl: vi.fn().mockResolvedValue(undefined),
      openPath: vi.fn().mockResolvedValue(undefined),
    };
  }

  it("routes https to openUrl", () => {
    const openers = makeOpeners();
    const r = activateTerminalLink("https://example.com", openers);
    expect(r.kind).toBe("http");
    expect(openers.openUrl).toHaveBeenCalledWith("https://example.com");
    expect(openers.openPath).not.toHaveBeenCalled();
  });

  it("routes file:// to openPath after decoding", () => {
    const openers = makeOpeners();
    const r = activateTerminalLink("file:///etc/hosts", openers);
    expect(r.kind).toBe("file");
    expect(openers.openPath).toHaveBeenCalledWith("/etc/hosts");
    expect(openers.openUrl).not.toHaveBeenCalled();
  });

  it("does not invoke openers when rejected", () => {
    const openers = makeOpeners();
    const r = activateTerminalLink("javascript:alert(1)", openers);
    expect(r.kind).toBe("rejected");
    expect(openers.openUrl).not.toHaveBeenCalled();
    expect(openers.openPath).not.toHaveBeenCalled();
  });

  it("swallows async opener rejections", async () => {
    const openers = {
      openUrl: vi.fn().mockRejectedValue(new Error("boom")),
      openPath: vi.fn().mockResolvedValue(undefined),
    };
    expect(() => activateTerminalLink("https://example.com", openers)).not.toThrow();
    // Wait a microtask for the swallow `.catch` to run without surfacing.
    await Promise.resolve();
  });

  it("swallows sync opener throws", () => {
    const openers = {
      openUrl: vi.fn(() => {
        throw new Error("sync boom");
      }),
      openPath: vi.fn(),
    };
    expect(() => activateTerminalLink("https://example.com", openers)).not.toThrow();
  });
});
