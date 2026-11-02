import type { SessionInputMode } from "./inputMode";
import { inputModeUsesXtermStdin } from "./inputMode";

export function usesRawTerminalInput(mode: SessionInputMode, agentActive: boolean): boolean {
  return inputModeUsesXtermStdin(mode) || agentActive;
}

export function shouldForwardTerminalData(data: string, rawInput: boolean, focused: boolean): boolean {
  // Match complete query replies, not keyboard arrows or bracketed paste (also CSI).
  const queryReply = /^(?:\x1b\[\??\d+;\d+R|\x1b\[(?:[?>])?[\d;]*c|\x1b\[\d+n|\x1b\[[\d;]+t|\x1b\[\?[\d;]+\$y|\x1b\][\s\S]*(?:\x07|\x1b\\)|\x1bP[\s\S]*\x1b\\)$/.test(data);
  return queryReply || (rawInput && focused);
}
