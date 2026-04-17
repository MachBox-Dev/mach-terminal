import { describe, expect, it } from "vitest";
import type { AppCommandId } from "./commands";
import { commandToTerminalUiIntent } from "./terminalCommandRouting";

describe("terminal command routing", () => {
  it("maps terminal command ids to terminal UI intents", () => {
    const cases: Array<[AppCommandId, ReturnType<typeof commandToTerminalUiIntent>]> = [
      ["terminal.openFind", "openFind"],
      ["terminal.scrollBottom", "scrollToBottom"],
      ["terminal.findNext", "findNext"],
      ["terminal.findPrevious", "findPrevious"],
      ["terminal.clearViewport", "clearViewport"],
      ["terminal.toggleFollowOutput", "toggleFollowOutput"],
    ];
    for (const [commandId, expected] of cases) {
      expect(commandToTerminalUiIntent(commandId)).toBe(expected);
    }
  });

  it("returns null for non-terminal commands", () => {
    expect(commandToTerminalUiIntent("session.new")).toBeNull();
    expect(commandToTerminalUiIntent("pane.split")).toBeNull();
    expect(commandToTerminalUiIntent("history.refresh")).toBeNull();
    expect(commandToTerminalUiIntent("dev.diagnostics")).toBeNull();
  });
});
