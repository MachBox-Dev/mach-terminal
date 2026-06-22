import type { PaletteCommand } from "../components/CommandPalette";

export type AppCommandId =
  | "session.new"
  | "session.newWithProfile"
  | "session.restart"
  | "session.close"
  | "sessions.closeAllExited"
  | "sessions.restartAllExited"
  | "pane.split"
  | "pane.split.column"
  | "pane.split.row"
  | "pane.close"
  | "pane.broadcast"
  | "pane.focus1"
  | "pane.focus2"
  | "pane.focus3"
  | "pane.focus4"
  | "pane.focus5"
  | "pane.focus6"
  | "pane.focus7"
  | "pane.focus8"
  | "pane.focus9"
  | "pane.target1"
  | "pane.target2"
  | "pane.target3"
  | "pane.target4"
  | "pane.target5"
  | "pane.target6"
  | "pane.target7"
  | "pane.target8"
  | "pane.target9"
  | "palette.toggle"
  | "input.cycleMode"
  | "history.refresh"
  | "ai.explainSelection"
  | "ai.explainComposerDraft"
  | "ai.fixComposerDraft"
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

const PANE_FOCUS_SHORTCUT = "Ctrl+Alt+1…9 (Win) · Alt+1…9 (Mac)";
const PANE_TARGET_SHORTCUT = "Ctrl+Alt+Shift+1…9 (Win) · Alt+Shift+1…9 (Mac)";

const PANE_FOCUS_COMMANDS: AppCommand[] = Array.from({ length: 9 }, (_, index) => {
  const n = index + 1;
  return {
    id: `pane.focus${n}` as AppCommandId,
    label: `Focus pane ${n}`,
    shortcut: PANE_FOCUS_SHORTCUT,
    description:
      "Move keyboard focus to this pane (terminal typing in Commander; active session for AI/ops). Does not change composer target.",
  };
});

const PANE_TARGET_COMMANDS: AppCommand[] = Array.from({ length: 9 }, (_, index) => {
  const n = index + 1;
  return {
    id: `pane.target${n}` as AppCommandId,
    label: `Target pane ${n}`,
    shortcut: PANE_TARGET_SHORTCUT,
    description:
      "Route the group composer here (Enter, exit, completion). Does not move keyboard focus.",
  };
});

export const APP_COMMANDS: AppCommand[] = [
  {
    id: "session.new",
    label: "Create new session",
    shortcut: "Ctrl/Cmd+T",
    description: "Spawn a fresh shell in the active pane using your default profile.",
  },
  {
    id: "session.newWithProfile",
    label: "New tab with shell picker",
    description: "Choose shell and arguments before spawning (WSL distros, custom args).",
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
    label: "Split pane vertically (side by side)",
    shortcut: "Ctrl/Cmd+\\",
    description: "Add a column split in the active tab (panes left and right).",
  },
  {
    id: "pane.split.column",
    label: "Split pane vertically (side by side)",
    description: "Same as the default split — panes arranged in columns.",
  },
  {
    id: "pane.split.row",
    label: "Split pane horizontally (stacked)",
    shortcut: "Ctrl/Cmd+Shift+\\",
    description: "Add a row split in the active tab (panes top and bottom).",
  },
  {
    id: "pane.close",
    label: "Close active pane",
    shortcut: "Ctrl/Cmd+W",
    description: "Close the currently focused pane.",
  },
  {
    id: "pane.broadcast",
    label: "Arm broadcast (one-shot)",
    shortcut: "Ctrl/Cmd+Shift+B or Alt+Shift+B",
    description: "Next composer Enter sends to every operator pane in this tab, then broadcast turns off.",
  },
  ...PANE_FOCUS_COMMANDS,
  ...PANE_TARGET_COMMANDS,
  {
    id: "palette.toggle",
    label: "Toggle command palette",
    shortcut: "Ctrl/Cmd+K",
    description: "Search and execute shell UI commands.",
  },
  {
    id: "input.cycleMode",
    label: "Cycle input mode (Operator / Commander)",
    shortcut: "Ctrl/Cmd+`",
    description: "Toggle the focused session between Operator (composer) and Commander (raw terminal).",
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
    id: "ai.explainComposerDraft",
    label: "AI explain composer draft",
    description: "Run AI explain against the current shell composer text (active pane).",
  },
  {
    id: "ai.fixComposerDraft",
    label: "AI suggest safer composer draft",
    description: "Ask AI for a safer or corrected command from the composer draft (active pane).",
  },
  {
    id: "terminal.openFind",
    label: "Find in terminal",
    shortcut: "Ctrl/Cmd+Shift+F",
    description: "Open buffer search on the focused terminal pane.",
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
