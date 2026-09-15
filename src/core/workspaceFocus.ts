import { isTauri } from "./tauriRuntime";

/** Dispatched when the active tab/pane should receive keyboard focus in Commander mode. */
export const FOCUS_ACTIVE_TERMINAL_EVENT = "mach-terminal:focus-active-terminal";

export function requestFocusActiveTerminal(): void {
  if (typeof window === "undefined") {
    return;
  }
  window.dispatchEvent(new CustomEvent(FOCUS_ACTIVE_TERMINAL_EVENT));
}

/** Bring Mach Terminal back to the foreground after a PTY spawn on Windows (WT focus steal). */
export function refocusMainWindow(): void {
  if (!isTauri()) {
    return;
  }
  queueMicrotask(() => {
    void import("@tauri-apps/api/window")
      .then(({ getCurrentWindow }) => getCurrentWindow().setFocus())
      .catch(() => {
        // Best-effort; spawn must succeed even if focus restore fails.
      });
  });
}
