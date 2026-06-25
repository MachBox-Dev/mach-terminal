/** Dispatched when the active tab/pane should receive keyboard focus in Commander mode. */
export const FOCUS_ACTIVE_TERMINAL_EVENT = "mach-terminal:focus-active-terminal";

export function requestFocusActiveTerminal(): void {
  if (typeof window === "undefined") {
    return;
  }
  window.dispatchEvent(new CustomEvent(FOCUS_ACTIVE_TERMINAL_EVENT));
}
