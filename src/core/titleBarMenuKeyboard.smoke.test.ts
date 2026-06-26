import { describe, expect, it } from "vitest";
import { decideTitleBarMenuKeyAction } from "./titleBarMenuKeyboard";

describe("title bar menu keyboard", () => {
  it("cycles menu items with arrow keys", () => {
    expect(decideTitleBarMenuKeyAction({ key: "ArrowDown", activeIndex: 0, itemCount: 2 })).toEqual({
      nextIndex: 1,
      shouldClose: false,
      handled: true,
    });
    expect(decideTitleBarMenuKeyAction({ key: "ArrowUp", activeIndex: 0, itemCount: 2 })).toEqual({
      nextIndex: 1,
      shouldClose: false,
      handled: true,
    });
  });

  it("jumps to ends with Home and End", () => {
    expect(decideTitleBarMenuKeyAction({ key: "Home", activeIndex: 1, itemCount: 3 })).toEqual({
      nextIndex: 0,
      shouldClose: false,
      handled: true,
    });
    expect(decideTitleBarMenuKeyAction({ key: "End", activeIndex: 0, itemCount: 3 })).toEqual({
      nextIndex: 2,
      shouldClose: false,
      handled: true,
    });
  });

  it("closes on Escape", () => {
    expect(decideTitleBarMenuKeyAction({ key: "Escape", activeIndex: 1, itemCount: 2 })).toEqual({
      nextIndex: 1,
      shouldClose: true,
      handled: true,
    });
  });
});
