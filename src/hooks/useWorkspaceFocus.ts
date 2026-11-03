import { usesRawTerminalInput } from "../core/terminalInputRouting";
import { useEffect, useRef } from "react";
import { defaultSessionInputMode, type SessionInputMode } from "../core/inputMode";
import { requestFocusActiveTerminal } from "../core/workspaceFocus";

export interface UseWorkspaceFocusOptions {
  activeGroupId: string;
  activePaneId: string;
  activeSessionId: string | null;
  sessionInputModes: Record<string, SessionInputMode>;
  focusGroupComposer: () => void;
  agentActive?: boolean;
}

/**
 * After tab or pane focus changes, move keyboard focus to the group composer
 * (Operator) or the focused pane's xterm (Commander or an active CLI agent).
 */
export function useWorkspaceFocus({
  activeGroupId,
  activePaneId,
  activeSessionId,
  sessionInputModes,
  focusGroupComposer,
  agentActive = false,
}: UseWorkspaceFocusOptions): void {
  const focusGroupComposerRef = useRef(focusGroupComposer);
  focusGroupComposerRef.current = focusGroupComposer;
  const mode = activeSessionId ? sessionInputModes[activeSessionId] ?? defaultSessionInputMode() : defaultSessionInputMode();

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled || !activeSessionId) {
        return;
      }
      if (!usesRawTerminalInput(mode, agentActive)) {
        focusGroupComposerRef.current();
      } else {
        requestFocusActiveTerminal();
      }
    });
    return () => { cancelled = true; };
  }, [activeGroupId, activePaneId, activeSessionId, mode, agentActive]);
}
