import { describe, expect, it } from "vitest";
import { canFocusComposerWhenPaneActive } from "./terminalComposerFocus";

describe("terminalComposerFocus", () => {
  it("allows composer focus when find is closed and composer is usable", () => {
    expect(canFocusComposerWhenPaneActive(false, false)).toBe(true);
  });

  it("defers to find bar when find is open", () => {
    expect(canFocusComposerWhenPaneActive(true, false)).toBe(false);
  });

  it("skips composer when session is unavailable or exited", () => {
    expect(canFocusComposerWhenPaneActive(false, true)).toBe(false);
  });
});
