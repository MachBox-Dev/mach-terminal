/**
 * Keyboard shortcuts to scroll the xterm viewport while the composer textarea
 * retains focus (unified composer model).
 */

export type ComposerOutputScrollDirection = "up" | "down";

/**
 * Ctrl+Alt+PageUp / PageDown avoids common browser bindings (e.g. Ctrl+PageUp
 * switching tabs) and does not steal plain PageUp from native textarea behavior.
 */
export function composerOutputScrollIntentFromKeyboardEvent(
  e: Pick<KeyboardEvent, "key" | "ctrlKey" | "shiftKey" | "altKey" | "metaKey">,
): ComposerOutputScrollDirection | null {
  if (!e.ctrlKey || !e.altKey || e.metaKey || e.shiftKey) {
    return null;
  }
  if (e.key === "PageUp") {
    return "up";
  }
  if (e.key === "PageDown") {
    return "down";
  }
  return null;
}
