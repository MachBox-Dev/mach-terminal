/** Bounded, shared polling cache: simultaneous panes share one in-flight request. */
export function createSingleFlightCache<T>(ttlMs: number, maxEntries: number, now = Date.now) {
  const entries = new Map<string, { expires: number; pending: boolean; value: Promise<T> }>();
  return (key: string, load: () => Promise<T>): Promise<T> => {
    const existing = entries.get(key);
    if (existing && (existing.pending || existing.expires > now())) return existing.value;
    entries.delete(key);
    if (entries.size >= maxEntries) {
      const evict = [...entries].find(([, entry]) => !entry.pending);
      if (evict) entries.delete(evict[0]);
      else return Promise.reject(new Error("Status probes are busy"));
    }
    const entry: { expires: number; pending: boolean; value: Promise<T> } = { expires: now() + ttlMs, pending: true, value: Promise.resolve().then(load) };
    entry.value = entry.value.then(value => {
      entry.pending = false;
      return value;
    }, error => {
      entries.delete(key);
      throw error;
    });
    entries.set(key, entry);
    return entry.value;
  };
}
