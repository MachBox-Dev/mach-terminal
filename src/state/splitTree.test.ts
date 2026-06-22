import { describe, expect, it } from "vitest";
import {
  closePaneAt,
  collectPaneLeaves,
  countPanes,
  createSinglePaneLayout,
  flatPanesToTree,
  inactivePaneSessionIdFromTree,
  MAX_PANES_PER_GROUP,
  setSplitRatio,
  splitPaneAt,
  splitWorkspaceTreeForNewSession,
  stripDuplicateSessions,
  type SplitNode,
} from "./splitTree";

describe("splitTree", () => {
  it("counts panes in nested tree", () => {
    let layout: SplitNode = createSinglePaneLayout("p1", "a");
    layout = splitPaneAt(layout, "p1", "column", "p2", "b")!;
    layout = splitPaneAt(layout, "p2", "row", "p3", "c")!;
    expect(countPanes(layout)).toBe(3);
  });

  it("splitPaneAt refuses at cap", () => {
    let layout: SplitNode = createSinglePaneLayout("p1", "a");
    for (let index = 2; index <= MAX_PANES_PER_GROUP; index += 1) {
      const next = splitPaneAt(layout, `p${index - 1}`, "column", `p${index}`, `s${index}`);
      expect(next).not.toBeNull();
      layout = next!;
    }
    expect(countPanes(layout)).toBe(MAX_PANES_PER_GROUP);
    expect(splitPaneAt(layout, "p1", "column", "overflow", "x")).toBeNull();
  });

  it("closePaneAt promotes sibling", () => {
    const layout = splitPaneAt(createSinglePaneLayout("p1", "a"), "p1", "column", "p2", "b")!;
    const closed = closePaneAt(layout, "p2", "p2");
    expect(closed).not.toBeNull();
    expect(collectPaneLeaves(closed!.layout)).toHaveLength(1);
    expect(collectPaneLeaves(closed!.layout)[0].sessionId).toBe("a");
    expect(closed!.nextActivePaneId).toBe("p1");
  });

  it("flatPanesToTree builds chain from legacy panes", () => {
    const tree = flatPanesToTree(
      [
        { id: "pane-1", sessionId: "a" },
        { id: "pane-2", sessionId: "b" },
      ],
      "column",
    );
    expect(countPanes(tree)).toBe(2);
  });

  it("splitWorkspaceTreeForNewSession adds pane when below cap", () => {
    const layout = createSinglePaneLayout("p1", "a");
    const result = splitWorkspaceTreeForNewSession(layout, "p1", "p2", "b", "column");
    expect(countPanes(result.layout)).toBe(2);
    expect(result.activePaneId).toBe("p2");
  });

  it("splitWorkspaceTreeForNewSession replaces inactive at cap", () => {
    let layout: SplitNode = createSinglePaneLayout("p1", "a");
    for (let index = 2; index <= MAX_PANES_PER_GROUP; index += 1) {
      layout = splitWorkspaceTreeForNewSession(
        layout,
        `p${index - 1}`,
        `p${index}`,
        `s${index}`,
        "column",
      ).layout;
    }
    const result = splitWorkspaceTreeForNewSession(layout, "p1", "p-new", "replacement", "column");
    expect(countPanes(result.layout)).toBe(MAX_PANES_PER_GROUP);
    expect(collectPaneLeaves(result.layout).some((leaf) => leaf.sessionId === "replacement")).toBe(true);
  });

  it("inactivePaneSessionIdFromTree returns non-active session", () => {
    const layout = splitPaneAt(createSinglePaneLayout("p1", "a"), "p1", "column", "p2", "b")!;
    expect(inactivePaneSessionIdFromTree(layout, "p2")).toBe("a");
  });

  it("stripDuplicateSessions clears duplicate session ids", () => {
    let layout = splitPaneAt(createSinglePaneLayout("p1", "a"), "p1", "column", "p2", "a")!;
    const stripped = stripDuplicateSessions(layout);
    const sessions = collectPaneLeaves(stripped).map((leaf) => leaf.sessionId).filter(Boolean);
    expect(new Set(sessions).size).toBe(sessions.length);
  });

  it("setSplitRatio clamps ratio", () => {
    const layout = splitPaneAt(createSinglePaneLayout("p1", "a"), "p1", "column", "p2", "b")!;
    const branch = layout.kind === "split" ? layout : null;
    expect(branch).not.toBeNull();
    const updated = setSplitRatio(layout, branch!.id, 0.99);
    const updatedBranch = updated.kind === "split" ? updated : null;
    expect(updatedBranch?.ratio).toBe(0.9);
  });
});
