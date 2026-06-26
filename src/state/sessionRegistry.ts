import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import type { AiChatState, AiContextAttachment } from "../core/aiChatState";
import type { ComposerSubmitKind } from "../core/composerAiIntent";
import type { SessionInputMode } from "../core/inputMode";
import { pruneAiChatForSessions } from "../core/aiChatState";
import { clearCwd, pruneCwdForSessions, type SessionCwdMap } from "../core/sessionCwd";
import type { SessionCommandFailure } from "../core/sessionCommandOutcome";
import { clearExitedInfo, pruneExitedForSessions, type SessionExitedInfo } from "../core/sessionLifecycle";
import { removeSessionRuns, type RunLedgerState } from "../core/runLedger";
import type { SessionStatus } from "../core/terminal";
import type { UiSurfaceState } from "../core/uiSurfaceState";
import { sessionBufferStore } from "./sessionBufferStore";

/** Drop keys not in `aliveIds`; return the same reference when nothing changed. */
export function pruneRecordByAliveIds<T>(current: Record<string, T>, aliveIds: readonly string[]): Record<string, T> {
  const alive = new Set(aliveIds);
  let changed = false;
  const next = { ...current };
  for (const id of Object.keys(next)) {
    if (!alive.has(id)) {
      delete next[id];
      changed = true;
    }
  }
  return changed ? next : current;
}

/** Remove one session key; return the same reference when absent. */
export function deleteSessionRecordKey<T>(current: Record<string, T>, sessionId: string): Record<string, T> {
  if (!(sessionId in current)) {
    return current;
  }
  const next = { ...current };
  delete next[sessionId];
  return next;
}

export interface SessionTransientRefs {
  pendingOutputRef: MutableRefObject<Record<string, string[]>>;
  lastSequenceRef: MutableRefObject<Record<string, number>>;
  resizeThrottleRef: MutableRefObject<Record<string, number>>;
  sessionCommandLineRef: MutableRefObject<Record<string, string>>;
}

export function clearSessionTransientRefs(sessionId: string, refs: SessionTransientRefs): void {
  delete refs.pendingOutputRef.current[sessionId];
  delete refs.lastSequenceRef.current[sessionId];
  delete refs.sessionCommandLineRef.current[sessionId];
  if (sessionId in refs.resizeThrottleRef.current) {
    const nextThrottle = { ...refs.resizeThrottleRef.current };
    delete nextThrottle[sessionId];
    refs.resizeThrottleRef.current = nextThrottle;
  }
}

export function pruneSessionTransientRefs(aliveIds: readonly string[], refs: SessionTransientRefs): void {
  const alive = new Set(aliveIds);
  for (const id of Object.keys(refs.pendingOutputRef.current)) {
    if (!alive.has(id)) {
      delete refs.pendingOutputRef.current[id];
    }
  }
  for (const id of Object.keys(refs.lastSequenceRef.current)) {
    if (!alive.has(id)) {
      delete refs.lastSequenceRef.current[id];
    }
  }
  for (const id of Object.keys(refs.sessionCommandLineRef.current)) {
    if (!alive.has(id)) {
      delete refs.sessionCommandLineRef.current[id];
    }
  }
  const throttle = refs.resizeThrottleRef.current;
  let throttleChanged = false;
  const nextThrottle = { ...throttle };
  for (const id of Object.keys(throttle)) {
    if (!alive.has(id)) {
      delete nextThrottle[id];
      throttleChanged = true;
    }
  }
  if (throttleChanged) {
    refs.resizeThrottleRef.current = nextThrottle;
  }
}

export interface SessionRegistrySetters {
  setRunLedger: Dispatch<SetStateAction<RunLedgerState>>;
  setSessionStatus: Dispatch<SetStateAction<Record<string, SessionStatus>>>;
  setSessionMessages: Dispatch<SetStateAction<Record<string, string | undefined>>>;
  setSessionExited: Dispatch<SetStateAction<Record<string, SessionExitedInfo>>>;
  setSessionCwd: Dispatch<SetStateAction<SessionCwdMap>>;
  setSessionNames: Dispatch<SetStateAction<Record<string, string>>>;
  setSessionInputModes: Dispatch<SetStateAction<Record<string, SessionInputMode>>>;
  setComposerSubmitKinds: Dispatch<SetStateAction<Record<string, ComposerSubmitKind>>>;
  setSessionCommandFailures: Dispatch<SetStateAction<Record<string, SessionCommandFailure | undefined>>>;
  setAiChatState: Dispatch<SetStateAction<AiChatState>>;
  setSessionChatKeys: Dispatch<SetStateAction<Record<string, string>>>;
  setAiPendingAttachments: Dispatch<SetStateAction<Record<string, AiContextAttachment[]>>>;
  setSessionSpawnArgs: Dispatch<SetStateAction<Record<string, string[]>>>;
  setSessionUiSurface: Dispatch<SetStateAction<Record<string, UiSurfaceState>>>;
  setSessionOsc133Hints: Dispatch<SetStateAction<Record<string, string>>>;
}

export interface SessionRegistryContext {
  setters: SessionRegistrySetters;
  transientRefs: SessionTransientRefs;
}

/** Prune every per-session map when the live `sessions` list changes. */
export function pruneAllSessionScopedState(aliveIds: readonly string[], ctx: SessionRegistryContext): void {
  const { setters } = ctx;
  setters.setSessionExited((current) => pruneExitedForSessions(current, aliveIds));
  setters.setSessionCwd((current) => pruneCwdForSessions(current, aliveIds));
  setters.setSessionOsc133Hints((current) => pruneRecordByAliveIds(current, aliveIds));
  setters.setSessionUiSurface((current) => pruneRecordByAliveIds(current, aliveIds));
  setters.setSessionInputModes((current) => pruneRecordByAliveIds(current, aliveIds));
  setters.setComposerSubmitKinds((current) => pruneRecordByAliveIds(current, aliveIds));
  setters.setSessionCommandFailures((current) => pruneRecordByAliveIds(current, aliveIds));
  setters.setAiChatState((current) => pruneAiChatForSessions(current, aliveIds));
  setters.setSessionChatKeys((current) => pruneRecordByAliveIds(current, aliveIds));
  setters.setAiPendingAttachments((current) => pruneRecordByAliveIds(current, aliveIds));
  setters.setSessionStatus((current) => pruneRecordByAliveIds(current, aliveIds));
  setters.setSessionMessages((current) => pruneRecordByAliveIds(current, aliveIds));
  setters.setSessionNames((current) => pruneRecordByAliveIds(current, aliveIds));
  setters.setSessionSpawnArgs((current) => pruneRecordByAliveIds(current, aliveIds));
  setters.setRunLedger((current) => {
    const alive = new Set(aliveIds);
    let changed = false;
    const next = { ...current };
    for (const id of Object.keys(next)) {
      if (!alive.has(id)) {
        delete next[id];
        changed = true;
      }
    }
    return changed ? next : current;
  });
  sessionBufferStore.prune(aliveIds);
  pruneSessionTransientRefs(aliveIds, ctx.transientRefs);
}

/** Tear down all per-session UI state for one id (sessions/workspace updated separately). */
export function removeSessionFromRegistry(sessionId: string, ctx: SessionRegistryContext): void {
  const { setters } = ctx;
  sessionBufferStore.remove(sessionId);
  setters.setRunLedger((current) => removeSessionRuns(current, sessionId));
  setters.setSessionStatus((current) => deleteSessionRecordKey(current, sessionId));
  setters.setSessionMessages((current) => deleteSessionRecordKey(current, sessionId));
  setters.setSessionExited((current) => clearExitedInfo(current, sessionId));
  setters.setSessionCwd((current) => clearCwd(current, sessionId));
  setters.setSessionNames((current) => deleteSessionRecordKey(current, sessionId));
  setters.setSessionInputModes((current) => deleteSessionRecordKey(current, sessionId));
  setters.setComposerSubmitKinds((current) => deleteSessionRecordKey(current, sessionId));
  setters.setSessionCommandFailures((current) => deleteSessionRecordKey(current, sessionId));
  setters.setAiChatState((current) => deleteSessionRecordKey(current, sessionId));
  setters.setSessionChatKeys((current) => deleteSessionRecordKey(current, sessionId));
  setters.setAiPendingAttachments((current) => deleteSessionRecordKey(current, sessionId));
  setters.setSessionSpawnArgs((current) => deleteSessionRecordKey(current, sessionId));
  setters.setSessionUiSurface((current) => deleteSessionRecordKey(current, sessionId));
  setters.setSessionOsc133Hints((current) => deleteSessionRecordKey(current, sessionId));
  clearSessionTransientRefs(sessionId, ctx.transientRefs);
}
