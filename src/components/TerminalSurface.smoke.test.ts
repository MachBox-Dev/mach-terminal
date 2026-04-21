import { describe, expect, it } from "vitest";
import {
  BELL_FLASH_DURATION_MS,
  canPasteFromContextMenu,
  clampContextMenuPosition,
  contextMenuDismissActionForKey,
  contextMenuPasteActionState,
  evaluatePendingPasteState,
  shouldKeepContextMenuOpenForPointerTarget,
} from "./TerminalSurface";
import { pendingPasteGuardActionForKey } from "../core/terminalPasteGuard";

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
    expect(contextMenuPasteActionState(undefined).enabled).toBe(false);
    expect(contextMenuPasteActionState({ id: "session-1" }).enabled).toBe(true);
  });

  it("opens safe-paste guard only for risky payloads", () => {
    expect(evaluatePendingPasteState("echo hello", false)).toBeNull();
    const risky = evaluatePendingPasteState("rm tmp && ls\npwd", false);
    expect(risky).not.toBeNull();
    expect(risky?.reasons.length).toBeGreaterThan(0);
    expect(risky?.summary.lineCount).toBe(2);
  });

  it("keeps pending-paste guard key handling stable", () => {
    expect(pendingPasteGuardActionForKey("Enter")).toBe("confirm");
    expect(pendingPasteGuardActionForKey("Escape")).toBe("cancel");
    expect(pendingPasteGuardActionForKey("Tab")).toBeNull();
  });

  it("keeps context-menu dismissal key contract stable", () => {
    expect(contextMenuDismissActionForKey("Escape")).toBe("dismiss");
    expect(contextMenuDismissActionForKey("Enter")).toBeNull();
    expect(shouldKeepContextMenuOpenForPointerTarget(true)).toBe(true);
    expect(shouldKeepContextMenuOpenForPointerTarget(false)).toBe(false);
  });

  it("keeps bell flash duration contract stable", () => {
    expect(BELL_FLASH_DURATION_MS).toBe(200);
  });
});
