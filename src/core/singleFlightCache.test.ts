import { describe, expect, it, vi } from "vitest";
import { createSingleFlightCache } from "./singleFlightCache";

describe("shared status probes", () => {
  it("deduplicates active and fresh requests, then refreshes after expiry", async () => {
    let now = 0;
    const cache = createSingleFlightCache<number>(12_000, 2, () => now);
    let finish!: (value: number) => void;
    const load = vi.fn(() => new Promise<number>(resolve => { finish = resolve; }));
    const first = cache("cwd", load);
    expect(cache("cwd", load)).toBe(first);
    await Promise.resolve();
    now = 20_000;
    expect(cache("cwd", load)).toBe(first); // slow probe must not overlap
    finish(1);
    await first;
    const refreshed = cache("cwd", load);
    expect(refreshed).not.toBe(first);
    await Promise.resolve();
    finish(2);
    await refreshed;
    expect(cache("cwd", load)).toBe(refreshed);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("bounds simultaneous probes, evicts completed entries and retries failures", async () => {
    const cache = createSingleFlightCache<number>(1000, 1);
    let finish!: (value: number) => void;
    const first = cache("a", () => new Promise<number>(resolve => { finish = resolve; }));
    await expect(cache("b", async () => 2)).rejects.toThrow("busy");
    finish(1);
    await first;
    await expect(cache("b", async () => { throw new Error("offline"); })).rejects.toThrow("offline");
    await expect(cache("b", async () => 2)).resolves.toBe(2);
    await expect(cache("a", async () => 3)).resolves.toBe(3);
  });
});
