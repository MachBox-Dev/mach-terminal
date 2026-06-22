import { describe, expect, it } from "vitest";
import { APP_COMMANDS, type AppCommandId } from "./commands";
import { DEFAULT_KEYMAP } from "./keymap";

describe("keymap palette coverage", () => {
  it("every default keymap binding has a command palette entry", () => {
    const paletteIds = new Set(APP_COMMANDS.map((command) => command.id));
    const missing: AppCommandId[] = [];
    for (const binding of DEFAULT_KEYMAP) {
      if (!paletteIds.has(binding.command)) {
        missing.push(binding.command);
      }
    }
    expect(missing, `missing palette entries: ${missing.join(", ")}`).toEqual([]);
  });
});
