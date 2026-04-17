import type { AppCommandId } from "./commands";
import type { TerminalUiRequest } from "./terminalUiRequest";

export function commandToTerminalUiIntent(commandId: AppCommandId): TerminalUiRequest["kind"] | null {
  switch (commandId) {
    case "terminal.openFind":
      return "openFind";
    case "terminal.scrollBottom":
      return "scrollToBottom";
    case "terminal.findNext":
      return "findNext";
    case "terminal.findPrevious":
      return "findPrevious";
    case "terminal.clearViewport":
      return "clearViewport";
    case "terminal.toggleFollowOutput":
      return "toggleFollowOutput";
    default:
      return null;
  }
}
