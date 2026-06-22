import { describe, expect, it } from "vitest";
import { matchShortcut, shouldBlockWorkspaceShortcut, shortcutAllowedInTextField, formatPaneFocusShortcut, formatPaneTargetShortcut, type ShortcutBinding } from "./keymap";

function keyboardEventLike(overrides: Partial<KeyboardEvent>): KeyboardEvent {
  return {
    key: "",
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    shiftKey: false,
    ...overrides,
  } as KeyboardEvent;
}

describe("keymap matching", () => {
  it("matches control shortcut exactly", () => {
    const binding: ShortcutBinding = { command: "history.refresh", key: "h", ctrlKey: true };
    const event = keyboardEventLike({ key: "h", ctrlKey: true });
    expect(matchShortcut(event, binding)).toBe(true);
  });

  it("rejects missing required modifier", () => {
    const binding: ShortcutBinding = { command: "history.refresh", key: "h", ctrlKey: true };
    const event = keyboardEventLike({ key: "h", ctrlKey: false });
    expect(matchShortcut(event, binding)).toBe(false);
  });

  it("rejects shift mismatch", () => {
    const binding: ShortcutBinding = { command: "ai.explainSelection", key: "e", ctrlKey: true, shiftKey: true };
    const event = keyboardEventLike({ key: "e", ctrlKey: true, shiftKey: false });
    expect(matchShortcut(event, binding)).toBe(false);
  });

  it("rejects alt collisions for non-alt bindings", () => {
    const binding: ShortcutBinding = { command: "history.refresh", key: "h", ctrlKey: true };
    const event = keyboardEventLike({ key: "h", ctrlKey: true, altKey: true });
    expect(matchShortcut(event, binding)).toBe(false);
  });

  it("matches explicit alt binding", () => {
    const binding: ShortcutBinding = { command: "history.refresh", key: "h", ctrlKey: true, altKey: true };
    const event = keyboardEventLike({ key: "h", ctrlKey: true, altKey: true });
    expect(matchShortcut(event, binding)).toBe(true);
  });

  it("allows palette toggle from text fields", () => {
    expect(shortcutAllowedInTextField("palette.toggle")).toBe(true);
    expect(shortcutAllowedInTextField("history.refresh")).toBe(false);
    expect(shortcutAllowedInTextField("pane.split")).toBe(true);
  });

  it("matches backslash via physical key code", () => {
    const binding: ShortcutBinding = { command: "pane.split", key: "\\", ctrlKey: true };
    const event = keyboardEventLike({ key: "|", ctrlKey: true, code: "Backslash" } as Partial<KeyboardEvent>);
    expect(matchShortcut(event, binding)).toBe(true);
  });

  it("does not block workspace shortcuts for xterm helper textarea", () => {
    const textarea = {
      classList: { contains: (token: string) => token === "xterm-helper-textarea" },
      tagName: "TEXTAREA",
      isContentEditable: false,
      closest: () => null,
    } as unknown as HTMLElement;
    expect(shouldBlockWorkspaceShortcut(textarea)).toBe(false);
  });

  it("blocks workspace shortcuts for composer and palette inputs", () => {
    const composer = {
      classList: { contains: (token: string) => token === "terminal-composer-field" },
      tagName: "TEXTAREA",
      isContentEditable: false,
      closest: () => null,
    } as unknown as HTMLElement;
    expect(shouldBlockWorkspaceShortcut(composer)).toBe(true);

    const paletteInput = {
      classList: { contains: () => false },
      tagName: "INPUT",
      isContentEditable: false,
      closest: (selector: string) => (selector === ".palette-panel" ? ({} as HTMLElement) : null),
    } as unknown as HTMLElement;
    expect(shouldBlockWorkspaceShortcut(paletteInput)).toBe(true);
  });

  it("matches pane focus alt bindings", () => {
    const binding: ShortcutBinding = { command: "pane.focus3", key: "3", altKey: true };
    expect(matchShortcut(keyboardEventLike({ key: "3", altKey: true }), binding)).toBe(true);
    expect(matchShortcut(keyboardEventLike({ key: "3", altKey: false }), binding)).toBe(false);
  });

  it("allows pane focus from composer text fields", () => {
    expect(shortcutAllowedInTextField("pane.focus2")).toBe(true);
    expect(shortcutAllowedInTextField("pane.target3")).toBe(true);
  });

  it("matches pane target shift-alt bindings on mac", () => {
    const binding: ShortcutBinding = { command: "pane.target3", key: "3", altKey: true, shiftKey: true };
    expect(matchShortcut(keyboardEventLike({ key: "3", altKey: true, shiftKey: true }), binding)).toBe(true);
    expect(matchShortcut(keyboardEventLike({ key: "3", altKey: true, shiftKey: false }), binding)).toBe(false);
  });

  it("matches pane target ctrl-alt-shift on windows", () => {
    const binding: ShortcutBinding = {
      command: "pane.target4",
      key: "4",
      altKey: true,
      shiftKey: true,
      ctrlKey: true,
    };
    expect(
      matchShortcut(keyboardEventLike({ key: "4", altKey: true, shiftKey: true, ctrlKey: true }), binding),
    ).toBe(true);
  });

  it("formats pane shortcut labels", () => {
    expect(formatPaneFocusShortcut(2)).toMatch(/2/);
    expect(formatPaneTargetShortcut(2)).toMatch(/2/);
  });

  it("matches horizontal split with shift+backslash", () => {
    const binding: ShortcutBinding = { command: "pane.split.row", key: "\\", ctrlKey: true, shiftKey: true };
    const event = keyboardEventLike({ key: "|", ctrlKey: true, shiftKey: true, code: "Backslash" } as Partial<KeyboardEvent>);
    expect(matchShortcut(event, binding)).toBe(true);
  });
});
