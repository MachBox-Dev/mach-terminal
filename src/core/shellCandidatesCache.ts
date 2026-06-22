import { detectShells, type ShellCandidate } from "./terminal";
import { isTauri } from "./tauriRuntime";

let cached: ShellCandidate[] | null = null;
let inflight: Promise<ShellCandidate[]> | null = null;

/** Best-effort shell list cache; shared across pickers so reopening is instant. */
export function prefetchShellCandidates(): void {
  if (!isTauri()) {
    return;
  }
  void loadShellCandidates();
}

export function invalidateShellCandidatesCache(): void {
  cached = null;
  inflight = null;
}

export async function loadShellCandidates(options?: { force?: boolean }): Promise<ShellCandidate[]> {
  if (!isTauri()) {
    return [];
  }
  if (!options?.force && cached) {
    return cached;
  }
  if (!options?.force && inflight) {
    return inflight;
  }
  inflight = detectShells()
    .then((candidates) => {
      cached = candidates;
      inflight = null;
      return candidates;
    })
    .catch((error) => {
      inflight = null;
      throw error;
    });
  return inflight;
}
