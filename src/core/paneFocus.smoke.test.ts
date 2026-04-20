import { describe, expect, it } from "vitest";
import { commandToTerminalUiIntent } from "./terminalCommandRouting";
import { evaluateTerminalUiIntent } from "./terminalUiIntent";
import { closePane, createWorkspaceState, setPaneSession, splitActivePane } from "../state/workspace";

describe("Pane focus and follow-output smoke contracts", () => {
  it("consumes terminal UI requests on focused pane only without deferred replay", () => {
    const request = { kind: "toggleFollowOutput" as const, seq: 6 };
    const paneAUnfocused = evaluateTerminalUiIntent({
      request,
      isFocused: false,
      consumedSeq: 3,
      findQuery: "build",
      followOutput: true,
    });
    const paneBFocused = evaluateTerminalUiIntent({
      request,
      isFocused: true,
      consumedSeq: 3,
      findQuery: "build",
      followOutput: true,
    });

    expect(paneAUnfocused).toEqual({ nextConsumedSeq: 6 });
    expect(paneBFocused).toEqual({
      nextConsumedSeq: 6,
      action: { type: "setFollowOutput", followOutput: false, scrollToBottom: false },
    });

    const paneAFocusedLater = evaluateTerminalUiIntent({
      request,
      isFocused: true,
      consumedSeq: paneAUnfocused.nextConsumedSeq,
      findQuery: "build",
      followOutput: true,
    });
    expect(paneAFocusedLater).toEqual({ nextConsumedSeq: 6 });
  });

  it("keeps follow-output command contracts stable for palette actions", () => {
    expect(commandToTerminalUiIntent("terminal.scrollBottom")).toBe("scrollToBottom");
    expect(commandToTerminalUiIntent("terminal.toggleFollowOutput")).toBe("toggleFollowOutput");

    const toggleOff = evaluateTerminalUiIntent({
      request: { kind: "toggleFollowOutput", seq: 20 },
      isFocused: true,
      consumedSeq: 19,
      findQuery: "",
      followOutput: true,
    });
    const toggleOn = evaluateTerminalUiIntent({
      request: { kind: "toggleFollowOutput", seq: 21 },
      isFocused: true,
      consumedSeq: 20,
      findQuery: "",
      followOutput: false,
    });
    const scrollBottom = evaluateTerminalUiIntent({
      request: { kind: "scrollToBottom", seq: 22 },
      isFocused: true,
      consumedSeq: 21,
      findQuery: "",
      followOutput: false,
    });

    expect(toggleOff.action).toEqual({
      type: "setFollowOutput",
      followOutput: false,
      scrollToBottom: false,
    });
    expect(toggleOn.action).toEqual({
      type: "setFollowOutput",
      followOutput: true,
      scrollToBottom: true,
    });
    expect(scrollBottom.action).toEqual({ type: "scrollToBottom" });
  });

  it("preserves deterministic active-pane fallback through rapid split and close transitions", () => {
    let workspace = createWorkspaceState();
    workspace = setPaneSession(workspace, workspace.activePaneId, "session-a");
    workspace = splitActivePane(workspace, "session-b", "row");
    workspace = splitActivePane(workspace, "session-c", "row");
    workspace = splitActivePane(workspace, "session-d", "row");

    const closingOrder = [workspace.activePaneId];
    workspace = closePane(workspace, workspace.activePaneId);
    closingOrder.push(workspace.activePaneId);
    workspace = closePane(workspace, workspace.activePaneId);
    closingOrder.push(workspace.activePaneId);
    workspace = closePane(workspace, workspace.activePaneId);
    closingOrder.push(workspace.activePaneId);

    expect(closingOrder).toEqual(["pane-4", "pane-3", "pane-2", "pane-1"]);
    expect(workspace.panes).toHaveLength(1);
    expect(workspace.activePaneId).toBe("pane-1");
  });
});
