import type { TerminalUiRequest } from "./terminalUiRequest";

export type TerminalUiIntentAction =
  | { type: "openFind" }
  | { type: "scrollToBottom" }
  | { type: "findNext" }
  | { type: "findPrevious" }
  | { type: "clearViewport" }
  | { type: "setFollowOutput"; followOutput: boolean; scrollToBottom: boolean };

export interface EvaluateTerminalUiIntentInput {
  request: TerminalUiRequest | null;
  isFocused: boolean;
  consumedSeq: number;
  findQuery: string;
  followOutput: boolean;
}

export interface EvaluateTerminalUiIntentResult {
  nextConsumedSeq: number;
  action?: TerminalUiIntentAction;
}

/**
 * Decides whether a terminal UI request should be consumed and which action it
 * maps to, independent from React/xterm side effects.
 */
export function evaluateTerminalUiIntent(input: EvaluateTerminalUiIntentInput): EvaluateTerminalUiIntentResult {
  const { request, isFocused, consumedSeq, findQuery, followOutput } = input;
  if (!request) {
    return { nextConsumedSeq: consumedSeq };
  }
  if (!isFocused) {
    return { nextConsumedSeq: Math.max(consumedSeq, request.seq) };
  }
  if (request.seq <= consumedSeq) {
    return { nextConsumedSeq: consumedSeq };
  }

  const nextConsumedSeq = request.seq;
  switch (request.kind) {
    case "openFind":
      return { nextConsumedSeq, action: { type: "openFind" } };
    case "scrollToBottom":
      return { nextConsumedSeq, action: { type: "scrollToBottom" } };
    case "findNext":
      return findQuery.trim().length > 0 ? { nextConsumedSeq, action: { type: "findNext" } } : { nextConsumedSeq };
    case "findPrevious":
      return findQuery.trim().length > 0
        ? { nextConsumedSeq, action: { type: "findPrevious" } }
        : { nextConsumedSeq };
    case "clearViewport":
      return { nextConsumedSeq, action: { type: "clearViewport" } };
    case "toggleFollowOutput": {
      const nextFollowOutput = !followOutput;
      return {
        nextConsumedSeq,
        action: {
          type: "setFollowOutput",
          followOutput: nextFollowOutput,
          scrollToBottom: nextFollowOutput,
        },
      };
    }
  }
}
