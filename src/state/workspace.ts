export type SplitDirection = "row" | "column";

export interface PaneNode {
  id: string;
  sessionId: string | null;
}

export interface WorkspaceState {
  rootPaneId: string;
  panes: PaneNode[];
  activePaneId: string;
  splitDirection: SplitDirection;
}

export interface WorkspaceSnapshot {
  rootPaneId: string;
  panes: PaneNode[];
  activePaneId: string;
  splitDirection: SplitDirection;
}

/** Disk / Tauri payload (camelCase, matches Rust `WorkspaceLayout`). */
export interface WorkspaceLayout {
  schemaVersion: number;
  rootPaneId: string;
  panes: PaneNode[];
  activePaneId: string;
  splitDirection: SplitDirection;
}

export const WORKSPACE_LAYOUT_SCHEMA_VERSION = 1;

export function workspaceLayoutFromSnapshot(snapshot: WorkspaceSnapshot): WorkspaceLayout {
  return {
    schemaVersion: WORKSPACE_LAYOUT_SCHEMA_VERSION,
    rootPaneId: snapshot.rootPaneId,
    panes: snapshot.panes.map((pane) => ({ ...pane })),
    activePaneId: snapshot.activePaneId,
    splitDirection: snapshot.splitDirection,
  };
}

const DEFAULT_ROOT_PANE = "pane-1";

export function createWorkspaceState(): WorkspaceState {
  return {
    rootPaneId: DEFAULT_ROOT_PANE,
    panes: [{ id: DEFAULT_ROOT_PANE, sessionId: null }],
    activePaneId: DEFAULT_ROOT_PANE,
    splitDirection: "column",
  };
}

export function setPaneSession(state: WorkspaceState, paneId: string, sessionId: string | null): WorkspaceState {
  return {
    ...state,
    panes: state.panes.map((pane) => (pane.id === paneId ? { ...pane, sessionId } : pane)),
  };
}

export function setActivePane(state: WorkspaceState, paneId: string): WorkspaceState {
  return { ...state, activePaneId: paneId };
}

export function setSplitDirection(state: WorkspaceState, splitDirection: SplitDirection): WorkspaceState {
  return { ...state, splitDirection };
}

export function splitActivePane(
  state: WorkspaceState,
  sessionId: string | null,
  splitDirection?: SplitDirection,
): WorkspaceState {
  const nextId = `pane-${state.panes.length + 1}`;
  return {
    ...state,
    panes: [...state.panes, { id: nextId, sessionId }],
    splitDirection: splitDirection ?? state.splitDirection,
    activePaneId: nextId,
  };
}

export function closePane(state: WorkspaceState, paneId: string): WorkspaceState {
  if (state.panes.length <= 1) {
    return state;
  }
  const paneIndex = state.panes.findIndex((pane) => pane.id === paneId);
  if (paneIndex < 0) {
    return state;
  }
  const nextPanes = state.panes.filter((pane) => pane.id !== paneId);
  const fallbackActiveIndex = Math.max(0, Math.min(paneIndex, nextPanes.length - 1));
  const nextActive = state.activePaneId === paneId ? nextPanes[fallbackActiveIndex].id : state.activePaneId;
  return { ...state, panes: nextPanes, activePaneId: nextActive };
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

export function reconcileWorkspace(state: WorkspaceState, availableSessionIds: string[]): WorkspaceState {
  const available = new Set(availableSessionIds);
  let nextState: WorkspaceState = {
    ...state,
    panes: state.panes.map((pane) => ({
      ...pane,
      sessionId: pane.sessionId && available.has(pane.sessionId) ? pane.sessionId : null,
    })),
  };

  if (nextState.panes.length === 0) {
    return createWorkspaceState();
  }

  const hasActivePane = nextState.panes.some((pane) => pane.id === nextState.activePaneId);
  if (!hasActivePane) {
    nextState = { ...nextState, activePaneId: nextState.panes[0].id };
  }

  const activePane = nextState.panes.find((pane) => pane.id === nextState.activePaneId) ?? nextState.panes[0];
  if (!activePane.sessionId) {
    const fallback = pickSessionFallback(
      availableSessionIds,
      nextState.panes.filter((pane) => pane.id !== activePane.id).map((pane) => pane.sessionId),
    );
    if (fallback) {
      nextState = setPaneSession(nextState, activePane.id, fallback);
    }
  }

  return nextState;
}

export function removeSessionFromWorkspace(state: WorkspaceState, sessionId: string, availableSessionIds: string[]): WorkspaceState {
  const stripped = {
    ...state,
    panes: state.panes.map((pane) => (pane.sessionId === sessionId ? { ...pane, sessionId: null } : pane)),
  };
  return reconcileWorkspace(stripped, availableSessionIds.filter((candidate) => candidate !== sessionId));
}

export function snapshotWorkspace(state: WorkspaceState): WorkspaceSnapshot {
  return {
    rootPaneId: state.rootPaneId,
    panes: state.panes.map((pane) => ({ ...pane })),
    activePaneId: state.activePaneId,
    splitDirection: state.splitDirection,
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
    const parsed = JSON.parse(raw) as WorkspaceSnapshot;
    if (!Array.isArray(parsed.panes) || typeof parsed.activePaneId !== "string") {
      return reconcileWorkspace(fallbackState, availableSessionIds);
    }
    const restored: WorkspaceState = {
      rootPaneId: typeof parsed.rootPaneId === "string" ? parsed.rootPaneId : fallbackState.rootPaneId,
      activePaneId: parsed.activePaneId,
      splitDirection: parsed.splitDirection === "row" ? "row" : "column",
      panes: parsed.panes
        .filter((pane) => typeof pane.id === "string")
        .map((pane) => ({
          id: pane.id,
          sessionId: pane.sessionId ?? null,
        })),
    };
    return reconcileWorkspace(restored.panes.length > 0 ? restored : fallbackState, availableSessionIds);
  } catch {
    return reconcileWorkspace(fallbackState, availableSessionIds);
  }
}
