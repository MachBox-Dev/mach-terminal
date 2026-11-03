import type { PtyCommandMarkerEvent } from "./terminal";
import { sliceBufferForRun, type RunRecord } from "./runLedger";

export interface SessionCommandFailure {
  commandText: string;
  exitCode: number;
  failedAtMs: number;
}

/**
 * Fold an OSC 133 `outputEnd` marker into the per-session failure map.
 * Only non-zero exit codes are retained; success clears the failure entry.
 */
export function applyCommandMarkerOutcome(
  map: Record<string, SessionCommandFailure | undefined>,
  event: PtyCommandMarkerEvent,
  commandText: string | undefined,
): Record<string, SessionCommandFailure | undefined> {
  if (event.phase !== "outputEnd") {
    return map;
  }
  const code = event.exit_code;
  if (code == null) {
    return map;
  }
  if (code === 0) {
    if (!(event.session_id in map)) {
      return map;
    }
    const next = { ...map };
    delete next[event.session_id];
    return next;
  }
  const cmd = (commandText ?? "").trim();
  if (cmd.length === 0) {
    return map;
  }
  return {
    ...map,
    [event.session_id]: {
      commandText: cmd,
      exitCode: code,
      failedAtMs: Date.now(),
    },
  };
}

export function failureOutputExcerpt(scrollBuffer: string, run: RunRecord | undefined, maxChars = 2400, bufferStartOffset = 0): string {
  if (!run) {
    return scrollBuffer.slice(-maxChars);
  }
  const slice = sliceBufferForRun(scrollBuffer, run, bufferStartOffset);
  if (slice.length <= maxChars) {
    return slice;
  }
  return slice.slice(slice.length - maxChars);
}

export function buildFailureAiQuestion(failure: SessionCommandFailure, outputExcerpt: string): string {
  const trimmed = outputExcerpt.trim();
  const outputBlock = trimmed.length > 0 ? `\n\nRecent output:\n${trimmed}` : "";
  return `This command failed with exit code ${failure.exitCode}. What went wrong and how should I fix it?\n\nCommand:\n${failure.commandText}${outputBlock}`;
}

/** Ctrl+Enter on an empty composer while a failure is tracked. */
export function isAskFailureShortcut(
  event: Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey">,
  draftEmpty: boolean,
  hasFailure: boolean,
): boolean {
  if (!hasFailure || !draftEmpty) {
    return false;
  }
  if (event.shiftKey || event.altKey || event.metaKey) {
    return false;
  }
  return event.key === "Enter" && event.ctrlKey;
}
