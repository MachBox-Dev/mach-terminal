import type { SessionInputMode } from "./inputMode";
import { inputModeUsesComposer } from "./inputMode";

/**
 * Whether the composer should receive focus when the terminal pane becomes active.
 * Find bar, commander mode, and session-exit overlay use other focus targets.
 */
export function canFocusComposerWhenPaneActive(
  findOpen: boolean,
  composerLocked: boolean,
  inputMode: SessionInputMode = "operator",
): boolean {
  return inputModeUsesComposer(inputMode) && !findOpen && !composerLocked;
}
