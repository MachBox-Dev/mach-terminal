export type SplitDirection = "row" | "column";

import type { SessionInputMode } from "../core/inputMode";
import {
  closePaneAt,
  collectPaneLeaves,
  collectSessionIds,
  countPanes,
  createPaneLeaf,
  createSinglePaneLayout,
  findPane,
  firstPaneId,
  flatPanesFromTree,
  flatPanesToTree,
  inactivePaneSessionIdFromTree,
  isPaneLeaf,
  MAX_PANES_PER_GROUP,
  reconcileTreeSessions,
  setPaneSessionOnTree,
  setSplitRatio,
  splitPaneAt,
  splitWorkspaceTreeForNewSession,
  stripDuplicateSessions,
  type SplitNode,
} from "./splitTree";

export type { SplitNode } from "./splitTree";

export interface PaneNode {
  id: string;
  sessionId: string | null;
}

/** One tab in the tab bar; may contain up to MAX_PANES_PER_GROUP split panes. */
export interface TabGroup {
  id: string;
  /** Tab label anchor; first session bound to the group when unset. */
  primarySessionId: string;
  layout: SplitNode;
  activePaneId: string;
  /** Composer submit destination (TER-15). Defaults to activePaneId on focus. */
  targetPaneId: string;
  /** When true, composer Enter sends to all operator panes (TER-16). */
  broadcastMode: boolean;
  /** Direction used for the next split operation. */
  defaultSplitDirection: SplitDirection;
}

export interface WorkspaceState {
  groups: TabGroup[];
  activeGroupId: string;
}

/** Snapshot of the active tab group for rendering. */
export interface GroupLayoutSnapshot {
  layout: SplitNode;
  activePaneId: string;
  targetPaneId: string;
  broadcastMode: boolean;
  /** Direction for the next split; derived from group.defaultSplitDirection. */
  splitDirection: SplitDirection;
  /** Flat pane list for legacy callers (walk order). */
  panes: PaneNode[];
}

/** @deprecated Use GroupLayoutSnapshot; kept for persistence legacy fields. */
export interface WorkspaceSnapshot {
  rootPaneId: string;
  panes: PaneNode[];
  activePaneId: string;
  splitDirection: SplitDirection;
}

/** v2 tree node for disk / Rust mirror. */
export interface SplitNodeSnapshot {
  kind: "pane" | "split";
  id: string;
  sessionId?: string | null;
  direction?: SplitDirection;
  ratio?: number;
  first?: SplitNodeSnapshot;
  second?: SplitNodeSnapshot;
}

export interface TabGroupSnapshot {
  id: string;
  primarySessionId: string;
  /** v2 tree layout. */
  layout?: SplitNodeSnapshot;
  /** Legacy flat panes (v1). */
  panes?: PaneNode[];
  activePaneId: string;
  splitDirection?: SplitDirection;
  targetPaneId?: string;
  broadcastMode?: boolean;
}

export interface RestorableSession {
  sessionId: string;
  shell: string;
  cwd?: string;
  name?: string;
  chatKey?: string;
  inputMode?: SessionInputMode;
}

export interface WorkspaceLayout {
  schemaVersion: number;
  rootPaneId: string;
  panes: PaneNode[];
  activePaneId: string;
  splitDirection: SplitDirection;
  sessions?: RestorableSession[];
  groups?: TabGroupSnapshot[];
  activeGroupId?: string;
}

export const WORKSPACE_LAYOUT_SCHEMA_VERSION = 2;

const DEFAULT_ROOT_PANE = "pane-1";

let tabGroupCounter = 0;

function newTabGroupId(): string {
  tabGroupCounter += 1;
  return `group-${tabGroupCounter}`;
}

function newPaneId(groupId: string, index: number): string {
  return `${groupId}-pane-${index}`;
}

function panesFromLayout(layout: SplitNode): PaneNode[] {
  return flatPanesFromTree(layout).map((leaf) => ({ id: leaf.id, sessionId: leaf.sessionId }));
}

function defaultTargetForGroup(group: TabGroup): string {
  if (findPane(group.layout, group.targetPaneId)) {
    return group.targetPaneId;
  }
  return defaultActivePaneForGroup(group);
}

function defaultActivePaneForGroup(group: TabGroup): string {
  if (findPane(group.layout, group.activePaneId)) {
    return group.activePaneId;
  }
  return collectPaneLeaves(group.layout)[0]?.id ?? group.activePaneId;
}

export function getActiveGroup(state: WorkspaceState): TabGroup | undefined {
  return state.groups.find((group) => group.id === state.activeGroupId) ?? state.groups[0];
}

export function activeGroupLayout(state: WorkspaceState): GroupLayoutSnapshot {
  const group = getActiveGroup(state);
  if (!group) {
    const layout = createSinglePaneLayout(DEFAULT_ROOT_PANE, null);
    return {
      layout,
      activePaneId: DEFAULT_ROOT_PANE,
      targetPaneId: DEFAULT_ROOT_PANE,
      broadcastMode: false,
      splitDirection: "column",
      panes: [{ id: DEFAULT_ROOT_PANE, sessionId: null }],
    };
  }
  const activePaneId = defaultActivePaneForGroup(group);
  const targetPaneId = defaultTargetForGroup(group);
  return {
    layout: group.layout,
    activePaneId,
    targetPaneId,
    broadcastMode: group.broadcastMode,
    splitDirection: group.defaultSplitDirection,
    panes: panesFromLayout(group.layout),
  };
}

function updateActiveGroup(state: WorkspaceState, updater: (group: TabGroup) => TabGroup): WorkspaceState {
  const activeId = state.activeGroupId;
  let found = false;
  const groups = state.groups.map((group) => {
    if (group.id !== activeId) {
      return group;
    }
    found = true;
    return updater(group);
  });
  if (!found && groups.length > 0) {
    return { groups: [updater(groups[0]), ...groups.slice(1)], activeGroupId: groups[0].id };
  }
  return { ...state, groups };
}

function createSinglePaneGroup(sessionId: string | null = null, groupId = newTabGroupId()): TabGroup {
  const paneId = newPaneId(groupId, 1);
  const layout = createSinglePaneLayout(paneId, sessionId);
  return {
    id: groupId,
    primarySessionId: sessionId ?? "",
    layout,
    activePaneId: paneId,
    targetPaneId: paneId,
    broadcastMode: false,
    defaultSplitDirection: "column",
  };
}

function stripDuplicatePaneSessionsInGroup(group: TabGroup): TabGroup {
  const stripped = stripDuplicateSessions(group.layout);
  if (stripped === group.layout) {
    return group;
  }
  return { ...group, layout: stripped };
}

export function createWorkspaceState(): WorkspaceState {
  const groupId = newTabGroupId();
  const group = createSinglePaneGroup(null, groupId);
  return {
    groups: [group],
    activeGroupId: group.id,
  };
}

export function addGroupForSession(state: WorkspaceState, sessionId: string): WorkspaceState {
  const existing = findTabGroupForSession(state, sessionId);
  if (existing) {
    return { ...state, activeGroupId: existing.id };
  }
  const group = createSinglePaneGroup(sessionId);
  return {
    groups: [...state.groups, group],
    activeGroupId: group.id,
  };
}

/** New top-level tab for a freshly spawned session (avoids reconcile + addGroup double-create). */
export function addNewSessionTab(
  state: WorkspaceState,
  existingSessionIds: readonly string[],
  newSessionId: string,
): WorkspaceState {
  const repaired = reconcileWorkspace(state, [...existingSessionIds]);
  return addGroupForSession(repaired, newSessionId);
}

export function selectTabGroup(state: WorkspaceState, groupId: string): WorkspaceState {
  if (!state.groups.some((group) => group.id === groupId)) {
    return state;
  }
  return { ...state, activeGroupId: groupId };
}

export function setPaneSession(state: WorkspaceState, paneId: string, sessionId: string | null): WorkspaceState {
  return updateActiveGroup(state, (group) => {
    const layout = setPaneSessionOnTree(group.layout, paneId, sessionId);
    const primarySessionId =
      group.primarySessionId && collectSessionIds(layout).includes(group.primarySessionId)
        ? group.primarySessionId
        : (sessionId ?? group.primarySessionId);
    return stripDuplicatePaneSessionsInGroup({ ...group, layout, primarySessionId });
  });
}

/**
 * Pane focus vs composer target (multi-pane Operator mode):
 * - activePaneId (Focus): keyboard + terminal UI + AI/ops context for this leaf.
 * - targetPaneId (Target): group composer routes Enter / exit / completion here.
 * Click a pane body to focus; click a composer pill or use target hotkeys to retarget.
 * Hotkeys: see keymap.ts (Ctrl+Alt+N focus, Ctrl+Alt+Shift+N target on Windows).
 */
export function setActivePane(state: WorkspaceState, paneId: string): WorkspaceState {
  return updateActiveGroup(state, (group) => {
    if (!findPane(group.layout, paneId)) {
      return group;
    }
    return { ...group, activePaneId: paneId };
  });
}

export function setTargetPane(state: WorkspaceState, paneId: string): WorkspaceState {
  return updateActiveGroup(state, (group) => {
    if (!findPane(group.layout, paneId)) {
      return group;
    }
    return { ...group, targetPaneId: paneId };
  });
}

/** Focus + composer target together (pane pill, split spawn). */
export function focusAndTargetPane(state: WorkspaceState, paneId: string): WorkspaceState {
  return setActivePane(setTargetPane(state, paneId), paneId);
}

export function toggleBroadcastMode(state: WorkspaceState): WorkspaceState {
  return updateActiveGroup(state, (group) => ({ ...group, broadcastMode: !group.broadcastMode }));
}

export function setBroadcastMode(state: WorkspaceState, enabled: boolean): WorkspaceState {
  return updateActiveGroup(state, (group) =>
    group.broadcastMode === enabled ? group : { ...group, broadcastMode: enabled },
  );
}

export function setSplitDirection(state: WorkspaceState, splitDirection: SplitDirection): WorkspaceState {
  return updateActiveGroup(state, (group) => ({ ...group, defaultSplitDirection: splitDirection }));
}

export function setSplitRatioOnWorkspace(
  state: WorkspaceState,
  branchId: string,
  ratio: number,
): WorkspaceState {
  return updateActiveGroup(state, (group) => ({
    ...group,
    layout: setSplitRatio(group.layout, branchId, ratio),
  }));
}

function nextPaneIndex(group: TabGroup): number {
  return collectPaneLeaves(group.layout).length + 1;
}

export function splitActivePane(
  state: WorkspaceState,
  sessionId: string | null,
  splitDirection?: SplitDirection,
): WorkspaceState {
  return updateActiveGroup(state, (group) => {
    const direction = splitDirection ?? group.defaultSplitDirection;
    const nextId = newPaneId(group.id, nextPaneIndex(group));
    const split = splitPaneAt(group.layout, group.activePaneId, direction, nextId, sessionId);
    if (!split) {
      return group;
    }
    return stripDuplicatePaneSessionsInGroup({
      ...group,
      layout: split,
      activePaneId: nextId,
      targetPaneId: nextId,
    });
  });
}

export function inactivePaneSessionId(state: WorkspaceState): string | null {
  const group = getActiveGroup(state);
  if (!group) {
    return null;
  }
  return inactivePaneSessionIdFromTree(group.layout, group.activePaneId);
}

/** Session to close when splitting at the pane cap (replaces inactive pane instead of adding). */
export function displacedSessionIdForSplitCap(state: WorkspaceState): string | null {
  const group = getActiveGroup(state);
  if (!group || countPanes(group.layout) < MAX_PANES_PER_GROUP) {
    return null;
  }
  const paneToSplit = findPane(group.layout, group.targetPaneId) ? group.targetPaneId : group.activePaneId;
  return inactivePaneSessionIdFromTree(group.layout, paneToSplit);
}

function assignUnassignedSessionsToEmptyPanes(
  groups: TabGroup[],
  activeGroupId: string,
  unassigned: readonly string[],
): { groups: TabGroup[]; remaining: string[] } {
  const remaining = [...unassigned];
  if (remaining.length === 0) {
    return { groups, remaining };
  }
  const ordered = [
    ...groups.filter((group) => group.id === activeGroupId),
    ...groups.filter((group) => group.id !== activeGroupId),
  ];
  const byId = new Map(groups.map((group) => [group.id, group]));
  for (const group of ordered) {
    let nextGroup = byId.get(group.id)!;
    for (const leaf of collectPaneLeaves(nextGroup.layout)) {
      if (remaining.length === 0) {
        break;
      }
      if (!leaf.sessionId) {
        nextGroup = {
          ...nextGroup,
          layout: setPaneSessionOnTree(nextGroup.layout, leaf.id, remaining.shift()!),
        };
        byId.set(nextGroup.id, nextGroup);
      }
    }
  }
  return { groups: groups.map((group) => byId.get(group.id)!), remaining };
}

function appendUnassignedSessionsAsPanes(
  state: WorkspaceState,
  unassigned: readonly string[],
): { state: WorkspaceState; remaining: string[] } {
  let next = state;
  const remaining = [...unassigned];
  while (remaining.length > 0) {
    const group = getActiveGroup(next);
    if (!group || countPanes(group.layout) >= MAX_PANES_PER_GROUP) {
      break;
    }
    next = splitWorkspaceForNewSession(next, remaining.shift()!, group.defaultSplitDirection);
  }
  return { state: next, remaining };
}

function pruneEmptyPaneLeavesInGroup(group: TabGroup): TabGroup {
  let layout = group.layout;
  let activePaneId = group.activePaneId;
  let targetPaneId = group.targetPaneId;
  let changed = true;
  while (changed) {
    changed = false;
    const leaves = collectPaneLeaves(layout);
    if (leaves.length <= 1) {
      break;
    }
    const empty = leaves.find((leaf) => !leaf.sessionId);
    if (!empty) {
      break;
    }
    const closed = closePaneAt(layout, empty.id, activePaneId);
    if (!closed) {
      break;
    }
    layout = closed.layout;
    activePaneId = closed.nextActivePaneId;
    if (!findPane(layout, targetPaneId)) {
      targetPaneId = activePaneId;
    }
    changed = true;
  }
  if (
    layout === group.layout &&
    activePaneId === group.activePaneId &&
    targetPaneId === group.targetPaneId
  ) {
    return group;
  }
  return { ...group, layout, activePaneId, targetPaneId };
}

function finalizeReconciledWorkspace(
  state: WorkspaceState,
  available: Set<string>,
  preferredActiveGroupId: string,
): WorkspaceState {
  let groups = state.groups
    .map(collapseGroupAfterSessionRemoval)
    .map(pruneEmptyPaneLeavesInGroup)
    .filter((group) =>
      collectPaneLeaves(group.layout).some((leaf) => leaf.sessionId && available.has(leaf.sessionId)),
    );

  const activeGroupId = groups.some((group) => group.id === preferredActiveGroupId)
    ? preferredActiveGroupId
    : (groups[0]?.id ?? preferredActiveGroupId);

  groups = dedupeSessionsAcrossTabGroups(groups, activeGroupId).map(pruneEmptyPaneLeavesInGroup);

  if (groups.length === 0) {
    return createWorkspaceState();
  }

  const resolvedActiveGroupId = groups.some((group) => group.id === activeGroupId)
    ? activeGroupId
    : groups[0].id;

  return stripDuplicatePaneSessions({ groups, activeGroupId: resolvedActiveGroupId });
}

function collectAssignedSessionIds(groups: readonly TabGroup[]): Set<string> {
  const assigned = new Set<string>();
  for (const group of groups) {
    for (const sessionId of collectSessionIds(group.layout)) {
      assigned.add(sessionId);
    }
  }
  return assigned;
}

export function splitWorkspaceForNewSession(
  state: WorkspaceState,
  newSessionId: string,
  splitDirection?: SplitDirection,
): WorkspaceState {
  return updateActiveGroup(state, (group) => {
    const direction = splitDirection ?? group.defaultSplitDirection;
    const paneToSplit = findPane(group.layout, group.targetPaneId) ? group.targetPaneId : group.activePaneId;
    const targetLeaf = findPane(group.layout, paneToSplit);

    // Reuse an empty targeted pane instead of splitting nothing into more empty panes.
    if (targetLeaf && !targetLeaf.sessionId) {
      const layout = setPaneSessionOnTree(group.layout, paneToSplit, newSessionId);
      const primarySessionId = group.primarySessionId || collectSessionIds(layout)[0] || newSessionId;
      return stripDuplicatePaneSessionsInGroup({
        ...group,
        layout,
        activePaneId: paneToSplit,
        targetPaneId: paneToSplit,
        primarySessionId,
      });
    }

    const nextId = newPaneId(group.id, nextPaneIndex(group));
    const result = splitWorkspaceTreeForNewSession(
      group.layout,
      paneToSplit,
      nextId,
      newSessionId,
      direction,
    );
    const primarySessionId =
      group.primarySessionId || collectSessionIds(result.layout)[0] || newSessionId;
    return stripDuplicatePaneSessionsInGroup({
      ...group,
      layout: result.layout,
      activePaneId: result.activePaneId,
      targetPaneId: result.activePaneId,
      primarySessionId,
    });
  });
}

export function findPaneIdForSession(state: WorkspaceState, sessionId: string): string | null {
  return findSessionPaneHost(state, sessionId)?.paneId ?? null;
}

export function findSessionPaneHost(
  state: WorkspaceState,
  sessionId: string,
): { groupId: string; paneId: string; paneCount: number } | null {
  for (const group of state.groups) {
    for (const leaf of collectPaneLeaves(group.layout)) {
      if (leaf.sessionId === sessionId) {
        return {
          groupId: group.id,
          paneId: leaf.id,
          paneCount: countPanes(group.layout),
        };
      }
    }
  }
  return null;
}

export function selectSessionInWorkspace(state: WorkspaceState, sessionId: string): WorkspaceState {
  for (const group of state.groups) {
    const leaves = collectPaneLeaves(group.layout);
    const hostPane = leaves.find((leaf) => leaf.sessionId === sessionId);
    if (hostPane) {
      return {
        groups: state.groups.map((candidate) =>
          candidate.id === group.id
            ? { ...candidate, activePaneId: hostPane.id, targetPaneId: hostPane.id }
            : candidate,
        ),
        activeGroupId: group.id,
      };
    }
  }
  return setPaneSession(state, getActiveGroup(state)?.activePaneId ?? DEFAULT_ROOT_PANE, sessionId);
}

export function stripDuplicatePaneSessions(state: WorkspaceState): WorkspaceState {
  let changed = false;
  const groups = state.groups.map((group) => {
    const next = stripDuplicatePaneSessionsInGroup(group);
    if (next !== group) {
      changed = true;
    }
    return next;
  });
  return changed ? { ...state, groups } : state;
}

export function resolveNextActivePaneIdAfterClose(
  panes: PaneNode[],
  activePaneId: string,
  closingPaneId: string,
): string {
  if (panes.length <= 1 || activePaneId !== closingPaneId) {
    return activePaneId;
  }
  const paneIndex = panes.findIndex((pane) => pane.id === closingPaneId);
  if (paneIndex < 0) {
    return activePaneId;
  }
  const nextPanes = panes.filter((pane) => pane.id !== closingPaneId);
  if (nextPanes.length === 0) {
    return activePaneId;
  }
  const fallbackActiveIndex = Math.max(0, Math.min(paneIndex, nextPanes.length - 1));
  return nextPanes[fallbackActiveIndex].id;
}

export function closePane(state: WorkspaceState, paneId: string): WorkspaceState {
  return updateActiveGroup(state, (group) => {
    if (countPanes(group.layout) <= 1) {
      return group;
    }
    const closed = closePaneAt(group.layout, paneId, group.activePaneId);
    if (!closed) {
      return group;
    }
    const nextActive = closed.nextActivePaneId;
    return {
      ...group,
      layout: closed.layout,
      activePaneId: nextActive,
      targetPaneId: nextActive,
    };
  });
}

export function pickSessionFallback(availableSessionIds: string[], preferredSessionIds: Array<string | null | undefined>): string | null {
  for (const preferred of preferredSessionIds) {
    if (!preferred) {
      continue;
    }
    if (availableSessionIds.includes(preferred)) {
      return preferred;
    }
  }
  return availableSessionIds[0] ?? null;
}

function reconcileGroup(group: TabGroup, available: Set<string>): TabGroup {
  const reconciled = reconcileTreeSessions(
    group.layout,
    available,
    group.activePaneId,
    (candidates) => pickSessionFallback(candidates, []),
  );
  let next: TabGroup = {
    ...group,
    layout: reconciled.layout,
    activePaneId: reconciled.activePaneId,
    targetPaneId: findPane(reconciled.layout, group.targetPaneId)
      ? group.targetPaneId
      : reconciled.activePaneId,
  };

  if (countPanes(next.layout) === 0) {
    const paneId = newPaneId(next.id, 1);
    next = {
      ...next,
      layout: createPaneLeaf(paneId, null),
      activePaneId: paneId,
      targetPaneId: paneId,
    };
  }

  return stripDuplicatePaneSessionsInGroup(next);
}

function collapseGroupAfterSessionRemoval(group: TabGroup): TabGroup {
  const live = collectPaneLeaves(group.layout).filter((leaf) => leaf.sessionId);
  if (live.length === 0) {
    return group;
  }
  if (live.length === 1) {
    const pane = live[0];
    return {
      ...group,
      layout: createPaneLeaf(pane.id, pane.sessionId),
      activePaneId: pane.id,
      targetPaneId: pane.id,
      primarySessionId: group.primarySessionId || pane.sessionId || "",
    };
  }
  return group;
}

function dedupeSessionsAcrossTabGroups(groups: TabGroup[], activeGroupId: string): TabGroup[] {
  const canonicalOwner = new Map<string, string>();

  const active = groups.find((group) => group.id === activeGroupId);
  if (active) {
    for (const sessionId of collectSessionIds(active.layout)) {
      canonicalOwner.set(sessionId, active.id);
    }
  }

  for (const group of groups) {
    for (const sessionId of collectSessionIds(group.layout)) {
      if (!canonicalOwner.has(sessionId)) {
        canonicalOwner.set(sessionId, group.id);
      }
    }
  }

  const deduped = groups.map((group) => {
    const foreignSessions = collectSessionIds(group.layout).filter(
      (sessionId) => canonicalOwner.get(sessionId) !== group.id,
    );
    if (foreignSessions.length === 0) {
      return group;
    }
    let layout = group.layout;
    for (const sessionId of foreignSessions) {
      layout = mapSessionsOnTree(layout, sessionId);
    }
    return collapseGroupAfterSessionRemoval({ ...group, layout });
  });

  return deduped.filter((group) =>
    collectPaneLeaves(group.layout).some((leaf) => leaf.sessionId),
  );
}

export function bootstrapWorkspaceFromSessions(sessionIds: readonly string[]): WorkspaceState {
  if (sessionIds.length === 0) {
    return createWorkspaceState();
  }
  let state = createWorkspaceState();
  const rootPaneId = activeGroupLayout(state).activePaneId;
  state = setPaneSession(state, rootPaneId, sessionIds[0]);
  for (let index = 1; index < sessionIds.length; index += 1) {
    state = splitWorkspaceForNewSession(state, sessionIds[index], "column");
  }
  return reconcileWorkspace(state, [...sessionIds]);
}

/** Reconcile after spawning into a split pane — never opens stray top-level tabs. */
export function reconcileWorkspaceAfterPaneSpawn(
  state: WorkspaceState,
  availableSessionIds: string[],
): WorkspaceState {
  const available = new Set(availableSessionIds);
  let groups = state.groups.map((group) => reconcileGroup(group, available));

  let assigned = collectAssignedSessionIds(groups);
  let unassigned = availableSessionIds.filter((sessionId) => !assigned.has(sessionId));
  if (unassigned.length > 0) {
    const filled = assignUnassignedSessionsToEmptyPanes(groups, state.activeGroupId, unassigned);
    groups = filled.groups;
    unassigned = filled.remaining;
  }

  let next: WorkspaceState = { groups, activeGroupId: state.activeGroupId };
  if (unassigned.length > 0) {
    const appended = appendUnassignedSessionsAsPanes(next, unassigned);
    next = appended.state;
    unassigned = appended.remaining;
  }

  return finalizeReconciledWorkspace(next, available, state.activeGroupId);
}

export function reconcileWorkspace(state: WorkspaceState, availableSessionIds: string[]): WorkspaceState {
  const available = new Set(availableSessionIds);
  let groups = state.groups.map((group) => reconcileGroup(group, available));

  let assigned = collectAssignedSessionIds(groups);
  let unassigned = availableSessionIds.filter((sessionId) => !assigned.has(sessionId));
  if (unassigned.length > 0) {
    const filled = assignUnassignedSessionsToEmptyPanes(groups, state.activeGroupId, unassigned);
    groups = filled.groups;
    unassigned = filled.remaining;
    assigned = collectAssignedSessionIds(groups);
  }

  let next: WorkspaceState = { groups, activeGroupId: state.activeGroupId };
  if (unassigned.length > 0) {
    const appended = appendUnassignedSessionsAsPanes(next, unassigned);
    next = appended.state;
    unassigned = appended.remaining;
    assigned = collectAssignedSessionIds(next.groups);
  }

  for (const sessionId of unassigned) {
    if (!assigned.has(sessionId)) {
      next = {
        groups: [...next.groups, createSinglePaneGroup(sessionId)],
        activeGroupId: next.activeGroupId,
      };
      assigned.add(sessionId);
    }
  }

  return finalizeReconciledWorkspace(next, available, state.activeGroupId);
}

export function removeSessionFromWorkspace(state: WorkspaceState, sessionId: string, availableSessionIds: string[]): WorkspaceState {
  const groups = state.groups.map((group) => {
    const hostPane = collectPaneLeaves(group.layout).find((leaf) => leaf.sessionId === sessionId);
    if (hostPane && countPanes(group.layout) > 1) {
      const closed = closePaneAt(group.layout, hostPane.id, group.activePaneId);
      if (closed) {
        const nextActive = closed.nextActivePaneId;
        return {
          ...group,
          layout: closed.layout,
          activePaneId: nextActive,
          targetPaneId: nextActive,
          primarySessionId: group.primarySessionId === sessionId ? "" : group.primarySessionId,
        };
      }
    }
    const cleared = mapSessionsOnTree(group.layout, sessionId);
    const primarySessionId = group.primarySessionId === sessionId ? "" : group.primarySessionId;
    return collapseGroupAfterSessionRemoval({ ...group, layout: cleared, primarySessionId });
  });
  return reconcileWorkspace({ ...state, groups }, availableSessionIds.filter((candidate) => candidate !== sessionId));
}

function mapSessionsOnTree(node: SplitNode, sessionId: string): SplitNode {
  if (isPaneLeaf(node)) {
    return node.sessionId === sessionId ? { ...node, sessionId: null } : node;
  }
  return {
    ...node,
    first: mapSessionsOnTree(node.first, sessionId),
    second: mapSessionsOnTree(node.second, sessionId),
  };
}

export function sessionIdsInGroup(group: TabGroup): string[] {
  return collectSessionIds(group.layout);
}

export function findTabGroupForSession(state: WorkspaceState, sessionId: string): TabGroup | undefined {
  return state.groups.find((group) => collectSessionIds(group.layout).includes(sessionId));
}

export function snapshotWorkspace(state: WorkspaceState): WorkspaceSnapshot {
  const active = activeGroupLayout(state);
  return {
    rootPaneId: active.panes[0]?.id ?? DEFAULT_ROOT_PANE,
    panes: active.panes.map((pane) => ({ ...pane })),
    activePaneId: active.activePaneId,
    splitDirection: active.splitDirection,
  };
}

export function splitNodeToSnapshot(node: SplitNode): SplitNodeSnapshot {
  if (isPaneLeaf(node)) {
    return { kind: "pane", id: node.id, sessionId: node.sessionId };
  }
  return {
    kind: "split",
    id: node.id,
    direction: node.direction,
    ratio: node.ratio,
    first: splitNodeToSnapshot(node.first),
    second: splitNodeToSnapshot(node.second),
  };
}

export function splitNodeFromSnapshot(snapshot: SplitNodeSnapshot): SplitNode {
  if (snapshot.kind === "pane") {
    return createPaneLeaf(snapshot.id, snapshot.sessionId ?? null);
  }
  return {
    kind: "split",
    id: snapshot.id,
    direction: snapshot.direction === "row" ? "row" : "column",
    ratio: snapshot.ratio ?? 0.5,
    first: splitNodeFromSnapshot(snapshot.first!),
    second: splitNodeFromSnapshot(snapshot.second!),
  };
}

function tabGroupToSnapshot(group: TabGroup): TabGroupSnapshot {
  return {
    id: group.id,
    primarySessionId: group.primarySessionId,
    layout: splitNodeToSnapshot(group.layout),
    activePaneId: group.activePaneId,
    targetPaneId: group.targetPaneId,
    broadcastMode: group.broadcastMode,
    splitDirection: group.defaultSplitDirection,
    panes: panesFromLayout(group.layout),
  };
}

function tabGroupFromSnapshot(snapshot: TabGroupSnapshot): TabGroup {
  let layout: SplitNode;
  if (snapshot.layout) {
    layout = splitNodeFromSnapshot(snapshot.layout);
  } else if (snapshot.panes && snapshot.panes.length > 0) {
    layout = flatPanesToTree(
      snapshot.panes.map((pane) => ({ id: pane.id, sessionId: pane.sessionId })),
      snapshot.splitDirection === "row" ? "row" : "column",
    );
  } else {
    layout = createSinglePaneLayout(snapshot.activePaneId, null);
  }
  const activePaneId = findPane(layout, snapshot.activePaneId)
    ? snapshot.activePaneId
    : firstPaneId(layout);
  const targetPaneId =
    snapshot.targetPaneId && findPane(layout, snapshot.targetPaneId)
      ? snapshot.targetPaneId
      : activePaneId;
  return {
    id: snapshot.id,
    primarySessionId: snapshot.primarySessionId,
    layout,
    activePaneId,
    targetPaneId,
    broadcastMode: snapshot.broadcastMode ?? false,
    defaultSplitDirection: snapshot.splitDirection === "row" ? "row" : "column",
  };
}

export function workspaceLayoutFromSnapshot(
  snapshot: WorkspaceSnapshot,
  sessions: RestorableSession[] = [],
  groups?: TabGroupSnapshot[],
  activeGroupId?: string,
): WorkspaceLayout {
  const active = snapshot;
  return {
    schemaVersion: WORKSPACE_LAYOUT_SCHEMA_VERSION,
    rootPaneId: active.rootPaneId,
    panes: active.panes.map((pane) => ({ ...pane })),
    activePaneId: active.activePaneId,
    splitDirection: active.splitDirection,
    sessions: sessions.map((session) => ({ ...session })),
    ...(groups && groups.length > 0
      ? { groups: groups.map((group) => tabGroupToSnapshot(tabGroupFromSnapshot(group))) }
      : {}),
    ...(activeGroupId ? { activeGroupId } : {}),
  };
}

export function workspaceLayoutFromState(state: WorkspaceState, sessions: RestorableSession[] = []): WorkspaceLayout {
  return workspaceLayoutFromSnapshot(
    snapshotWorkspace(state),
    sessions,
    state.groups.map(tabGroupToSnapshot),
    state.activeGroupId,
  );
}

function groupsFromLegacyLayout(
  layout: Pick<WorkspaceLayout, "panes" | "activePaneId" | "splitDirection">,
  availableSessionIds: string[],
): TabGroup[] {
  const panes = layout.panes
    .filter((pane) => typeof pane.id === "string")
    .map((pane) => ({ id: pane.id, sessionId: pane.sessionId ?? null }));

  const sessionsInLayout = new Set(
    panes.map((pane) => pane.sessionId).filter((id): id is string => !!id),
  );

  const groups: TabGroup[] = [];

  if (panes.length > 1) {
    const groupId = newTabGroupId();
    const primary = panes.find((pane) => pane.sessionId)?.sessionId ?? "";
    const tree = flatPanesToTree(panes, layout.splitDirection === "row" ? "row" : "column");
    const activePaneId = panes.some((pane) => pane.id === layout.activePaneId)
      ? layout.activePaneId
      : firstPaneId(tree);
    groups.push({
      id: groupId,
      primarySessionId: primary,
      layout: tree,
      activePaneId,
      targetPaneId: activePaneId,
      broadcastMode: false,
      defaultSplitDirection: layout.splitDirection === "row" ? "row" : "column",
    });
  }

  for (const sessionId of availableSessionIds) {
    if (!sessionsInLayout.has(sessionId)) {
      groups.push(createSinglePaneGroup(sessionId));
    }
  }

  if (groups.length === 0) {
    return [createSinglePaneGroup(null)];
  }

  return groups;
}

function groupsFromPersistedLayout(layout: WorkspaceLayout, availableSessionIds: string[]): TabGroup[] {
  if (layout.groups && layout.groups.length > 0) {
    return layout.groups.map(tabGroupFromSnapshot);
  }
  return groupsFromLegacyLayout(layout, availableSessionIds);
}

export function buildRestorableSessions(
  sessions: readonly { id: string; shell: string }[],
  cwdById: (sessionId: string) => string | undefined,
  names: Record<string, string | undefined>,
  inputModes: Record<string, SessionInputMode | undefined> = {},
  chatKeys: Record<string, string | undefined> = {},
): RestorableSession[] {
  return sessions.map((session) => {
    const name = (names[session.id] ?? "").trim();
    const cwd = cwdById(session.id);
    const inputMode = inputModes[session.id];
    const chatKey = chatKeys[session.id];
    return {
      sessionId: session.id,
      shell: session.shell,
      ...(cwd && cwd.length > 0 ? { cwd } : {}),
      ...(name.length > 0 ? { name } : {}),
      ...(chatKey && chatKey.length > 0 ? { chatKey } : {}),
      ...(inputMode && inputMode !== "operator" ? { inputMode } : {}),
    };
  });
}

export function remapLayoutToSnapshot(
  layout: Pick<WorkspaceLayout, "rootPaneId" | "panes" | "activePaneId" | "splitDirection" | "groups" | "activeGroupId">,
  idMap: Record<string, string>,
): WorkspaceLayout {
  const remapPane = (pane: PaneNode): PaneNode => ({
    id: pane.id,
    sessionId: pane.sessionId && idMap[pane.sessionId] ? idMap[pane.sessionId] : null,
  });

  const remapTreeSnapshot = (node: SplitNodeSnapshot): SplitNodeSnapshot => {
    if (node.kind === "pane") {
      return {
        ...node,
        sessionId: node.sessionId && idMap[node.sessionId] ? idMap[node.sessionId] : null,
      };
    }
    return {
      ...node,
      first: remapTreeSnapshot(node.first!),
      second: remapTreeSnapshot(node.second!),
    };
  };

  const groups = layout.groups?.map((group) => ({
    ...group,
    primarySessionId: idMap[group.primarySessionId] ?? group.primarySessionId,
    panes: group.panes?.map(remapPane),
    layout: group.layout ? remapTreeSnapshot(group.layout) : undefined,
  }));

  return {
    schemaVersion: WORKSPACE_LAYOUT_SCHEMA_VERSION,
    rootPaneId: layout.rootPaneId,
    activePaneId: layout.activePaneId,
    splitDirection: layout.splitDirection,
    panes: layout.panes.map(remapPane),
    ...(groups ? { groups } : {}),
    ...(layout.activeGroupId ? { activeGroupId: layout.activeGroupId } : {}),
  };
}

export function restoreWorkspaceFromSnapshot(
  raw: string | null,
  availableSessionIds: string[],
  fallbackState: WorkspaceState,
): WorkspaceState {
  if (!raw) {
    return reconcileWorkspace(fallbackState, availableSessionIds);
  }
  try {
    const parsed = JSON.parse(raw) as WorkspaceLayout;
    if (!Array.isArray(parsed.panes) && !Array.isArray(parsed.groups)) {
      return reconcileWorkspace(fallbackState, availableSessionIds);
    }

    const groups = groupsFromPersistedLayout(parsed, availableSessionIds);
    const activeGroupId =
      parsed.activeGroupId && groups.some((group) => group.id === parsed.activeGroupId)
        ? parsed.activeGroupId
        : groups[0].id;

    return reconcileWorkspace({ groups, activeGroupId }, availableSessionIds);
  } catch {
    return reconcileWorkspace(fallbackState, availableSessionIds);
  }
}

/** @deprecated No longer caps panes — returns state unchanged. */
export function trimWorkspacePanes(state: WorkspaceState): WorkspaceState {
  return state;
}

export { MAX_PANES_PER_GROUP };
