import type { PtyCwdChangedEvent } from "./terminal";

/**
 * Map of `session_id -> last-known absolute cwd` populated from `pty-cwd-changed`
 * events. The Rust reader thread already dedupes same-path emissions, but we
 * re-check here because the event bus has no delivery-order guarantee across
 * restarts and we want setState to be an idempotent no-op on duplicate payloads.
 */
export type SessionCwdMap = Record<string, string>;

/**
 * Fold a `pty-cwd-changed` payload into the cwd map. Returns the original map
 * (referentially equal) when the cwd matches the stored value so React can bail
 * on an unchanged state update, avoiding a render storm for busy shells.
 */
export function applyCwdChange(
  map: SessionCwdMap,
  event: PtyCwdChangedEvent,
): SessionCwdMap {
  if (!event.cwd) {
    return map;
  }
  if (map[event.session_id] === event.cwd) {
    return map;
  }
  return { ...map, [event.session_id]: event.cwd };
}

/**
 * Drop a single session from the map, used on explicit close / restart. Returns
 * the original map when the id isn't tracked so setState is a no-op.
 */
export function clearCwd(map: SessionCwdMap, sessionId: string): SessionCwdMap {
  if (!(sessionId in map)) {
    return map;
  }
  const next: SessionCwdMap = { ...map };
  delete next[sessionId];
  return next;
}

/**
 * Retain only cwd entries whose session is still alive. Mirrors
 * `pruneExitedForSessions` so the two maps stay in lockstep with the sessions
 * array after tab closes.
 */
export function pruneCwdForSessions(
  map: SessionCwdMap,
  aliveSessionIds: readonly string[],
): SessionCwdMap {
  const alive = new Set(aliveSessionIds);
  let changed = false;
  const next: SessionCwdMap = {};
  for (const [sid, cwd] of Object.entries(map)) {
    if (alive.has(sid)) {
      next[sid] = cwd;
    } else {
      changed = true;
    }
  }
  return changed ? next : map;
}

/**
 * Resolve the cwd that `restartSessionById` should pass into the replacement
 * `ptySpawn`. Prefers the tracked live cwd; falls back to whatever the profile
 * would have used (typically the user's configured default) so a shell without
 * the OSC 7 hook still behaves exactly like before this tranche.
 */
export function getRestartCwd(
  map: SessionCwdMap,
  sessionId: string,
  fallbackCwd: string | null | undefined,
): string | null {
  const tracked = map[sessionId];
  if (tracked && tracked.length > 0) {
    return tracked;
  }
  if (fallbackCwd && fallbackCwd.length > 0) {
    return fallbackCwd;
  }
  return null;
}
