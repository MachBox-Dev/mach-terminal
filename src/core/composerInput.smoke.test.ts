import { describe, expect, it } from "vitest";
import { composerOutputScrollIntentFromKeyboardEvent } from "./composerOutputScroll";
import {
  canAcceptPrediction,
  createComposerHistoryState,
  nextHistoryDraft,
  predictionForDraft,
} from "./composerHistory";
import { applyCompletionCandidate, nextCompletionIndex } from "./composerCompletion";
import type { ComposerCompletionResponse, HistoryEntry } from "./terminal";

const HISTORY: HistoryEntry[] = [
  { id: 1, session_id: "a", command: "npm run build", timestamp_ms: 1 },
  { id: 2, session_id: "a", command: "npm run test", timestamp_ms: 2 },
  { id: 3, session_id: "a", command: "git status", timestamp_ms: 3 },
];

const COMPLETION: ComposerCompletionResponse = {
  replacementStart: 0,
  replacementEnd: 3,
  query: "npm",
  candidates: [
    { value: "npm", kind: "command" },
    { value: "npm.cmd", kind: "command" },
  ],
};

describe("composer prediction/completion smoke contracts", () => {
  it("accepts prediction only when cursor is at the end", () => {
    const prediction = predictionForDraft("npm", HISTORY);
    expect(prediction).toBe("npm run build");
    expect(canAcceptPrediction("npm", prediction, 3, 3)).toBe(true);
    expect(canAcceptPrediction("npm", prediction, 2, 2)).toBe(false);
  });

  it("cycles completion candidates with deterministic wraparound", () => {
    const first = applyCompletionCandidate("npm", COMPLETION, 0);
    expect(first).toEqual({ draft: "npm", cursor: 3 });
    const second = applyCompletionCandidate("npm", COMPLETION, nextCompletionIndex(COMPLETION, 0));
    expect(second).toEqual({ draft: "npm.cmd", cursor: 7 });
  });

  it("preserves baseline draft when entering and leaving history mode", () => {
    const state = createComposerHistoryState();
    const up = nextHistoryDraft(state, HISTORY, "npm r", "prev");
    expect(up.draft).toBe("npm run build");
    const down = nextHistoryDraft(up.state, HISTORY, "npm r", "next");
    expect(down.draft).toBe("npm r");
  });
});

describe("composer output scroll (unified composer)", () => {
  it("reserves ctrl+alt+page keys for xterm scroll while the composer stays focused", () => {
    expect(
      composerOutputScrollIntentFromKeyboardEvent({
        key: "PageUp",
        ctrlKey: true,
        altKey: true,
        shiftKey: false,
        metaKey: false,
      }),
    ).toBe("up");
    expect(
      composerOutputScrollIntentFromKeyboardEvent({
        key: "PageDown",
        ctrlKey: true,
        altKey: true,
        shiftKey: false,
        metaKey: false,
      }),
    ).toBe("down");
  });
});
