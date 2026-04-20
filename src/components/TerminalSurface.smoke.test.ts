import { describe, expect, it } from "vitest";
import {
  BELL_FLASH_DURATION_MS,
  canPasteFromContextMenu,
  clampContextMenuPosition,
  evaluatePendingPasteState,
} from "./TerminalSurface";

describe("TerminalSurface smoke contracts", () => {
  it("keeps context menu within viewport bounds", () => {
    expect(
      clampContextMenuPosition({
        x: 500,
        y: 400,
        menuWidth: 120,
        menuHeight: 80,
        viewportWidth: 640,
        viewportHeight: 480,
      }),
    ).toEqual({ x: 500, y: 392 });
    expect(
      clampContextMenuPosition({
        x: 100,
        y: 120,
        menuWidth: 80,
        menuHeight: 60,
        viewportWidth: 640,
        viewportHeight: 480,
      }),
    ).toEqual({ x: 100, y: 120 });
  });

  it("requires an active session for context-menu paste", () => {
    expect(canPasteFromContextMenu(undefined)).toBe(false);
    expect(canPasteFromContextMenu({ id: "session-1" })).toBe(true);
  });

  it("opens safe-paste guard only for risky payloads", () => {
    expect(evaluatePendingPasteState("echo hello", false)).toBeNull();
    const risky = evaluatePendingPasteState("rm tmp && ls\npwd", false);
    expect(risky).not.toBeNull();
    expect(risky?.reasons.length).toBeGreaterThan(0);
    expect(risky?.summary.lineCount).toBe(2);
  });

  it("keeps bell flash duration contract stable", () => {
    expect(BELL_FLASH_DURATION_MS).toBe(200);
  });
});
