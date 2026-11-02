/**
 * PTY scrollback lives outside React state so RAF output flushes do not re-render App.
 * Terminal panes subscribe per session via `useSessionBuffer`.
 */

export function appendBoundedSessionBuffer(previous: string, nextChunk: string, maxBuffer: number): string {
  const combined = `${previous}${nextChunk}`;
  if (combined.length <= maxBuffer) {
    return combined;
  }
  return combined.slice(combined.length - maxBuffer);
}

type SessionListener = () => void;

export interface SessionBufferSnapshot {
  readonly text: string;
  readonly totalAppended: number;
  readonly startOffset: number;
}

export const EMPTY_SESSION_BUFFER: SessionBufferSnapshot = { text: "", totalAppended: 0, startOffset: 0 };

/** Null means the consumer fell behind the retained window and must replay it. */
export function sessionBufferDelta(snapshot: SessionBufferSnapshot, consumed: number): string | null {
  if (consumed < snapshot.startOffset || consumed > snapshot.totalAppended) {
    return null;
  }
  return snapshot.text.slice(consumed - snapshot.startOffset);
}

export class SessionBufferStore {
  private buffers: Record<string, string> = {};
  private snapshots: Record<string, SessionBufferSnapshot> = {};
  private listeners = new Map<string, Set<SessionListener>>();

  get(sessionId: string): string {
    return this.buffers[sessionId] ?? "";
  }

  getSnapshot(sessionId: string): SessionBufferSnapshot {
    return this.snapshots[sessionId] ?? EMPTY_SESSION_BUFFER;
  }

  /** Snapshot for AI tools / ops-rail (read current scrollback without React). */
  getAll(): Readonly<Record<string, string>> {
    return { ...this.buffers };
  }

  append(sessionId: string, chunk: string, maxBuffer: number): void {
    if (chunk.length === 0) {
      return;
    }
    const previous = this.buffers[sessionId] ?? "";
    const next = appendBoundedSessionBuffer(previous, chunk, maxBuffer);
    const totalAppended = this.getSnapshot(sessionId).totalAppended + chunk.length;
    this.buffers[sessionId] = next;
    this.snapshots[sessionId] = { text: next, totalAppended, startOffset: totalAppended - next.length };
    this.notify(sessionId);
  }

  remove(sessionId: string): void {
    if (!(sessionId in this.buffers)) {
      return;
    }
    delete this.buffers[sessionId];
    delete this.snapshots[sessionId];
    this.notify(sessionId);
  }

  prune(aliveIds: readonly string[]): void {
    const alive = new Set(aliveIds);
    for (const sessionId of Object.keys(this.buffers)) {
      if (!alive.has(sessionId)) {
        this.remove(sessionId);
      }
    }
  }

  subscribe(sessionId: string, listener: SessionListener): () => void {
    let set = this.listeners.get(sessionId);
    if (!set) {
      set = new Set();
      this.listeners.set(sessionId, set);
    }
    set.add(listener);
    return () => {
      set?.delete(listener);
      if (set && set.size === 0) {
        this.listeners.delete(sessionId);
      }
    };
  }

  private notify(sessionId: string): void {
    const set = this.listeners.get(sessionId);
    if (!set) {
      return;
    }
    for (const listener of set) {
      listener();
    }
  }
}

/** Process-wide PTY scrollback store (one webview). */
export const sessionBufferStore = new SessionBufferStore();
