import { describe, expect, it } from "vitest";
import {
  activeGroupLayout,
  addGroupForSession,
  addNewSessionTab,
  buildRestorableSessions,
  closePane,
  createWorkspaceState,
  reconcileWorkspace,
  remapLayoutToSnapshot,
  resolveNextActivePaneIdAfterClose,
  removeSessionFromWorkspace,
  restoreWorkspaceFromSnapshot,
  selectSessionInWorkspace,
  selectTabGroup,
  sessionIdsInGroup,
  setSplitDirection,
  setActivePane,
  setPaneSession,
  setTargetPane,
  focusAndTargetPane,
  splitActivePane,
  bootstrapWorkspaceFromSessions,
  reconcileWorkspaceAfterPaneSpawn,
  reconcileWorkspaceInPlace,
  sessionIdsBoundInWorkspace,
  splitWorkspaceForNewSession,
  displacedSessionIdForSplitCap,
  inactivePaneSessionId,
  MAX_PANES_PER_GROUP,
  trimWorkspacePanes,
  workspaceLayoutFromSnapshot,
  WORKSPACE_LAYOUT_SCHEMA_VERSION,
  type WorkspaceState,
} from "./workspace";

function layoutOf(state: WorkspaceState) {
  return activeGroupLayout(state);
}

function paneId(state: WorkspaceState) {
  return layoutOf(state).activePaneId;
}

describe("workspace reconciliation", () => {
  it("reassigns active pane to first available session", () => {
    let workspace = createWorkspaceState();
    workspace = setPaneSession(workspace, paneId(workspace), "session-a");
    workspace = splitActivePane(workspace, "session-b");
    workspace = removeSessionFromWorkspace(workspace, "session-b", ["session-a"]);
    const activePane = layoutOf(workspace).panes.find((pane) => pane.id === paneId(workspace));
    expect(activePane?.sessionId).toBe("session-a");
    expect(layoutOf(workspace).panes).toHaveLength(1);
  });

  it("collapses a pane when removing one session from a four-pane group", () => {
    let workspace = createWorkspaceState();
    workspace = setPaneSession(workspace, paneId(workspace), "session-a");
    workspace = splitActivePane(workspace, "session-b", "column");
    workspace = splitActivePane(workspace, "session-c", "row");
    workspace = splitActivePane(workspace, "session-d", "column");
    expect(layoutOf(workspace).panes).toHaveLength(4);
    workspace = removeSessionFromWorkspace(workspace, "session-d", ["session-a", "session-b", "session-c"]);
    expect(layoutOf(workspace).panes).toHaveLength(3);
    expect(layoutOf(workspace).panes.some((pane) => pane.sessionId === "session-d")).toBe(false);
  });

  it("drops pane session references for dead sessions", () => {
    let workspace = createWorkspaceState();
    workspace = setPaneSession(workspace, paneId(workspace), "session-a");
    const reconciled = reconcileWorkspace(workspace, []);
    expect(layoutOf(reconciled).panes[0].sessionId).toBeNull();
  });

  it("keeps chosen split orientation when splitting", () => {
    let workspace = createWorkspaceState();
    workspace = setSplitDirection(workspace, "row");
    workspace = splitActivePane(workspace, "session-a", "row");
    expect(layoutOf(workspace).splitDirection).toBe("row");
    expect(layoutOf(workspace).panes).toHaveLength(2);
  });

  it("one-off row split does not change default split direction", () => {
    let workspace = createWorkspaceState();
    expect(layoutOf(workspace).splitDirection).toBe("column");
    workspace = splitActivePane(workspace, "session-a", "row");
    expect(layoutOf(workspace).splitDirection).toBe("column");
    workspace = splitWorkspaceForNewSession(workspace, "session-b", "row");
    expect(layoutOf(workspace).splitDirection).toBe("column");
    workspace = splitWorkspaceForNewSession(workspace, "session-c", "column");
    expect(layoutOf(workspace).splitDirection).toBe("column");
  });

  it("setActivePane and setTargetPane are independent", () => {
    let workspace = createWorkspaceState();
    workspace = setPaneSession(workspace, paneId(workspace), "session-a");
    workspace = splitActivePane(workspace, "session-b", "column");
    const firstPane = layoutOf(workspace).panes[0]?.id;
    const secondPane = layoutOf(workspace).panes[1]?.id;
    expect(firstPane).toBeTruthy();
    expect(secondPane).toBeTruthy();
    workspace = setTargetPane(workspace, firstPane!);
    workspace = setActivePane(workspace, secondPane!);
    expect(layoutOf(workspace).activePaneId).toBe(secondPane);
    expect(layoutOf(workspace).targetPaneId).toBe(firstPane);
    workspace = setTargetPane(workspace, secondPane!);
    expect(layoutOf(workspace).targetPaneId).toBe(secondPane);
  });

  it("keeps active and target aligned when closing a pane", () => {
    let workspace = createWorkspaceState();
    workspace = setPaneSession(workspace, paneId(workspace), "session-a");
    workspace = splitActivePane(workspace, "session-b", "column");
    workspace = splitActivePane(workspace, "session-c", "row");
    const thirdPane = layoutOf(workspace).panes[2]?.id;
    expect(thirdPane).toBeTruthy();
    workspace = focusAndTargetPane(workspace, thirdPane!);
    const before = layoutOf(workspace);
    expect(before.activePaneId).toBe(thirdPane);
    expect(before.targetPaneId).toBe(thirdPane);
    workspace = closePane(workspace, thirdPane!);
    const after = layoutOf(workspace);
    expect(after.panes).toHaveLength(2);
    expect(after.activePaneId).toBe(after.targetPaneId);
  });

  it("chooses neighboring pane as active when closing active pane", () => {
    let workspace = createWorkspaceState();
    workspace = setPaneSession(workspace, paneId(workspace), "session-a");
    workspace = splitActivePane(workspace, "session-b", "column");
    workspace = splitActivePane(workspace, "session-c", "column");
    const activeBeforeClose = paneId(workspace);
    workspace = closePane(workspace, activeBeforeClose);
    expect(paneId(workspace)).not.toBe(activeBeforeClose);
    expect(layoutOf(workspace).panes).toHaveLength(2);
  });

  it("keeps active pane unchanged when closing a non-active pane", () => {
    let workspace = createWorkspaceState();
    workspace = setPaneSession(workspace, paneId(workspace), "session-a");
    workspace = splitActivePane(workspace, "session-b", "column");
    const activePane = paneId(workspace);
    const firstPaneId = layoutOf(workspace).panes[0]?.id ?? activePane;
    workspace = closePane(workspace, firstPaneId);
    expect(paneId(workspace)).toBe(activePane);
  });

  it("resolves deterministic active-pane fallback for rapid close sequences", () => {
    let workspace = createWorkspaceState();
    workspace = setPaneSession(workspace, paneId(workspace), "session-a");
    workspace = splitActivePane(workspace, "session-b", "row");
    workspace = splitActivePane(workspace, "session-c", "row");
    workspace = splitActivePane(workspace, "session-d", "row");
    const paneIds = layoutOf(workspace).panes.map((pane) => pane.id);
    expect(paneIds).toHaveLength(4);

    const nextAfterLastClose = resolveNextActivePaneIdAfterClose(
      layoutOf(workspace).panes,
      paneId(workspace),
      paneId(workspace),
    );
    expect(nextAfterLastClose).toBe(paneIds[2]);

    workspace = closePane(workspace, paneId(workspace));
    expect(paneId(workspace)).toBe(paneIds[2]);
    workspace = closePane(workspace, paneId(workspace));
    expect(paneId(workspace)).toBe(paneIds[1]);
    workspace = closePane(workspace, paneId(workspace));
    expect(paneId(workspace)).toBe(paneIds[0]);
    workspace = closePane(workspace, paneId(workspace));
    expect(paneId(workspace)).toBe(paneIds[0]);
    expect(layoutOf(workspace).panes).toHaveLength(1);
  });
});

describe("tab groups", () => {
  it("addGroupForSession creates a new top-level tab", () => {
    let workspace = createWorkspaceState();
    workspace = setPaneSession(workspace, paneId(workspace), "session-a");
    workspace = addGroupForSession(workspace, "session-b");
    expect(workspace.groups).toHaveLength(2);
    expect(workspace.activeGroupId).toBe(workspace.groups[1].id);
    expect(layoutOf(workspace).panes[0].sessionId).toBe("session-b");
  });

  it("addNewSessionTab creates exactly one group for a new session", () => {
    let workspace = createWorkspaceState();
    workspace = setPaneSession(workspace, paneId(workspace), "session-a");
    workspace = addNewSessionTab(workspace, ["session-a"], "session-b");
    expect(workspace.groups).toHaveLength(2);
    expect(sessionIdsInGroup(workspace.groups[0])).toEqual(["session-a"]);
    expect(sessionIdsInGroup(workspace.groups[1])).toEqual(["session-b"]);
    expect(workspace.activeGroupId).toBe(workspace.groups[1].id);
  });

  it("addNewSessionTab after split keeps both panes in the first tab", () => {
    let workspace = createWorkspaceState();
    workspace = setPaneSession(workspace, paneId(workspace), "session-a");
    workspace = splitWorkspaceForNewSession(workspace, "session-b", "column");
    workspace = reconcileWorkspaceAfterPaneSpawn(workspace, ["session-a", "session-b"]);
    const next = addNewSessionTab(workspace, ["session-a", "session-b"], "session-c");
    expect(next.groups).toHaveLength(2);
    expect(sessionIdsInGroup(next.groups[0]).sort()).toEqual(["session-a", "session-b"]);
    expect(sessionIdsInGroup(next.groups[1])).toEqual(["session-c"]);
    expect(next.activeGroupId).toBe(next.groups[1].id);
  });

  it("addNewSessionTab with stale session list keeps split pane bindings", () => {
    let workspace = createWorkspaceState();
    workspace = setPaneSession(workspace, paneId(workspace), "session-a");
    workspace = splitWorkspaceForNewSession(workspace, "session-b", "column");
    workspace = reconcileWorkspaceAfterPaneSpawn(workspace, ["session-a", "session-b"]);
    const next = addNewSessionTab(workspace, ["session-a"], "session-c");
    expect(next.groups).toHaveLength(2);
    expect(sessionIdsInGroup(next.groups[0]).sort()).toEqual(["session-a", "session-b"]);
    expect(sessionIdsInGroup(next.groups[1])).toEqual(["session-c"]);
  });

  it("simulates split then Ctrl+T without reconciling orphans into tabs", () => {
    let workspace = createWorkspaceState();
    workspace = setPaneSession(workspace, paneId(workspace), "session-a");
    const split = splitWorkspaceForNewSession(workspace, "session-b", "column");
    workspace = reconcileWorkspaceAfterPaneSpawn(split, ["session-a", "session-b"]);
    workspace = addNewSessionTab(workspace, [], "session-c");
    expect(workspace.groups).toHaveLength(2);
    expect(sessionIdsInGroup(workspace.groups[0]).sort()).toEqual(["session-a", "session-b"]);
    expect(sessionIdsInGroup(workspace.groups[1])).toEqual(["session-c"]);
    expect(workspace.activeGroupId).toBe(workspace.groups[1].id);
  });

  it("sessionIdsBoundInWorkspace collects ids from split layout", () => {
    let workspace = createWorkspaceState();
    workspace = setPaneSession(workspace, paneId(workspace), "session-a");
    workspace = splitWorkspaceForNewSession(workspace, "session-b", "column");
    expect(sessionIdsBoundInWorkspace(workspace).sort()).toEqual(["session-a", "session-b"]);
  });

  it("reconcileWorkspaceInPlace never opens orphan top-level tabs", () => {
    const empty: WorkspaceState = { groups: [], activeGroupId: "" };
    const repaired = reconcileWorkspaceInPlace(empty, ["session-a", "session-b", "session-c"]);
    expect(repaired.groups).toHaveLength(1);
    expect(sessionIdsInGroup(repaired.groups[0]).sort()).toEqual(["session-a", "session-b", "session-c"]);
  });

  it("reconcileWorkspace drops duplicate tab groups that host the same session", () => {
    let workspace = createWorkspaceState();
    workspace = setPaneSession(workspace, paneId(workspace), "session-a");
    const duplicate = {
      ...workspace.groups[0],
      id: "group-b",
      layout: workspace.groups[0].layout,
      primarySessionId: "session-a",
    };
    const repaired = reconcileWorkspace(
      { groups: [workspace.groups[0], duplicate], activeGroupId: "group-b" },
      ["session-a"],
    );
    expect(repaired.groups).toHaveLength(1);
    expect(sessionIdsInGroup(repaired.groups[0])).toEqual(["session-a"]);
    expect(repaired.activeGroupId).toBe("group-b");
  });

  it("splitWorkspaceForNewSession keeps both sessions in the same tab group", () => {
    let workspace = createWorkspaceState();
    workspace = setPaneSession(workspace, paneId(workspace), "session-a");
    workspace = splitWorkspaceForNewSession(workspace, "session-b", "column");
    expect(workspace.groups).toHaveLength(1);
    const layout = layoutOf(workspace);
    expect(layout.panes).toHaveLength(2);
    expect(layout.panes[0].sessionId).toBe("session-a");
    expect(layout.panes[1].sessionId).toBe("session-b");
  });

  it("inactivePaneSessionId returns the non-active pane session when split", () => {
    let workspace = createWorkspaceState();
    workspace = setPaneSession(workspace, paneId(workspace), "session-a");
    workspace = splitWorkspaceForNewSession(workspace, "session-b", "column");
    expect(inactivePaneSessionId(workspace)).toBe("session-a");
  });

  it("re-split without displaced session does not spawn a stray tab group", () => {
    let workspace = createWorkspaceState();
    workspace = setPaneSession(workspace, paneId(workspace), "session-a");
    workspace = splitWorkspaceForNewSession(workspace, "session-b", "column");
    workspace = splitWorkspaceForNewSession(workspace, "session-c", "column");
    const repaired = reconcileWorkspace(workspace, ["session-a", "session-c"]);
    expect(repaired.groups).toHaveLength(1);
    expect(sessionIdsInGroup(repaired.groups[0]).sort()).toEqual(["session-a", "session-c"]);
  });

  it("reconcile fills empty panes before creating orphan tabs", () => {
    let workspace = createWorkspaceState();
    workspace = setPaneSession(workspace, paneId(workspace), "session-a");
    workspace = splitWorkspaceForNewSession(workspace, "session-b", "column");
    workspace = splitWorkspaceForNewSession(workspace, null as unknown as string, "column");
    const layout = layoutOf(workspace);
    const emptyPane = layout.panes.find((pane) => !pane.sessionId);
    expect(emptyPane).toBeTruthy();
    const repaired = reconcileWorkspace(workspace, ["session-a", "session-b", "session-c"]);
    expect(repaired.groups).toHaveLength(1);
    expect(layoutOf(repaired).panes).toHaveLength(3);
    expect(sessionIdsInGroup(repaired.groups[0]).sort()).toEqual(["session-a", "session-b", "session-c"]);
    expect(layoutOf(repaired).panes.every((pane) => pane.sessionId)).toBe(true);
  });

  it("split fills an empty targeted pane instead of adding another empty pane", () => {
    let workspace = createWorkspaceState();
    workspace = setPaneSession(workspace, paneId(workspace), "session-a");
    workspace = splitWorkspaceForNewSession(workspace, "session-b", "column");
    workspace = splitWorkspaceForNewSession(workspace, null as unknown as string, "column");
    const emptyPane = layoutOf(workspace).panes.find((pane) => !pane.sessionId);
    expect(emptyPane).toBeTruthy();
    workspace = setTargetPane(workspace, emptyPane!.id);
    workspace = splitWorkspaceForNewSession(workspace, "session-c", "column");
    const layout = layoutOf(workspace);
    expect(layout.panes).toHaveLength(3);
    expect(layout.panes.every((pane) => pane.sessionId)).toBe(true);
    expect(sessionIdsInGroup(workspace.groups[0]).sort()).toEqual(["session-a", "session-b", "session-c"]);
  });

  it("two splits with full session list stay in one tab", () => {
    let workspace = createWorkspaceState();
    workspace = setPaneSession(workspace, paneId(workspace), "session-a");
    workspace = splitWorkspaceForNewSession(workspace, "session-b", "column");
    workspace = reconcileWorkspace(workspace, ["session-a", "session-b"]);
    workspace = splitWorkspaceForNewSession(workspace, "session-c", "column");
    workspace = reconcileWorkspaceAfterPaneSpawn(workspace, ["session-a", "session-b", "session-c"]);
    expect(workspace.groups).toHaveLength(1);
    expect(layoutOf(workspace).panes).toHaveLength(3);
    expect(layoutOf(workspace).panes.every((pane) => pane.sessionId)).toBe(true);
  });

  it("bootstrapWorkspaceFromSessions keeps zombie PTYs in one tab", () => {
    const workspace = bootstrapWorkspaceFromSessions(["session-a", "session-b"]);
    expect(workspace.groups).toHaveLength(1);
    expect(layoutOf(workspace).panes).toHaveLength(2);
    expect(sessionIdsInGroup(workspace.groups[0]).sort()).toEqual(["session-a", "session-b"]);
  });

  it("reconcileWorkspaceAfterPaneSpawn never opens stray tabs", () => {
    let workspace = createWorkspaceState();
    workspace = setPaneSession(workspace, paneId(workspace), "session-a");
    workspace = splitWorkspaceForNewSession(workspace, "session-b", "column");
    const repaired = reconcileWorkspaceAfterPaneSpawn(workspace, ["session-a", "session-b", "session-c"]);
    expect(repaired.groups).toHaveLength(1);
    expect(sessionIdsInGroup(repaired.groups[0]).sort()).toEqual(["session-a", "session-b", "session-c"]);
    expect(layoutOf(repaired).panes.every((pane) => pane.sessionId)).toBe(true);
  });

  it("split on second tab stays in that tab without double-splitting tab zero", () => {
    let workspace = createWorkspaceState();
    workspace = setPaneSession(workspace, paneId(workspace), "session-a");
    workspace = addGroupForSession(workspace, "session-b");
    const secondTabId = workspace.groups[1].id;
    workspace = selectTabGroup(workspace, secondTabId);
    workspace = splitWorkspaceForNewSession(workspace, "session-c", "column");
    workspace = reconcileWorkspaceAfterPaneSpawn(workspace, ["session-a", "session-b", "session-c"]);
    expect(workspace.groups).toHaveLength(2);
    expect(workspace.activeGroupId).toBe(secondTabId);
    expect(sessionIdsInGroup(workspace.groups[0])).toEqual(["session-a"]);
    expect(sessionIdsInGroup(workspace.groups[1]).sort()).toEqual(["session-b", "session-c"]);
    expect(layoutOf(workspace).panes).toHaveLength(2);
    expect(layoutOf(workspace).panes.every((pane) => pane.sessionId)).toBe(true);
  });

  it("prunes empty panes after reconcile", () => {
    let workspace = createWorkspaceState();
    workspace = setPaneSession(workspace, paneId(workspace), "session-a");
    workspace = splitWorkspaceForNewSession(workspace, "session-b", "column");
    workspace = splitWorkspaceForNewSession(workspace, null as unknown as string, "column");
    expect(layoutOf(workspace).panes).toHaveLength(3);
    workspace = reconcileWorkspaceAfterPaneSpawn(workspace, ["session-a", "session-b"]);
    expect(layoutOf(workspace).panes).toHaveLength(2);
    expect(layoutOf(workspace).panes.every((pane) => pane.sessionId)).toBe(true);
  });

  it("legacy two-pane layout restores as one split tab group", () => {
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
    expect(restored.groups).toHaveLength(1);
    const layout = layoutOf(restored);
    expect(layout.panes).toHaveLength(2);
    expect(layout.panes.map((pane) => pane.sessionId).sort()).toEqual(["session-a", "session-b"]);
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
    expect(paneId(restored)).toBe("pane-2");
    expect(layoutOf(restored).panes).toHaveLength(2);
  });

  it("falls back to provided state for malformed snapshot", () => {
    const fallback = createWorkspaceState();
    const restored = restoreWorkspaceFromSnapshot("{malformed", ["session-a"], fallback);
    expect(layoutOf(restored).panes).toHaveLength(1);
    expect(paneId(restored)).toBe(paneId(fallback));
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
    expect(layout.sessions).toEqual([]);
  });

  it("workspaceLayoutFromSnapshot carries restorable sessions", () => {
    const snap = {
      rootPaneId: "pane-1",
      activePaneId: "pane-1",
      splitDirection: "column" as const,
      panes: [{ id: "pane-1", sessionId: "session-1" as string | null }],
    };
    const layout = workspaceLayoutFromSnapshot(snap, [
      { sessionId: "session-1", shell: "wsl.exe", cwd: "/home/me", name: "build" },
    ]);
    expect(layout.sessions).toEqual([{ sessionId: "session-1", shell: "wsl.exe", cwd: "/home/me", name: "build" }]);
  });
});

describe("buildRestorableSessions", () => {
  it("captures shell, cwd, and custom name, omitting empties", () => {
    const result = buildRestorableSessions(
      [
        { id: "session-1", shell: "wsl.exe" },
        { id: "session-2", shell: "pwsh.exe" },
      ],
      (id) => (id === "session-1" ? "/home/me" : undefined),
      { "session-2": "deploy" },
    );
    expect(result).toEqual([
      { sessionId: "session-1", shell: "wsl.exe", cwd: "/home/me" },
      { sessionId: "session-2", shell: "pwsh.exe", name: "deploy" },
    ]);
  });

  it("drops whitespace-only names", () => {
    const result = buildRestorableSessions([{ id: "session-1", shell: "bash" }], () => undefined, {
      "session-1": "   ",
    });
    expect(result).toEqual([{ sessionId: "session-1", shell: "bash" }]);
  });
});

describe("remapLayoutToSnapshot", () => {
  it("rewrites pane session ids via the id map and nulls unmapped ones", () => {
    const snapshot = remapLayoutToSnapshot(
      {
        rootPaneId: "pane-1",
        activePaneId: "pane-2",
        splitDirection: "row",
        panes: [
          { id: "pane-1", sessionId: "session-1" },
          { id: "pane-2", sessionId: "session-2" },
          { id: "pane-3", sessionId: "session-gone" },
        ],
      },
      { "session-1": "session-7", "session-2": "session-8" },
    );
    expect(snapshot.panes).toEqual([
      { id: "pane-1", sessionId: "session-7" },
      { id: "pane-2", sessionId: "session-8" },
      { id: "pane-3", sessionId: null },
    ]);
    expect(snapshot.activePaneId).toBe("pane-2");
    expect(snapshot.splitDirection).toBe("row");
  });

  it("splitWorkspaceForNewSession keeps first pane session and assigns new id to second", () => {
    let workspace = createWorkspaceState();
    workspace = setPaneSession(workspace, paneId(workspace), "session-a");
    workspace = splitWorkspaceForNewSession(workspace, "session-b", "column");
    const layout = layoutOf(workspace);
    expect(layout.panes).toHaveLength(2);
    expect(layout.panes[0].sessionId).toBe("session-a");
    expect(layout.panes[1].sessionId).toBe("session-b");
    expect(paneId(workspace)).toBe(layout.panes[1].id);
  });

  it("displacedSessionIdForSplitCap is null below pane cap", () => {
    let workspace = createWorkspaceState();
    workspace = setPaneSession(workspace, paneId(workspace), "session-a");
    workspace = splitWorkspaceForNewSession(workspace, "session-b", "column");
    expect(displacedSessionIdForSplitCap(workspace)).toBeNull();
  });

  it("displacedSessionIdForSplitCap returns inactive session at cap", () => {
    let workspace = createWorkspaceState();
    workspace = setPaneSession(workspace, paneId(workspace), "session-0");
    for (let index = 1; index < MAX_PANES_PER_GROUP; index += 1) {
      workspace = splitWorkspaceForNewSession(workspace, `session-${index}`, "column");
    }
    expect(displacedSessionIdForSplitCap(workspace)).toBeTruthy();
  });

  it("splitWorkspaceForNewSession adds a third pane when below cap", () => {
    let workspace = createWorkspaceState();
    workspace = setPaneSession(workspace, paneId(workspace), "session-a");
    workspace = splitWorkspaceForNewSession(workspace, "session-b", "column");
    workspace = splitWorkspaceForNewSession(workspace, "session-c", "column");
    const layout = layoutOf(workspace);
    expect(layout.panes).toHaveLength(3);
    expect(layout.panes.map((pane) => pane.sessionId).sort()).toEqual(["session-a", "session-b", "session-c"]);
    expect(paneId(workspace)).toBe(layout.panes.find((pane) => pane.sessionId === "session-c")?.id);
  });

  it("splitWorkspaceForNewSession replaces inactive pane at cap", () => {
    let workspace = createWorkspaceState();
    workspace = setPaneSession(workspace, paneId(workspace), "session-0");
    for (let index = 1; index < MAX_PANES_PER_GROUP; index += 1) {
      workspace = splitWorkspaceForNewSession(workspace, `session-${index}`, "column");
    }
    expect(layoutOf(workspace).panes).toHaveLength(MAX_PANES_PER_GROUP);
    const inactiveBefore = inactivePaneSessionId(workspace);
    workspace = splitWorkspaceForNewSession(workspace, "session-replacement", "column");
    const layout = layoutOf(workspace);
    expect(layout.panes).toHaveLength(MAX_PANES_PER_GROUP);
    expect(layout.panes.some((pane) => pane.sessionId === "session-replacement")).toBe(true);
    if (inactiveBefore) {
      expect(layout.panes.some((pane) => pane.sessionId === inactiveBefore)).toBe(false);
    }
  });

  it("trimWorkspacePanes is a no-op (pane cap removed)", () => {
    let workspace = createWorkspaceState();
    workspace = splitActivePane(workspace, "session-a", "row");
    workspace = splitActivePane(workspace, "session-b", "row");
    workspace = splitActivePane(workspace, "session-c", "row");
    expect(layoutOf(workspace).panes).toHaveLength(4);
    const trimmed = trimWorkspacePanes(workspace);
    expect(layoutOf(trimmed).panes).toHaveLength(4);
  });

  it("supports four panes in one tab group", () => {
    let workspace = createWorkspaceState();
    workspace = setPaneSession(workspace, paneId(workspace), "session-a");
    workspace = splitActivePane(workspace, "session-b", "column");
    workspace = splitActivePane(workspace, "session-c", "row");
    workspace = splitActivePane(workspace, "session-d", "column");
    expect(layoutOf(workspace).panes).toHaveLength(4);
  });

  it("selectSessionInWorkspace focuses pane that already hosts the session", () => {
    let workspace = createWorkspaceState();
    workspace = setPaneSession(workspace, paneId(workspace), "session-a");
    workspace = splitWorkspaceForNewSession(workspace, "session-b", "column");
    const before = layoutOf(workspace);
    workspace = selectSessionInWorkspace(workspace, "session-a");
    const after = layoutOf(workspace);
    expect(paneId(workspace)).toBe(before.panes[0].id);
    expect(after.panes.find((pane) => pane.id === before.panes[0].id)?.sessionId).toBe("session-a");
    expect(after.panes.find((pane) => pane.id === before.panes[1].id)?.sessionId).toBe("session-b");
  });

  it("reconcileWorkspace does not duplicate a session across panes", () => {
    let workspace = createWorkspaceState();
    workspace = setPaneSession(workspace, paneId(workspace), "session-a");
    workspace = splitActivePane(workspace, "session-a", "column");
    const reconciled = reconcileWorkspace(workspace, ["session-a", "session-b"]);
    const ids = layoutOf(reconciled).panes.map((pane) => pane.sessionId).filter(Boolean);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("selectSessionInWorkspace assigns to active pane when session is not shown elsewhere", () => {
    let workspace = createWorkspaceState();
    workspace = setPaneSession(workspace, paneId(workspace), "session-a");
    workspace = splitWorkspaceForNewSession(workspace, "session-b", "column");
    workspace = selectSessionInWorkspace(workspace, "session-c");
    const layout = layoutOf(workspace);
    const active = layout.panes.find((pane) => pane.id === paneId(workspace));
    expect(active?.sessionId).toBe("session-c");
    expect(layout.panes.find((pane) => pane.id !== paneId(workspace))?.sessionId).toBe("session-a");
  });

  it("selectTabGroup repairs stale pane ids and syncs target to focus", () => {
    let workspace = createWorkspaceState();
    workspace = setPaneSession(workspace, paneId(workspace), "session-a");
    const second = addNewSessionTab(workspace, ["session-a"], "session-b");
    const secondGroupId = second.groups[1]!.id;
    const stale = {
      ...second.groups[1]!,
      activePaneId: "ghost-pane",
      targetPaneId: "also-ghost",
    };
    workspace = {
      ...second,
      groups: second.groups.map((group) => (group.id === secondGroupId ? stale : group)),
    };
    const selected = selectTabGroup(workspace, secondGroupId);
    const group = selected.groups.find((candidate) => candidate.id === secondGroupId)!;
    const layout = layoutOf({ ...selected, activeGroupId: secondGroupId });
    expect(layout.activePaneId).toBe(group.activePaneId);
    expect(layout.targetPaneId).toBe(layout.activePaneId);
    expect(layout.panes.some((pane) => pane.id === layout.activePaneId)).toBe(true);
  });
});
