import type { SessionExitedInfo } from "./sessionLifecycle";
import { buildTabTooltip, isExitedTab } from "./sessionTabStatus";
import type { PtySessionInfo, SessionStatus } from "./terminal";
import type { TabGroup } from "../state/workspace";
import { collectPaneLeaves } from "../state/splitTree";

/** Tab bar row: one entry per workspace group (not per PTY session). */
export interface TabBarGroup {
  groupId: string;
  primarySessionId: string;
  sessionIds: string[];
  label: string;
  tooltip: string;
  status: SessionStatus;
  isExited: boolean;
  isActive: boolean;
}

export function sessionIdsInTabGroup(group: TabGroup): string[] {
  const ids: string[] = [];
  for (const leaf of collectPaneLeaves(group.layout)) {
    if (leaf.sessionId && !ids.includes(leaf.sessionId)) {
      ids.push(leaf.sessionId);
    }
  }
  return ids;
}

function groupLabel(sessionIds: string[], labels: Record<string, string>): string {
  const parts = sessionIds.map((id) => labels[id] ?? "shell");
  if (parts.length <= 1) {
    return parts[0] ?? "shell";
  }
  if (parts.length === 2) {
    return parts.join(" · ");
  }
  return `${parts[0]} · +${parts.length - 1}`;
}

function pickGroupStatus(
  sessionIds: string[],
  sessionStatus: Record<string, SessionStatus>,
  sessionsById: Record<string, PtySessionInfo>,
): SessionStatus {
  for (const id of sessionIds) {
    const status = sessionStatus[id] ?? sessionsById[id]?.status ?? "starting";
    if (status !== "running") {
      return status;
    }
  }
  return sessionStatus[sessionIds[0] ?? ""] ?? sessionsById[sessionIds[0] ?? ""]?.status ?? "running";
}

function pickGroupExited(
  sessionIds: string[],
  sessionStatus: Record<string, SessionStatus>,
  sessionExited: Record<string, SessionExitedInfo>,
): { isExited: boolean; message: string | null; exitCode: number | null } {
  for (const id of sessionIds) {
    const status = sessionStatus[id] ?? "running";
    const exited = sessionExited[id];
    if (isExitedTab(status, exited)) {
      return {
        isExited: true,
        message: exited?.message ?? null,
        exitCode: exited?.exitCode ?? null,
      };
    }
  }
  return { isExited: false, message: null, exitCode: null };
}

export function buildTabBarGroups(
  groups: readonly TabGroup[],
  sessionsById: Record<string, PtySessionInfo>,
  tabLabels: Record<string, string>,
  sessionStatus: Record<string, SessionStatus>,
  sessionExited: Record<string, SessionExitedInfo>,
  activeGroupId: string,
): TabBarGroup[] {
  return groups.map((group) => {
    const sessionIds = sessionIdsInTabGroup(group);
    const primarySessionId =
      group.primarySessionId && sessionIds.includes(group.primarySessionId)
        ? group.primarySessionId
        : (sessionIds[0] ?? group.primarySessionId);
    const status = pickGroupStatus(sessionIds, sessionStatus, sessionsById);
    const exited = pickGroupExited(sessionIds, sessionStatus, sessionExited);
    const label = groupLabel(sessionIds, tabLabels);
    const tooltip =
      sessionIds.length > 1
        ? `Split tab (${sessionIds.length} shells) — ${label}`
        : buildTabTooltip(status, exited.message, exited.exitCode);
    return {
      groupId: group.id,
      primarySessionId,
      sessionIds,
      label,
      tooltip,
      status,
      isExited: exited.isExited,
      isActive: group.id === activeGroupId,
    };
  });
}
