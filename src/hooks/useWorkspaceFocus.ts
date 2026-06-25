import { useEffect, useRef } from "react";
import { defaultSessionInputMode, inputModeUsesComposer, type SessionInputMode } from "../core/inputMode";
import { requestFocusActiveTerminal } from "../core/workspaceFocus";

export interface UseWorkspaceFocusOptions {
  activeGroupId: string;
  activePaneId: string;
  activeSessionId: string | null;
  sessionInputModes: Record<string, SessionInputMode>;
  focusGroupComposer: () => void;
}

/**
 * After tab or pane focus changes, move keyboard focus to the group composer
 * (Operator) or the focused pane's xterm (Commander).
 */
export function useWorkspaceFocus({
  activeGroupId,
  activePaneId,
  activeSessionId,
  sessionInputModes,
  focusGroupComposer,
}: UseWorkspaceFocusOptions): void {
  const focusTokenRef = useRef("");
  const focusGroupComposerRef = useRef(focusGroupComposer);
  focusGroupComposerRef.current = focusGroupComposer;

  useEffect(() => {
    const token = `${activeGroupId}:${activePaneId}:${activeSessionId ?? ""}`;
    if (focusTokenRef.current === token) {
      return;
    }
    focusTokenRef.current = token;

    queueMicrotask(() => {
      if (!activeSessionId) {
        return;
      }
      const mode = sessionInputModes[activeSessionId] ?? defaultSessionInputMode();
      if (inputModeUsesComposer(mode)) {
        focusGroupComposerRef.current();
      } else {
        requestFocusActiveTerminal();
      }
    });
  }, [activeGroupId, activePaneId, activeSessionId, sessionInputModes]);
}
