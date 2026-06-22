import { describe, expect, it } from "vitest";
import { commandToTerminalUiIntent } from "./terminalCommandRouting";
import { evaluateTerminalUiIntent } from "./terminalUiIntent";
import { closePane, createWorkspaceState, setPaneSession, splitActivePane, activeGroupLayout } from "../state/workspace";

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

  it("maps clearViewport for focused pane without requiring find query state", () => {
    const cleared = evaluateTerminalUiIntent({
      request: { kind: "clearViewport", seq: 33 },
      isFocused: true,
      consumedSeq: 32,
      findQuery: "",
      followOutput: true,
    });
    expect(cleared).toEqual({ nextConsumedSeq: 33, action: { type: "clearViewport" } });

    const unfocused = evaluateTerminalUiIntent({
      request: { kind: "clearViewport", seq: 34 },
      isFocused: false,
      consumedSeq: 32,
      findQuery: "",
      followOutput: true,
    });
    expect(unfocused).toEqual({ nextConsumedSeq: 34 });
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
    const layout = () => activeGroupLayout(workspace);
    workspace = setPaneSession(workspace, layout().activePaneId, "session-a");
    workspace = splitActivePane(workspace, "session-b", "row");
    workspace = splitActivePane(workspace, "session-c", "row");
    workspace = splitActivePane(workspace, "session-d", "row");

    const paneIds = layout().panes.map((pane) => pane.id);
    const closingOrder = [layout().activePaneId];
    workspace = closePane(workspace, layout().activePaneId);
    closingOrder.push(layout().activePaneId);
    workspace = closePane(workspace, layout().activePaneId);
    closingOrder.push(layout().activePaneId);
    workspace = closePane(workspace, layout().activePaneId);
    closingOrder.push(layout().activePaneId);

    expect(closingOrder).toEqual([paneIds[3], paneIds[2], paneIds[1], paneIds[0]]);
    expect(layout().panes).toHaveLength(1);
    expect(layout().activePaneId).toBe(paneIds[0]);
  });
});
