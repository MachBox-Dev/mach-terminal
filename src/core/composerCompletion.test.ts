import { describe, expect, it } from "vitest";
import {
  applyCompletionCandidate,
  completionRequestKey,
  createComposerCompletionState,
  hasCompletionCandidates,
  nextCompletionIndex,
  normalizeCompletionIndex,
} from "./composerCompletion";
import type { ComposerCompletionResponse } from "./terminal";

const RESPONSE: ComposerCompletionResponse = {
  replacementStart: 0,
  replacementEnd: 3,
  query: "npm",
  candidates: [
    { value: "npm", kind: "command" },
    { value: "npm.cmd", kind: "command" },
  ],
};

describe("composer completion helpers", () => {
  it("creates default completion state", () => {
    expect(createComposerCompletionState()).toEqual({
      response: null,
      selectedIndex: -1,
      requestKey: null,
      error: null,
    });
  });

  it("builds stable request key from draft and cursor", () => {
    expect(completionRequestKey("npm", 3)).toBe("3:npm");
  });

  it("cycles completion indexes and normalizes bounds", () => {
    expect(nextCompletionIndex(RESPONSE, -1)).toBe(0);
    expect(nextCompletionIndex(RESPONSE, 0)).toBe(1);
    expect(nextCompletionIndex(RESPONSE, 1)).toBe(0);
    expect(normalizeCompletionIndex(RESPONSE, -1)).toBe(0);
    expect(normalizeCompletionIndex(RESPONSE, 5)).toBe(1);
  });

  it("wraps backward and handles unselected and single-candidate lists", () => {
    expect(nextCompletionIndex(RESPONSE, 0, true)).toBe(1);
    expect(nextCompletionIndex(RESPONSE, 1, true)).toBe(0);
    expect(nextCompletionIndex(RESPONSE, -1, true)).toBe(0);
    const one = { ...RESPONSE, candidates: RESPONSE.candidates.slice(0, 1) };
    expect(nextCompletionIndex(one, 0, true)).toBe(0);
    expect(nextCompletionIndex(one, 0)).toBe(0);
  });

  it("applies selected completion candidate into replacement range", () => {
    const applied = applyCompletionCandidate("npm run test", RESPONSE, 1);
    expect(applied).toEqual({
      draft: "npm.cmd run test",
      cursor: 7,
    });
  });

  it("detects candidate availability", () => {
    expect(hasCompletionCandidates(RESPONSE)).toBe(true);
    expect(
      hasCompletionCandidates({
        replacementStart: 0,
        replacementEnd: 0,
        query: "",
        candidates: [],
      }),
    ).toBe(false);
  });
});
