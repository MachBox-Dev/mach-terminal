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

export class SessionBufferStore {
  private buffers: Record<string, string> = {};
  private listeners = new Map<string, Set<SessionListener>>();

  get(sessionId: string): string {
    return this.buffers[sessionId] ?? "";
  }

  /** Snapshot for AI tools / ops-rail (read current scrollback without React). */
  getAll(): Readonly<Record<string, string>> {
    return this.buffers;
  }

  append(sessionId: string, chunk: string, maxBuffer: number): void {
    if (chunk.length === 0) {
      return;
    }
    const previous = this.buffers[sessionId] ?? "";
    const next = appendBoundedSessionBuffer(previous, chunk, maxBuffer);
    if (next === previous) {
      return;
    }
    this.buffers[sessionId] = next;
    this.notify(sessionId);
  }

  remove(sessionId: string): void {
    if (!(sessionId in this.buffers)) {
      return;
    }
    delete this.buffers[sessionId];
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
