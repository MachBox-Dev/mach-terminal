/**
 * Pure helpers for PTY output batching and per-session sequence bookkeeping on the UI thread.
 */

export type SequenceStatus = "ok" | "resync" | "gap";

/** Forward jumps larger than this (skipped sequence numbers) surface as a strong anomaly. */
export const SEQUENCE_LARGE_JUMP = 100;

export function nextSequenceState(
  previous: number | undefined,
  incoming: number,
): { status: SequenceStatus; next: number } {
  if (previous === undefined) {
    return { status: "ok", next: incoming };
  }
  if (incoming === previous + 1) {
    return { status: "ok", next: incoming };
  }
  if (incoming <= previous) {
    return { status: "gap", next: incoming };
  }
  if (incoming > previous + SEQUENCE_LARGE_JUMP) {
    return { status: "gap", next: incoming };
  }
  return { status: "resync", next: incoming };
}

/**
 * Join pending chunks. When `maxJoinBytes` is set, only whole chunks are included until the budget
 * would be exceeded (except a single oversized chunk is split once so progress is always made).
 */
export function mergePendingChunks(chunks: string[], maxJoinBytes?: number): string {
  if (chunks.length === 0) {
    return "";
  }
  if (maxJoinBytes === undefined) {
    return chunks.join("");
  }
  return drainChunksUpToByteBudget(chunks, maxJoinBytes).merged;
}

/**
 * Consumes leading chunks up to a byte budget. Remaining chunks (and any trailing slice of a split chunk)
 * are returned for a subsequent flush.
 */
export function drainChunksUpToByteBudget(chunks: string[], maxBytes: number): { merged: string; rest: string[] } {
  if (chunks.length === 0 || maxBytes <= 0) {
    return { merged: "", rest: chunks };
  }

  let used = 0;
  let idx = 0;
  const parts: string[] = [];

  while (idx < chunks.length && used < maxBytes) {
    const chunk = chunks[idx];
    const room = maxBytes - used;

    if (chunk.length <= room) {
      parts.push(chunk);
      used += chunk.length;
      idx += 1;
      continue;
    }

    if (used === 0) {
      parts.push(chunk.slice(0, room));
      const tail = chunk.slice(room);
      const rest = [...(tail ? [tail] : []), ...chunks.slice(idx + 1)];
      return { merged: parts.join(""), rest };
    }

    return { merged: parts.join(""), rest: chunks.slice(idx) };
  }

  return { merged: parts.join(""), rest: chunks.slice(idx) };
}
