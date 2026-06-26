import { useEffect, useRef, type Dispatch, type SetStateAction } from "react";
import {
  drainChunksUpToByteBudget,
  nextSequenceState,
  SEQUENCE_LARGE_JUMP,
} from "../core/ptyOutputCoalesce";
import {
  PTY_OUTPUT_MAX_FLUSH_LATENCY_MS,
  shouldForceOutputFlushOnWake,
  shouldSkipVisibilityOutputKick,
} from "../core/ptyOutputFlushSchedule";
import { onPtyOutput } from "../core/terminal";

const MAX_PTY_FLUSH_BYTES_PER_FRAME = 48_000;

function appendBoundedOutput(previous: string, nextChunk: string, maxBuffer: number): string {
  const combined = `${previous}${nextChunk}`;
  if (combined.length <= maxBuffer) {
    return combined;
  }
  return combined.slice(combined.length - maxBuffer);
}

export interface UsePtyOutputStreamOptions {
  maxSessionBuffer: number;
  setSessionBuffers: Dispatch<SetStateAction<Record<string, string>>>;
  setRuntimeError: Dispatch<SetStateAction<string | null>>;
}

/**
 * Subscribes to the raw-bytes PTY output channel, coalesces chunks per session,
 * and flushes to sessionBuffers on requestAnimationFrame with a per-frame byte budget.
 */
export function usePtyOutputStream({
  maxSessionBuffer,
  setSessionBuffers,
  setRuntimeError,
}: UsePtyOutputStreamOptions): {
  pendingOutputRef: React.MutableRefObject<Record<string, string[]>>;
  lastSequenceRef: React.MutableRefObject<Record<string, number>>;
} {
  const pendingOutputRef = useRef<Record<string, string[]>>({});
  const rafFlushRef = useRef<number | null>(null);
  const flushDeadlineRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSequenceRef = useRef<Record<string, number>>({});
  const setSessionBuffersRef = useRef(setSessionBuffers);
  const setRuntimeErrorRef = useRef(setRuntimeError);
  setSessionBuffersRef.current = setSessionBuffers;
  setRuntimeErrorRef.current = setRuntimeError;

  useEffect(() => {
    let outputUnlisten: (() => void) | undefined;
    let visibilityCleanup: (() => void) | undefined;

    const clearFlushDeadline = () => {
      if (flushDeadlineRef.current !== null) {
        window.clearTimeout(flushDeadlineRef.current);
        flushDeadlineRef.current = null;
      }
    };

    const cancelScheduledFlush = () => {
      if (rafFlushRef.current !== null) {
        window.cancelAnimationFrame(rafFlushRef.current);
        rafFlushRef.current = null;
      }
      clearFlushDeadline();
    };

    const flushPendingOutput = () => {
      const updates: Record<string, string> = {};
      let hadRemainder = false;

      for (const [sessionId, chunks] of Object.entries(pendingOutputRef.current)) {
        if (chunks.length === 0) {
          delete pendingOutputRef.current[sessionId];
          continue;
        }
        const { merged, rest } = drainChunksUpToByteBudget(chunks, MAX_PTY_FLUSH_BYTES_PER_FRAME);
        if (merged.length > 0) {
          updates[sessionId] = merged;
        }
        if (rest.length > 0) {
          pendingOutputRef.current[sessionId] = rest;
          hadRemainder = true;
        } else {
          delete pendingOutputRef.current[sessionId];
        }
      }

      if (Object.keys(updates).length > 0) {
        setSessionBuffersRef.current((current) => {
          const next = { ...current };
          for (const [sessionId, merged] of Object.entries(updates)) {
            next[sessionId] = appendBoundedOutput(next[sessionId] ?? "", merged, maxSessionBuffer);
          }
          return next;
        });
      }

      if (hadRemainder) {
        scheduleOutputFlush();
      } else {
        rafFlushRef.current = null;
        clearFlushDeadline();
      }
    };

    const scheduleOutputFlush = () => {
      if (rafFlushRef.current === null) {
        rafFlushRef.current = window.requestAnimationFrame(flushPendingOutput);
      }
      if (flushDeadlineRef.current === null) {
        flushDeadlineRef.current = window.setTimeout(() => {
          flushDeadlineRef.current = null;
          const hasPending = Object.values(pendingOutputRef.current).some((chunks) => chunks.length > 0);
          if (!hasPending) {
            return;
          }
          cancelScheduledFlush();
          flushPendingOutput();
        }, PTY_OUTPUT_MAX_FLUSH_LATENCY_MS);
      }
    };

    const kickOutputFlush = () => {
      if (shouldSkipVisibilityOutputKick(document.visibilityState)) {
        return;
      }
      const hasPending = Object.values(pendingOutputRef.current).some((chunks) => chunks.length > 0);
      if (!shouldForceOutputFlushOnWake(hasPending)) {
        return;
      }
      cancelScheduledFlush();
      flushPendingOutput();
    };

    const bind = async () => {
      outputUnlisten = await onPtyOutput((event) => {
        const previousSequence = lastSequenceRef.current[event.session_id];
        const seq = nextSequenceState(previousSequence, event.sequence);
        lastSequenceRef.current[event.session_id] = seq.next;
        if (seq.status === "duplicate") {
          return;
        }
        if (seq.status === "gap") {
          setRuntimeErrorRef.current(
            `Output sequence anomaly for ${event.session_id}: previous=${String(previousSequence)}, got ${event.sequence} (rewind, or jump >${SEQUENCE_LARGE_JUMP})`,
          );
        } else if (seq.status === "resync" && import.meta.env.DEV) {
          console.debug(
            "[pty-output] sequence resync",
            event.session_id,
            "incoming=",
            event.sequence,
            "newBaseline=",
            seq.next,
          );
        }

        if (!pendingOutputRef.current[event.session_id]) {
          pendingOutputRef.current[event.session_id] = [];
        }
        pendingOutputRef.current[event.session_id].push(event.data);
        scheduleOutputFlush();
      });

      document.addEventListener("visibilitychange", kickOutputFlush);
      window.addEventListener("focus", kickOutputFlush);
      visibilityCleanup = () => {
        document.removeEventListener("visibilitychange", kickOutputFlush);
        window.removeEventListener("focus", kickOutputFlush);
      };
    };

    void bind();

    return () => {
      visibilityCleanup?.();
      cancelScheduledFlush();
      outputUnlisten?.();
    };
  }, [maxSessionBuffer]);

  return { pendingOutputRef, lastSequenceRef };
}
