import { describe, expect, it } from "vitest";
import { isShellExitCommand, isShellExitPayload, appendTerminalInputLine } from "./shellExitCommand";

describe("shellExitCommand", () => {
  it("recognizes exit and logout variants", () => {
    expect(isShellExitCommand("exit")).toBe(true);
    expect(isShellExitCommand("EXIT")).toBe(true);
    expect(isShellExitCommand("exit 1")).toBe(true);
    expect(isShellExitCommand("logout")).toBe(true);
    expect(isShellExitCommand("exitt")).toBe(false);
    expect(isShellExitCommand("cd exit")).toBe(false);
  });

  it("recognizes PTY payloads with line endings", () => {
    expect(isShellExitPayload("exit\r")).toBe(true);
    expect(isShellExitPayload("exit\r\n")).toBe(true);
    expect(isShellExitPayload("  logout \n")).toBe(true);
    expect(isShellExitPayload("echo exit\r")).toBe(false);
    expect(isShellExitPayload("exit\r\nexit\r\n")).toBe(false);
  });

  it("tracks terminal line buffers until Enter", () => {
    let line = "";
    ({ line } = appendTerminalInputLine(line, "ex"));
    ({ line } = appendTerminalInputLine(line, "it"));
    const result = appendTerminalInputLine(line, "\r");
    expect(result.submitted).toBe("exit");
    expect(result.line).toBe("");
  });
});
