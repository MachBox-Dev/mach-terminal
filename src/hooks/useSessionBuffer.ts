import { useSyncExternalStore } from "react";
import { EMPTY_SESSION_BUFFER, sessionBufferStore, type SessionBufferSnapshot } from "../state/sessionBufferStore";

/**
 * Subscribe to scrollback for a single session. Re-renders only this consumer when
 * that session's buffer changes — not the App shell.
 */
export function useSessionBuffer(sessionId: string | null | undefined): SessionBufferSnapshot {
  return useSyncExternalStore(
    (onStoreChange) => {
      if (!sessionId) {
        return () => {};
      }
      return sessionBufferStore.subscribe(sessionId, onStoreChange);
    },
    () => (sessionId ? sessionBufferStore.getSnapshot(sessionId) : EMPTY_SESSION_BUFFER),
    () => EMPTY_SESSION_BUFFER,
  );
}
