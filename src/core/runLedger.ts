/** Max command-log entries retained per session (older entries dropped unless we add archive later). */
export const MAX_RUNS_PER_SESSION = 200;

/**
 * Drop duplicate `command_submitted` bursts (double delivery or duplicate listeners) when the previous
 * entry matches command text and scrollback cursor and arrives within this window.
 */
export const COMMAND_SUBMIT_DEDUP_MS = 350;

export interface RunRecord {
  id: string;
  sessionId: string;
  commandText: string;
  submittedAtMs: number;
  /** Absolute UTF-16 stream position, including output evicted from retained scrollback. */
  bufferStart: number;
  /** UTF-16 exclusive end offset; null until superseded by the next run or session cleanup. */
  bufferEnd: number | null;
  sequence: number;
  pinned: boolean;
}

export type RunLedgerState = Record<string, RunRecord[]>;

export interface AppendCommandSubmittedInput {
  sessionId: string;
  commandText: string;
  submittedAtMs: number;
  sequence: number;
  /** Total UTF-16 characters appended before recording this submission. */
  bufferLengthBefore: number;
}

/**
 * Records a shell line submission from `ai-context` `command_submitted`.
 * Closes the previous open run's `bufferEnd` at `bufferLengthBefore`.
 */
export function appendCommandSubmitted(ledger: RunLedgerState, input: AppendCommandSubmittedInput): RunLedgerState {
  const { sessionId, commandText, submittedAtMs, sequence, bufferLengthBefore } = input;

  const prevList = ledger[sessionId] ?? [];
  const id = `${sessionId}:${sequence}`;
  if (prevList.some((r) => r.id === id)) {
    return ledger;
  }

  const last = prevList[prevList.length - 1];
  if (
    last &&
    last.commandText === commandText &&
    last.bufferStart === bufferLengthBefore &&
    Math.abs(submittedAtMs - last.submittedAtMs) < COMMAND_SUBMIT_DEDUP_MS
  ) {
    return ledger;
  }

  const closedPrev =
    prevList.length === 0
      ? prevList
      : prevList.map((run, idx) =>
          idx === prevList.length - 1 && run.bufferEnd === null ? { ...run, bufferEnd: bufferLengthBefore } : run,
        );

  const nextRun: RunRecord = {
    id,
    sessionId,
    commandText,
    submittedAtMs,
    bufferStart: bufferLengthBefore,
    bufferEnd: null,
    sequence,
    pinned: false,
  };

  let combined = [...closedPrev, nextRun];
  if (combined.length > MAX_RUNS_PER_SESSION) {
    combined = combined.slice(-MAX_RUNS_PER_SESSION);
  }

  return { ...ledger, [sessionId]: combined };
}

/**
 * Advances the current open run's `bufferStart` when OSC 133 `outputStart` arrives
 * so echoed command lines are excluded from the captured output slice.
 */
export function markCommandOutputStart(
  ledger: RunLedgerState,
  sessionId: string,
  bufferLengthAtOutputStart: number,
): RunLedgerState {
  const list = ledger[sessionId];
  if (!list || list.length === 0) {
    return ledger;
  }
  const lastIdx = list.length - 1;
  const last = list[lastIdx];
  if (last.bufferEnd !== null || bufferLengthAtOutputStart <= last.bufferStart) {
    return ledger;
  }
  const nextList = list.map((run, idx) =>
    idx === lastIdx ? { ...run, bufferStart: bufferLengthAtOutputStart } : run,
  );
  return { ...ledger, [sessionId]: nextList };
}

/**
 * Closes the current open run's `bufferEnd` when OSC 133 `outputEnd` arrives so
 * copying or reading output for the most recent command stops before subsequent prompts.
 */
export function markCommandOutputEnd(
  ledger: RunLedgerState,
  sessionId: string,
  bufferLengthAtOutputEnd: number,
): RunLedgerState {
  const list = ledger[sessionId];
  if (!list || list.length === 0) {
    return ledger;
  }
  const lastIdx = list.length - 1;
  const last = list[lastIdx];
  if (last.bufferEnd !== null) {
    return ledger;
  }
  const closedEnd = Math.max(last.bufferStart, bufferLengthAtOutputEnd);
  const nextList = list.map((run, idx) =>
    idx === lastIdx ? { ...run, bufferEnd: closedEnd } : run,
  );
  return { ...ledger, [sessionId]: nextList };
}

/**
 * Strip ANSI/CSI/OSC/DCS/ESC control sequences from raw PTY text for clean
 * clipboard copies and AI context excerpts without altering xterm rendering.
 */
export function stripTerminalEscapeSequences(text: string): string {
  if (!text) {
    return "";
  }
  return text
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, "")
    .replace(/\x1b[PX^_][\s\S]*?\x1b\\/g, "")
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/\x1b(?:\][^\x07\x1b]*|[PX^_][\s\S]*|\[[0-?]*[ -/]*|[\x20-\x2f]*)$/g, "")
    .replace(/\x1b[\x20-\x2f]*[\x30-\x7e]/g, "")
    .replace(/\r\n/g, "\n");
}

export function toggleRunPin(ledger: RunLedgerState, sessionId: string, runId: string): RunLedgerState {
  const list = ledger[sessionId];
  if (!list) {
    return ledger;
  }
  const mapped = list.map((run) => (run.id === runId ? { ...run, pinned: !run.pinned } : run));
  return { ...ledger, [sessionId]: mapped };
}

/** Drop ledger entries when a PTY session is removed. */
export function removeSessionRuns(ledger: RunLedgerState, sessionId: string): RunLedgerState {
  if (!(sessionId in ledger)) {
    return ledger;
  }
  const next = { ...ledger };
  delete next[sessionId];
  return next;
}

/** Apply persisted pin flags for runs that still exist (omits runs not in ledger). */
export function applyPinsFromStorage(
  ledger: RunLedgerState,
  pins: Record<string, Record<string, boolean>>,
): RunLedgerState {
  const out: RunLedgerState = { ...ledger };
  for (const [sessionId, runs] of Object.entries(ledger)) {
    const pinMap = pins[sessionId];
    if (!pinMap) {
      continue;
    }
    out[sessionId] = runs.map((r) => (pinMap[r.id] ? { ...r, pinned: true } : r));
  }
  return out;
}

/** Persist only pinned run ids per session (values are always true when present). */
export function serializePinnedMap(ledger: RunLedgerState): Record<string, Record<string, boolean>> {
  const out: Record<string, Record<string, boolean>> = {};
  for (const [sid, runs] of Object.entries(ledger)) {
    for (const r of runs) {
      if (r.pinned) {
        if (!out[sid]) {
          out[sid] = {};
        }
        out[sid][r.id] = true;
      }
    }
  }
  return out;
}

export function sliceBufferForRun(buffer: string, run: RunRecord, bufferStartOffset = 0): string {
  const start = Math.max(0, Math.min(run.bufferStart - bufferStartOffset, buffer.length));
  const endExclusive = run.bufferEnd === null
    ? buffer.length
    : Math.max(0, Math.min(run.bufferEnd - bufferStartOffset, buffer.length));
  if (start >= endExclusive) {
    return "";
  }
  return buffer.slice(start, endExclusive);
}
