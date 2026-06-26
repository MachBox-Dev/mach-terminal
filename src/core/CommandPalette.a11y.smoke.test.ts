import { describe, expect, it, vi } from "vitest";
import { paletteOptionId } from "../components/CommandPalette";
import { handleFocusTrapTab } from "./focusTrap";

describe("CommandPalette a11y helpers", () => {
  it("builds stable option ids inside a listbox", () => {
    expect(paletteOptionId("palette-list", 0)).toBe("palette-list-option-0");
    expect(paletteOptionId("palette-list", 3)).toBe("palette-list-option-3");
  });

  it("traps Tab from last to first focusable element", () => {
    const first = {
      tabIndex: 0,
      hasAttribute: () => false,
      focus: vi.fn(),
    } as unknown as HTMLElement;
    const last = {
      tabIndex: 0,
      hasAttribute: () => false,
      focus: vi.fn(),
    } as unknown as HTMLElement;
    const root = {
      querySelectorAll: () => [first, last],
    } as unknown as ParentNode;

    let prevented = false;
    const trapped = handleFocusTrapTab(
      {
        key: "Tab",
        shiftKey: false,
        preventDefault: () => {
          prevented = true;
        },
      },
      root,
      last,
    );

    expect(trapped).toBe(true);
    expect(prevented).toBe(true);
    expect(first.focus).toHaveBeenCalledTimes(1);
  });
});
