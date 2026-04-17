import { describe, expect, it } from "vitest";
import { matchShortcut, type ShortcutBinding } from "./keymap";

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
});
