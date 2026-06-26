import { useSyncExternalStore } from "react";
import { sessionBufferStore } from "../state/sessionBufferStore";

/**
 * Subscribe to scrollback for a single session. Re-renders only this consumer when
 * that session's buffer changes — not the App shell.
 */
export function useSessionBuffer(sessionId: string | null | undefined): string {
  return useSyncExternalStore(
    (onStoreChange) => {
      if (!sessionId) {
        return () => {};
      }
      return sessionBufferStore.subscribe(sessionId, onStoreChange);
    },
    () => (sessionId ? sessionBufferStore.get(sessionId) : ""),
    () => "",
  );
}
