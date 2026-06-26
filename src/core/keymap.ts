import type { AppCommandId } from "./commands";

export interface ShortcutBinding {
  command: AppCommandId;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
  key: string;
}

const USER_AGENT = typeof navigator === "undefined" ? "" : navigator.userAgent.toLowerCase();
const IS_MAC = USER_AGENT.includes("mac");
const COMMAND_MODIFIER = IS_MAC ? "metaKey" : "ctrlKey";

const modifierFlags = (): Pick<ShortcutBinding, "ctrlKey" | "metaKey"> =>
  IS_MAC ? { metaKey: true } : { ctrlKey: true };

const PANE_FOCUS_COMMANDS: ShortcutBinding[] = Array.from({ length: 9 }, (_, index) => {
  const key = String(index + 1);
  const command = `pane.focus${index + 1}` as AppCommandId;
  // Plain Alt+digit is eaten by Windows menu chrome; use Ctrl+Alt there.
  if (IS_MAC) {
    return { command, key, altKey: true };
  }
  return { command, key, altKey: true, ctrlKey: true };
});

const PANE_TARGET_COMMANDS: ShortcutBinding[] = Array.from({ length: 9 }, (_, index) => {
  const key = String(index + 1);
  const command = `pane.target${index + 1}` as AppCommandId;
  if (IS_MAC) {
    return { command, key, altKey: true, shiftKey: true };
  }
  return { command, key, altKey: true, shiftKey: true, ctrlKey: true };
});

export function formatPaneFocusShortcut(paneIndex: number): string {
  return IS_MAC ? `Alt+${paneIndex}` : `Ctrl+Alt+${paneIndex}`;
}

export function formatPaneTargetShortcut(paneIndex: number): string {
  return IS_MAC ? `Alt+Shift+${paneIndex}` : `Ctrl+Alt+Shift+${paneIndex}`;
}

export const DEFAULT_KEYMAP: ShortcutBinding[] = [
  { command: "session.new", key: "t", ...modifierFlags() },
  { command: "session.rename", key: "F2" },
  { command: "pane.split", key: "\\", ...modifierFlags() },
  { command: "pane.split.row", key: "\\", shiftKey: true, ...modifierFlags() },
  { command: "pane.close", key: "w", ...modifierFlags() },
  { command: "pane.broadcast", key: "b", altKey: true, shiftKey: true },
  { command: "pane.broadcast", key: "b", shiftKey: true, ...modifierFlags() },
  { command: "pane.broadcastSticky", key: "b", altKey: true, shiftKey: true, ...modifierFlags() },
  ...PANE_FOCUS_COMMANDS,
  ...PANE_TARGET_COMMANDS,
  { command: "palette.toggle", key: "k", ...modifierFlags() },
  { command: "history.refresh", key: "h", ...modifierFlags() },
  { command: "ai.explainSelection", key: "e", shiftKey: true, ...modifierFlags() },
  { command: "ops.toggleRail", key: "o", altKey: true },
  { command: "ops.selectNextRun", key: "ArrowDown", altKey: true },
  { command: "ops.selectPrevRun", key: "ArrowUp", altKey: true },
  { command: "ops.jumpSelectedRun", key: "Enter", altKey: true },
];

export function formatShortcut(binding: ShortcutBinding): string {
  const pieces: string[] = [];
  if (binding.ctrlKey) {
    pieces.push("Ctrl");
  }
  if (binding.metaKey) {
    pieces.push("Cmd");
  }
  if (binding.altKey) {
    pieces.push("Alt");
  }
  if (binding.shiftKey) {
    pieces.push("Shift");
  }
  pieces.push(binding.key.toUpperCase());
  return pieces.join("+");
}

export function matchShortcut(event: KeyboardEvent, binding: ShortcutBinding): boolean {
  const requiredModifier = COMMAND_MODIFIER;
  if (binding[requiredModifier] && !event[requiredModifier]) {
    return false;
  }
  if (binding.ctrlKey === false && event.ctrlKey) {
    return false;
  }
  if (binding.metaKey === false && event.metaKey) {
    return false;
  }
  if (Boolean(binding.altKey) !== event.altKey) {
    return false;
  }
  if (Boolean(binding.shiftKey) !== event.shiftKey) {
    return false;
  }
  const normalizedKey = binding.key.toLowerCase();
  if (event.key.toLowerCase() === normalizedKey) {
    return true;
  }
  // Physical backslash is layout-sensitive; `event.key` may not be `\` on all keyboards.
  return normalizedKey === "\\" && event.code === "Backslash";
}

/**
 * True when the event target is UI chrome where typing should win over most shortcuts
 * (settings inputs, palette search, tab rename). xterm's helper textarea is excluded —
 * workspace chords must still fire while the PTY is focused.
 */
export function shouldBlockWorkspaceShortcut(target: EventTarget | null): boolean {
  if (!target || typeof target !== "object") {
    return false;
  }
  const element = target as HTMLElement;
  if (typeof element.classList?.contains !== "function") {
    return false;
  }
  if (element.classList.contains("xterm-helper-textarea")) {
    return false;
  }
  if (element.classList.contains("terminal-composer-field")) {
    return true;
  }
  if (element.classList.contains("tab-name-input")) {
    return true;
  }
  if (element.closest(".palette-panel")) {
    return true;
  }
  const tag = element.tagName;
  if (tag === "TEXTAREA" || tag === "INPUT") {
    return true;
  }
  return element.isContentEditable;
}

/** Chords that must work while the composer or palette search field is focused. */
const PANE_SHORTCUT_PREFIXES = [
  "pane.focus",
  "pane.target",
  "pane.split",
  "pane.close",
  "pane.broadcast",
] as const;

export const GLOBAL_SHORTCUT_COMMANDS: ReadonlySet<AppCommandId> = new Set([
  "palette.toggle",
  "session.new",
  "session.newWithProfile",
  "session.rename",
  "ops.toggleRail",
  "pane.split",
  "pane.split.column",
  "pane.split.row",
  "pane.close",
  "pane.broadcast",
  "pane.broadcastSticky",
  "pane.broadcastDisarm",
]);

export function shortcutAllowedInTextField(command: AppCommandId): boolean {
  if (GLOBAL_SHORTCUT_COMMANDS.has(command)) {
    return true;
  }
  return PANE_SHORTCUT_PREFIXES.some((prefix) => command.startsWith(prefix));
}

const PANE_INDEX_COMMAND = /^pane\.(focus|target)([1-9])$/;

export function paneIndexFromCommand(commandId: string): { mode: "focus" | "target"; index: number } | null {
  const match = PANE_INDEX_COMMAND.exec(commandId);
  if (!match) {
    return null;
  }
  return { mode: match[1] as "focus" | "target", index: Number.parseInt(match[2], 10) };
}
