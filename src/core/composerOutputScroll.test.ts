import { describe, expect, it } from "vitest";
import { composerOutputScrollIntentFromKeyboardEvent } from "./composerOutputScroll";

function ev(
  key: string,
  mods: Partial<Pick<KeyboardEvent, "ctrlKey" | "shiftKey" | "altKey" | "metaKey">> = {},
): Pick<KeyboardEvent, "key" | "ctrlKey" | "shiftKey" | "altKey" | "metaKey"> {
  return {
    key,
    ctrlKey: mods.ctrlKey ?? false,
    shiftKey: mods.shiftKey ?? false,
    altKey: mods.altKey ?? false,
    metaKey: mods.metaKey ?? false,
  };
}

describe("composerOutputScrollIntentFromKeyboardEvent", () => {
  it("returns up/down only for ctrl+alt+page keys without shift/meta", () => {
    expect(composerOutputScrollIntentFromKeyboardEvent(ev("PageUp", { ctrlKey: true, altKey: true }))).toBe("up");
    expect(composerOutputScrollIntentFromKeyboardEvent(ev("PageDown", { ctrlKey: true, altKey: true }))).toBe(
      "down",
    );
  });

  it("returns null when modifiers are wrong", () => {
    expect(composerOutputScrollIntentFromKeyboardEvent(ev("PageUp"))).toBeNull();
    expect(composerOutputScrollIntentFromKeyboardEvent(ev("PageUp", { ctrlKey: true }))).toBeNull();
    expect(composerOutputScrollIntentFromKeyboardEvent(ev("PageUp", { altKey: true }))).toBeNull();
    expect(
      composerOutputScrollIntentFromKeyboardEvent(ev("PageUp", { ctrlKey: true, altKey: true, shiftKey: true })),
    ).toBeNull();
    expect(
      composerOutputScrollIntentFromKeyboardEvent(ev("PageUp", { ctrlKey: true, altKey: true, metaKey: true })),
    ).toBeNull();
  });

  it("returns null for other keys", () => {
    expect(composerOutputScrollIntentFromKeyboardEvent(ev("ArrowUp", { ctrlKey: true, altKey: true }))).toBeNull();
  });
});
