import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ShellCandidate } from "./terminal";

const detectShells = vi.fn<() => Promise<ShellCandidate[]>>();

vi.mock("./terminal", () => ({
  detectShells: () => detectShells(),
}));

vi.mock("./tauriRuntime", () => ({
  isTauri: () => true,
}));

describe("shellCandidatesCache", () => {
  beforeEach(async () => {
    vi.resetModules();
    detectShells.mockReset();
    const mod = await import("./shellCandidatesCache");
    mod.invalidateShellCandidatesCache();
  });

  it("dedupes concurrent loads into one detectShells call", async () => {
    detectShells.mockImplementation(
      () =>
        new Promise((resolve) => {
          setTimeout(() => resolve([{ id: "pwsh", label: "pwsh", shell: "pwsh.exe", args: [], kind: "native", available: true, is_default: true }]), 10);
        }),
    );
    const mod = await import("./shellCandidatesCache");
    const [a, b] = await Promise.all([mod.loadShellCandidates(), mod.loadShellCandidates()]);
    expect(a).toEqual(b);
    expect(detectShells).toHaveBeenCalledTimes(1);
  });

  it("returns cached list without re-detecting", async () => {
    detectShells.mockResolvedValue([]);
    const mod = await import("./shellCandidatesCache");
    await mod.loadShellCandidates();
    await mod.loadShellCandidates();
    expect(detectShells).toHaveBeenCalledTimes(1);
  });
});
