import { describe, expect, it } from "vitest";
import {
  closePane,
  createWorkspaceState,
  reconcileWorkspace,
  removeSessionFromWorkspace,
  restoreWorkspaceFromSnapshot,
  setSplitDirection,
  setPaneSession,
  splitActivePane,
  workspaceLayoutFromSnapshot,
  WORKSPACE_LAYOUT_SCHEMA_VERSION,
} from "./workspace";

describe("workspace reconciliation", () => {
  it("reassigns active pane to first available session", () => {
    let workspace = createWorkspaceState();
    workspace = setPaneSession(workspace, workspace.activePaneId, "session-a");
    workspace = splitActivePane(workspace, "session-b");
    workspace = removeSessionFromWorkspace(workspace, "session-b", ["session-a"]);
    const activePane = workspace.panes.find((pane) => pane.id === workspace.activePaneId);
    expect(activePane?.sessionId).toBe("session-a");
  });

  it("drops pane session references for dead sessions", () => {
    let workspace = createWorkspaceState();
    workspace = setPaneSession(workspace, workspace.activePaneId, "session-a");
    const reconciled = reconcileWorkspace(workspace, []);
    expect(reconciled.panes[0].sessionId).toBeNull();
  });

  it("keeps chosen split orientation when splitting", () => {
    let workspace = createWorkspaceState();
    workspace = setSplitDirection(workspace, "row");
    workspace = splitActivePane(workspace, "session-a", "row");
    expect(workspace.splitDirection).toBe("row");
    expect(workspace.panes).toHaveLength(2);
  });

  it("chooses neighboring pane as active when closing active pane", () => {
    let workspace = createWorkspaceState();
    workspace = setPaneSession(workspace, workspace.activePaneId, "session-a");
    workspace = splitActivePane(workspace, "session-b", "column");
    workspace = splitActivePane(workspace, "session-c", "column");
    const activeBeforeClose = workspace.activePaneId;
    workspace = closePane(workspace, activeBeforeClose);
    expect(workspace.activePaneId).not.toBe(activeBeforeClose);
    expect(workspace.panes).toHaveLength(2);
  });
});

describe("workspace restore", () => {
  it("restores valid snapshot when session ids exist", () => {
    const snapshot = JSON.stringify({
      rootPaneId: "pane-1",
      activePaneId: "pane-2",
      splitDirection: "column",
      panes: [
        { id: "pane-1", sessionId: "session-a" },
        { id: "pane-2", sessionId: "session-b" },
      ],
    });
    const restored = restoreWorkspaceFromSnapshot(snapshot, ["session-a", "session-b"], createWorkspaceState());
    expect(restored.activePaneId).toBe("pane-2");
    expect(restored.panes).toHaveLength(2);
  });

  it("falls back to provided state for malformed snapshot", () => {
    const fallback = createWorkspaceState();
    const restored = restoreWorkspaceFromSnapshot("{malformed", ["session-a"], fallback);
    expect(restored.panes).toHaveLength(1);
    expect(restored.activePaneId).toBe(fallback.activePaneId);
  });

  it("workspaceLayoutFromSnapshot adds schema version for disk payload", () => {
    const snap = {
      rootPaneId: "pane-1",
      activePaneId: "pane-1",
      splitDirection: "row" as const,
      panes: [{ id: "pane-1", sessionId: "s-1" as string | null }],
    };
    const layout = workspaceLayoutFromSnapshot(snap);
    expect(layout.schemaVersion).toBe(WORKSPACE_LAYOUT_SCHEMA_VERSION);
    expect(layout.splitDirection).toBe("row");
    expect(layout.panes[0].sessionId).toBe("s-1");
  });
});
