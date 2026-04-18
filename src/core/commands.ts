import type { PaletteCommand } from "../components/CommandPalette";

export type AppCommandId =
  | "session.new"
  | "session.restart"
  | "session.close"
  | "sessions.closeAllExited"
  | "sessions.restartAllExited"
  | "pane.split"
  | "pane.close"
  | "palette.toggle"
  | "history.refresh"
  | "ai.explainSelection"
  | "terminal.openFind"
  | "terminal.scrollBottom"
  | "terminal.findNext"
  | "terminal.findPrevious"
  | "terminal.clearViewport"
  | "terminal.toggleFollowOutput"
  | "ops.toggleRail"
  | "ops.selectNextRun"
  | "ops.selectPrevRun"
  | "ops.jumpSelectedRun"
  | "dev.diagnostics";

export interface AppCommand extends PaletteCommand {
  id: AppCommandId;
}

export const APP_COMMANDS: AppCommand[] = [
  {
    id: "session.new",
    label: "Create new session",
    shortcut: "Ctrl/Cmd+T",
    description: "Spawn a fresh shell session in the active pane.",
  },
  {
    id: "session.restart",
    label: "Restart active session",
    description: "Close the active pane's session and spawn a fresh one in the same pane.",
  },
  {
    id: "session.close",
    label: "Close active session",
    description: "Close the active pane's session without spawning a replacement.",
  },
  {
    id: "sessions.closeAllExited",
    label: "Close all exited sessions",
    description: "Close every session currently in the exited overlay map in tab order.",
  },
  {
    id: "sessions.restartAllExited",
    label: "Restart all exited sessions",
    description: "Close + respawn every exited session in place, walking tabs left to right.",
  },
  {
    id: "pane.split",
    label: "Split active pane",
    shortcut: "Ctrl/Cmd+\\",
    description: "Duplicate the current working context into a new pane.",
  },
  {
    id: "pane.close",
    label: "Close active pane",
    shortcut: "Ctrl/Cmd+W",
    description: "Close the currently focused pane.",
  },
  {
    id: "palette.toggle",
    label: "Toggle command palette",
    shortcut: "Ctrl/Cmd+K",
    description: "Search and execute shell UI commands.",
  },
  {
    id: "history.refresh",
    label: "Refresh command history",
    shortcut: "Ctrl/Cmd+H",
    description: "Reload history and runtime metrics for the active session.",
  },
  {
    id: "ai.explainSelection",
    label: "AI explain last command",
    shortcut: "Ctrl/Cmd+Shift+E",
    description: "Run AI explain against the latest history entry.",
  },
  {
    id: "terminal.openFind",
    label: "Find in terminal",
    description: "Open buffer search on the focused terminal pane (same as Ctrl/Cmd+Shift+F when the terminal has focus).",
  },
  {
    id: "terminal.scrollBottom",
    label: "Scroll terminal to bottom",
    description: "Jump the focused terminal viewport to the newest output and resume auto-follow.",
  },
  {
    id: "terminal.findNext",
    label: "Find next match",
    description: "Move to the next match in the active terminal find query.",
  },
  {
    id: "terminal.findPrevious",
    label: "Find previous match",
    description: "Move to the previous match in the active terminal find query.",
  },
  {
    id: "terminal.clearViewport",
    label: "Clear terminal viewport",
    description: "Clear the active terminal viewport and scrollback in xterm.",
  },
  {
    id: "terminal.toggleFollowOutput",
    label: "Toggle follow output",
    description: "Toggle whether new terminal output auto-scrolls while pinned to bottom.",
  },
  {
    id: "ops.toggleRail",
    label: "Toggle command log rail",
    shortcut: "Alt+O",
    description: "Show or hide the Ops rail command log for the active session.",
  },
  {
    id: "ops.selectNextRun",
    label: "Command log: select next entry",
    shortcut: "Alt+Down",
    description: "Move selection down in the command log (active session).",
  },
  {
    id: "ops.selectPrevRun",
    label: "Command log: select previous entry",
    shortcut: "Alt+Up",
    description: "Move selection up in the command log (active session).",
  },
  {
    id: "ops.jumpSelectedRun",
    label: "Command log: jump to selection",
    shortcut: "Alt+Enter",
    description: "Search the terminal buffer for the selected command (best-effort jump).",
  },
];

/** Shown in the command palette only when `import.meta.env.DEV` is true (Vite dev server). */
export const DEV_PALETTE_COMMANDS: AppCommand[] = [
  {
    id: "dev.diagnostics",
    label: "Open diagnostics snapshot",
    description: "Copyable JSON: runtime debug snapshot and settings schema dump (debug Tauri builds only).",
  },
];
