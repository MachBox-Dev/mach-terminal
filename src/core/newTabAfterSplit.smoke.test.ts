import { describe, expect, it } from "vitest";
import {
  activeGroupLayout,
  addNewSessionTab,
  createWorkspaceState,
  reconcileWorkspaceAfterPaneSpawn,
  sessionIdsInGroup,
  setPaneSession,
  splitWorkspaceForNewSession,
} from "../state/workspace";

function paneId(state: ReturnType<typeof createWorkspaceState>) {
  return activeGroupLayout(state).activePaneId;
}

describe("new tab after split smoke", () => {
  it("matches clean launch → split → Ctrl+T tab layout", () => {
    let workspace = createWorkspaceState();
    workspace = setPaneSession(workspace, paneId(workspace), "session-1");

    const split = splitWorkspaceForNewSession(workspace, "session-2", "column");
    workspace = reconcileWorkspaceAfterPaneSpawn(split, ["session-1", "session-2"]);
    expect(workspace.groups).toHaveLength(1);
    expect(activeGroupLayout(workspace).panes).toHaveLength(2);

    workspace = addNewSessionTab(workspace, [], "session-3");

    expect(workspace.groups).toHaveLength(2);
    expect(sessionIdsInGroup(workspace.groups[0]).sort()).toEqual(["session-1", "session-2"]);
    expect(sessionIdsInGroup(workspace.groups[1])).toEqual(["session-3"]);
    expect(workspace.activeGroupId).toBe(workspace.groups[1].id);
  });
});
