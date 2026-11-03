import type { ComposerCompletionResponse } from "./terminal";

export interface ComposerCompletionState {
  response: ComposerCompletionResponse | null;
  selectedIndex: number;
  requestKey: string | null;
  error: string | null;
}

export function createComposerCompletionState(): ComposerCompletionState {
  return {
    response: null,
    selectedIndex: -1,
    requestKey: null,
    error: null,
  };
}

export function completionRequestKey(draft: string, cursor: number): string {
  return `${cursor}:${draft}`;
}

export function completionStateAfterApply(
  response: ComposerCompletionResponse,
  selectedIndex: number,
  applied: { draft: string; cursor: number },
): ComposerCompletionState {
  return {
    response: { ...response, replacementEnd: applied.cursor },
    selectedIndex,
    requestKey: completionRequestKey(applied.draft, applied.cursor),
    error: null,
  };
}

export function applyCompletionCandidate(
  draft: string,
  response: ComposerCompletionResponse,
  selectedIndex: number,
): { draft: string; cursor: number } {
  const candidate = response.candidates[selectedIndex];
  if (!candidate) {
    return { draft, cursor: response.replacementEnd };
  }
  const next =
    draft.slice(0, response.replacementStart) + candidate.value + draft.slice(response.replacementEnd);
  const cursor = response.replacementStart + candidate.value.length;
  return { draft: next, cursor };
}

export function normalizeCompletionIndex(response: ComposerCompletionResponse | null, index: number): number {
  if (!response || response.candidates.length === 0) {
    return -1;
  }
  if (index < 0) {
    return 0;
  }
  return index % response.candidates.length;
}

export function nextCompletionIndex(response: ComposerCompletionResponse | null, current: number): number {
  if (!response || response.candidates.length === 0) {
    return -1;
  }
  if (current < 0) {
    return 0;
  }
  return (current + 1) % response.candidates.length;
}

export function hasCompletionCandidates(response: ComposerCompletionResponse | null): boolean {
  return Boolean(response && response.candidates.length > 0);
}
