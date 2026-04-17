import type { PtyLifecycleEvent, SessionStatus } from "./terminal";

export type TerminalSessionStatus = Extract<SessionStatus, "stopped" | "closed" | "error">;

export interface SessionExitedInfo {
  status: TerminalSessionStatus;
  /** Lifecycle event `message` text; `null` when the backend did not attach one. */
  message: string | null;
  /** Event `timestamp_ms` carried through so the overlay can key effects deterministically. */
  timestampMs: number;
  /**
   * Process exit code. Only populated for the EOF-driven `stopped` transition where the
   * reader thread `wait()`s on the child; `null` for `closed` (user kill) and `error`
   * (reader failure) paths, and `null` when running against a backend that does not yet
   * emit the field.
   */
  exitCode: number | null;
}

export function isTerminalStatus(status: SessionStatus): status is TerminalSessionStatus {
  return status === "stopped" || status === "closed" || status === "error";
}

/**
 * Project a `pty-lifecycle` event into the overlay payload the UI keeps in `sessionExited`.
 * Returns `null` for non-terminal statuses so callers can use it as a simple gate.
 */
export function deriveExitedInfo(event: PtyLifecycleEvent): SessionExitedInfo | null {
  if (!isTerminalStatus(event.status)) {
    return null;
  }
  return {
    status: event.status,
    message: event.message ?? null,
    timestampMs: event.timestamp_ms,
    exitCode: event.exit_code ?? null,
  };
}

/**
 * Remove a single session id from the overlay map. Returns the original map when the
 * id isn't present so React can bail on a setState no-op.
 */
export function clearExitedInfo(
  map: Record<string, SessionExitedInfo>,
  sessionId: string,
): Record<string, SessionExitedInfo> {
  if (!(sessionId in map)) {
    return map;
  }
  const next: Record<string, SessionExitedInfo> = { ...map };
  delete next[sessionId];
  return next;
}

/**
 * Drop overlay entries whose session id is no longer in the alive list.
 * Used whenever the sessions array actually contracts (explicit close / restart).
 */
export function pruneExitedForSessions(
  map: Record<string, SessionExitedInfo>,
  aliveSessionIds: readonly string[],
): Record<string, SessionExitedInfo> {
  const alive = new Set(aliveSessionIds);
  let changed = false;
  const next: Record<string, SessionExitedInfo> = {};
  for (const [sid, info] of Object.entries(map)) {
    if (alive.has(sid)) {
      next[sid] = info;
    } else {
      changed = true;
    }
  }
  return changed ? next : map;
}
