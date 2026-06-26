import { describe, expect, it } from "vitest";
import { APP_COMMANDS } from "./commands";
import { DEFAULT_KEYMAP, GLOBAL_SHORTCUT_COMMANDS, shortcutAllowedInTextField } from "./keymap";

describe("tab rename command", () => {
  it("registers session.rename in palette and keymap", () => {
    const command = APP_COMMANDS.find((entry) => entry.id === "session.rename");
    expect(command?.label).toBe("Rename active tab");
    expect(command?.shortcut).toBe("F2");
    expect(DEFAULT_KEYMAP.some((binding) => binding.command === "session.rename" && binding.key === "F2")).toBe(
      true,
    );
  });

  it("allows F2 rename from composer via global shortcut allowlist", () => {
    expect(GLOBAL_SHORTCUT_COMMANDS.has("session.rename")).toBe(true);
    expect(shortcutAllowedInTextField("session.rename")).toBe(true);
  });
});
