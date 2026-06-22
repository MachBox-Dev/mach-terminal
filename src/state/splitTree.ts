export type SplitDirection = "row" | "column";

export interface PaneLeaf {
  kind: "pane";
  id: string;
  sessionId: string | null;
}

export interface SplitBranch {
  kind: "split";
  id: string;
  direction: SplitDirection;
  ratio: number;
  first: SplitNode;
  second: SplitNode;
}

export type SplitNode = PaneLeaf | SplitBranch;

/** Pragmatic cap: 6 panes × 120k scrollback is already heavy on mid-range hardware. */
export const MAX_PANES_PER_GROUP = 6;

const DEFAULT_RATIO = 0.5;
const MIN_RATIO = 0.1;
const MAX_RATIO = 0.9;

let splitBranchCounter = 0;

export function newSplitBranchId(): string {
  splitBranchCounter += 1;
  return `split-${splitBranchCounter}`;
}

export function createPaneLeaf(id: string, sessionId: string | null = null): PaneLeaf {
  return { kind: "pane", id, sessionId };
}

export function createSinglePaneLayout(paneId: string, sessionId: string | null = null): PaneLeaf {
  return createPaneLeaf(paneId, sessionId);
}

export function isPaneLeaf(node: SplitNode): node is PaneLeaf {
  return node.kind === "pane";
}

export function isSplitBranch(node: SplitNode): node is SplitBranch {
  return node.kind === "split";
}

export function countPanes(node: SplitNode): number {
  if (isPaneLeaf(node)) {
    return 1;
  }
  return countPanes(node.first) + countPanes(node.second);
}

export function collectPaneLeaves(node: SplitNode): PaneLeaf[] {
  if (isPaneLeaf(node)) {
    return [node];
  }
  return [...collectPaneLeaves(node.first), ...collectPaneLeaves(node.second)];
}

export function collectSessionIds(node: SplitNode): string[] {
  const ids: string[] = [];
  for (const leaf of collectPaneLeaves(node)) {
    if (leaf.sessionId && !ids.includes(leaf.sessionId)) {
      ids.push(leaf.sessionId);
    }
  }
  return ids;
}

export function findPane(node: SplitNode, paneId: string): PaneLeaf | undefined {
  if (isPaneLeaf(node)) {
    return node.id === paneId ? node : undefined;
  }
  return findPane(node.first, paneId) ?? findPane(node.second, paneId);
}

export function findSplitBranch(node: SplitNode, branchId: string): SplitBranch | undefined {
  if (isPaneLeaf(node)) {
    return undefined;
  }
  if (node.id === branchId) {
    return node;
  }
  return findSplitBranch(node.first, branchId) ?? findSplitBranch(node.second, branchId);
}

export function firstPaneId(node: SplitNode): string {
  if (isPaneLeaf(node)) {
    return node.id;
  }
  return firstPaneId(node.first);
}

/** Migrate legacy flat pane list to a binary tree (balanced pairwise merge). */
export function flatPanesToTree(
  panes: readonly { id: string; sessionId: string | null }[],
  direction: SplitDirection = "column",
): SplitNode {
  const leaves = panes.map((pane) => createPaneLeaf(pane.id, pane.sessionId));
  if (leaves.length === 0) {
    return createPaneLeaf("pane-1", null);
  }
  if (leaves.length === 1) {
    return leaves[0];
  }
  let tree: SplitNode = leaves[0];
  for (let index = 1; index < leaves.length; index += 1) {
    tree = {
      kind: "split",
      id: newSplitBranchId(),
      direction,
      ratio: DEFAULT_RATIO,
      first: tree,
      second: leaves[index],
    };
  }
  return tree;
}

export function flatPanesFromTree(node: SplitNode): PaneLeaf[] {
  return collectPaneLeaves(node);
}

function mapTree(node: SplitNode, fn: (leaf: PaneLeaf) => PaneLeaf): SplitNode {
  if (isPaneLeaf(node)) {
    return fn(node);
  }
  return {
    ...node,
    first: mapTree(node.first, fn),
    second: mapTree(node.second, fn),
  };
}

function mapTreeAtPane(
  node: SplitNode,
  paneId: string,
  fn: (leaf: PaneLeaf) => SplitNode,
): SplitNode | null {
  if (isPaneLeaf(node)) {
    return node.id === paneId ? fn(node) : node;
  }
  const first = mapTreeAtPane(node.first, paneId, fn);
  if (first === null) {
    return null;
  }
  const second = mapTreeAtPane(node.second, paneId, fn);
  if (second === null) {
    return null;
  }
  return { ...node, first, second };
}

export function setPaneSessionOnTree(node: SplitNode, paneId: string, sessionId: string | null): SplitNode {
  return mapTree(node, (leaf) => (leaf.id === paneId ? { ...leaf, sessionId } : leaf));
}

export function setSplitRatio(node: SplitNode, branchId: string, ratio: number): SplitNode {
  const clamped = Math.max(MIN_RATIO, Math.min(MAX_RATIO, ratio));
  if (isPaneLeaf(node)) {
    return node;
  }
  if (node.id === branchId) {
    return { ...node, ratio: clamped };
  }
  return {
    ...node,
    first: setSplitRatio(node.first, branchId, clamped),
    second: setSplitRatio(node.second, branchId, clamped),
  };
}

export function stripDuplicateSessions(node: SplitNode): SplitNode {
  const seen = new Set<string>();
  return mapTree(node, (leaf) => {
    if (!leaf.sessionId) {
      return leaf;
    }
    if (seen.has(leaf.sessionId)) {
      return { ...leaf, sessionId: null };
    }
    seen.add(leaf.sessionId);
    return leaf;
  });
}

function sessionIdsOnOtherLeaves(node: SplitNode, paneId: string): Set<string> {
  const occupied = new Set<string>();
  for (const leaf of collectPaneLeaves(node)) {
    if (leaf.id !== paneId && leaf.sessionId) {
      occupied.add(leaf.sessionId);
    }
  }
  return occupied;
}

/** Split a pane leaf into two panes. Returns null when at cap. */
export function splitPaneAt(
  node: SplitNode,
  paneId: string,
  direction: SplitDirection,
  newPaneId: string,
  newSessionId: string | null,
): SplitNode | null {
  if (countPanes(node) >= MAX_PANES_PER_GROUP) {
    return null;
  }
  const result = mapTreeAtPane(node, paneId, (leaf) => ({
    kind: "split",
    id: newSplitBranchId(),
    direction,
    ratio: DEFAULT_RATIO,
    first: { ...leaf },
    second: createPaneLeaf(newPaneId, newSessionId),
  }));
  return result ?? node;
}

/** Replace session on inactive pane when already at cap. */
export function replaceInactivePaneSession(
  node: SplitNode,
  activePaneId: string,
  newSessionId: string,
): SplitNode {
  const leaves = collectPaneLeaves(node);
  const inactive = leaves.find((leaf) => leaf.id !== activePaneId) ?? leaves[0];
  if (!inactive) {
    return node;
  }
  return setPaneSessionOnTree(node, inactive.id, newSessionId);
}

export function inactivePaneSessionIdFromTree(node: SplitNode, activePaneId: string): string | null {
  const leaves = collectPaneLeaves(node);
  if (leaves.length < 2) {
    return null;
  }
  const inactive = leaves.find((leaf) => leaf.id !== activePaneId) ?? leaves[0];
  return inactive?.sessionId ?? null;
}

type CloseResult = { layout: SplitNode; nextActivePaneId: string };

function closePaneInParent(
  node: SplitNode,
  paneId: string,
  activePaneId: string,
): CloseResult | null {
  if (isPaneLeaf(node)) {
    return null;
  }

  if (isPaneLeaf(node.first) && node.first.id === paneId) {
    const nextActive = activePaneId === paneId ? firstPaneId(node.second) : activePaneId;
    return { layout: node.second, nextActivePaneId: nextActive };
  }
  if (isPaneLeaf(node.second) && node.second.id === paneId) {
    const nextActive = activePaneId === paneId ? firstPaneId(node.first) : activePaneId;
    return { layout: node.first, nextActivePaneId: nextActive };
  }

  const firstResult = closePaneInParent(node.first, paneId, activePaneId);
  if (firstResult) {
    return {
      layout: { ...node, first: firstResult.layout },
      nextActivePaneId: firstResult.nextActivePaneId,
    };
  }

  const secondResult = closePaneInParent(node.second, paneId, activePaneId);
  if (secondResult) {
    return {
      layout: { ...node, second: secondResult.layout },
      nextActivePaneId: secondResult.nextActivePaneId,
    };
  }

  return null;
}

/** Remove a pane leaf and promote its sibling. Returns null if only one pane or pane not found. */
export function closePaneAt(
  node: SplitNode,
  paneId: string,
  activePaneId: string,
): CloseResult | null {
  if (isPaneLeaf(node)) {
    return null;
  }
  return closePaneInParent(node, paneId, activePaneId);
}

export function reconcileTreeSessions(
  node: SplitNode,
  available: Set<string>,
  activePaneId: string,
  pickFallback: (candidates: string[]) => string | null,
): { layout: SplitNode; activePaneId: string } {
  let layout = mapTree(node, (leaf) => ({
    ...leaf,
    sessionId: leaf.sessionId && available.has(leaf.sessionId) ? leaf.sessionId : null,
  }));

  const leaves = collectPaneLeaves(layout);
  let nextActive = leaves.some((leaf) => leaf.id === activePaneId) ? activePaneId : (leaves[0]?.id ?? activePaneId);

  const activeLeaf = findPane(layout, nextActive);
  if (activeLeaf && !activeLeaf.sessionId) {
    const occupied = sessionIdsOnOtherLeaves(layout, nextActive);
    const candidates = [...available].filter((id) => !occupied.has(id));
    const fallback = pickFallback(candidates);
    if (fallback) {
      layout = setPaneSessionOnTree(layout, nextActive, fallback);
    } else {
      const withSession = leaves.find((leaf) => leaf.sessionId);
      if (withSession) {
        nextActive = withSession.id;
      }
    }
  }

  return { layout: stripDuplicateSessions(layout), activePaneId: nextActive };
}

export function collapseTreeToSinglePane(node: SplitNode): PaneLeaf {
  const withSession = collectPaneLeaves(node).find((leaf) => leaf.sessionId);
  if (withSession) {
    return { kind: "pane", id: withSession.id, sessionId: withSession.sessionId };
  }
  const first = collectPaneLeaves(node)[0];
  return first ?? createPaneLeaf("pane-1", null);
}

export function splitWorkspaceTreeForNewSession(
  layout: SplitNode,
  activePaneId: string,
  newPaneId: string,
  newSessionId: string,
  direction: SplitDirection,
): { layout: SplitNode; activePaneId: string } {
  if (countPanes(layout) < MAX_PANES_PER_GROUP) {
    const split = splitPaneAt(layout, activePaneId, direction, newPaneId, newSessionId);
    if (split) {
      return { layout: stripDuplicateSessions(split), activePaneId: newPaneId };
    }
  }
  const replaced = replaceInactivePaneSession(layout, activePaneId, newSessionId);
  return { layout: stripDuplicateSessions(replaced), activePaneId };
}

export function walkPaneLeaves(node: SplitNode): PaneLeaf[] {
  return collectPaneLeaves(node);
}

export function remapSessionIdsOnTree(node: SplitNode, idMap: Record<string, string>): SplitNode {
  return mapTree(node, (leaf) => ({
    ...leaf,
    sessionId: leaf.sessionId ? (idMap[leaf.sessionId] ?? null) : null,
  }));
}
