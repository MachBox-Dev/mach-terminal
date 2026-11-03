import { useEffect, useRef } from "react";
import { EMPTY_SESSION_BUFFER, sessionBufferStore, type SessionBufferSnapshot } from "../state/sessionBufferStore";

export function useSessionBufferSubscription(
  sessionId: string | undefined,
  consume: (sessionId: string | undefined, snapshot: SessionBufferSnapshot) => void,
): void {
  const consumeRef = useRef(consume);
  consumeRef.current = consume;
  useEffect(() => {
    const publish = () => consumeRef.current(sessionId, sessionId ? sessionBufferStore.getSnapshot(sessionId) : EMPTY_SESSION_BUFFER);
    const unsubscribe = sessionId ? sessionBufferStore.subscribe(sessionId, publish) : undefined;
    publish();
    return unsubscribe;
  }, [sessionId]);
}
