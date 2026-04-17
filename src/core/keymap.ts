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

export const DEFAULT_KEYMAP: ShortcutBinding[] = [
  { command: "session.new", key: "t", ...modifierFlags() },
  { command: "pane.split", key: "\\", ...modifierFlags() },
  { command: "pane.close", key: "w", ...modifierFlags() },
  { command: "palette.toggle", key: "k", ...modifierFlags() },
  { command: "history.refresh", key: "h", ...modifierFlags() },
  { command: "ai.explainSelection", key: "e", shiftKey: true, ...modifierFlags() },
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
  return event.key.toLowerCase() === binding.key.toLowerCase();
}
