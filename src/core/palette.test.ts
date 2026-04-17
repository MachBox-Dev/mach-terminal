import { describe, expect, it } from "vitest";
import { filterPaletteCommands, scorePaletteCommand } from "./palette";

describe("palette scoring", () => {
  const commands = [
    { id: "session.new", label: "Create new session", shortcut: "Ctrl+T" },
    { id: "history.refresh", label: "Refresh command history", shortcut: "Ctrl+H" },
    { id: "palette.toggle", label: "Toggle command palette", shortcut: "Ctrl+K" },
  ];

  it("prefers label prefix matches", () => {
    const ranked = filterPaletteCommands(commands, "toggle");
    expect(ranked[0]?.command.id).toBe("palette.toggle");
  });

  it("matches shortcut tokens", () => {
    const ranked = filterPaletteCommands(commands, "ctrl+h");
    expect(ranked[0]?.command.id).toBe("history.refresh");
  });

  it("returns zero score when query is absent from command", () => {
    expect(scorePaletteCommand(commands[0], "not-present")).toBe(0);
  });
});
