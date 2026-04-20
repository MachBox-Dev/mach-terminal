import { describe, expect, it } from "vitest";
import { canRestoreShellBackup } from "./ShellIntegrationSection";

describe("canRestoreShellBackup", () => {
  it("requires a selected backup id", () => {
    expect(canRestoreShellBackup({ busy: false, backupBusy: false, backupSelectedId: null })).toBe(false);
  });

  it("disables restore while any operation is busy", () => {
    expect(canRestoreShellBackup({ busy: true, backupBusy: false, backupSelectedId: "id" })).toBe(false);
    expect(canRestoreShellBackup({ busy: false, backupBusy: true, backupSelectedId: "id" })).toBe(false);
  });

  it("enables restore for idle state with selected backup", () => {
    expect(canRestoreShellBackup({ busy: false, backupBusy: false, backupSelectedId: "id" })).toBe(true);
  });
});
