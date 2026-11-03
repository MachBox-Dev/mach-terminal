import { expect, it } from "vitest";
import { shouldForwardTerminalData, usesRawTerminalInput } from "./terminalInputRouting";
import { canFocusComposerWhenPaneActive } from "./terminalComposerFocus";

it("routes Operator agent focus to xterm while leaving ordinary Operator input in the composer", () => {
  expect(usesRawTerminalInput("operator", true)).toBe(true);
  expect(usesRawTerminalInput("operator", false)).toBe(false);
  expect(canFocusComposerWhenPaneActive(false, false, "operator", true)).toBe(false);
});

it("answers queries in unfocused panes without forwarding keyboard or paste input", () => {
  for (const reply of ["\x1b[1;2R", "\x1b[?1;2c", "\x1b[>0;1;0c", "\x1b]10;rgb:ffff/ffff/ffff\x07"]) {
    expect(shouldForwardTerminalData(reply, false, false)).toBe(true);
  }
  for (const input of ["x", "\x1b[A", "\x1b[200~exit\x1b[201~"]) {
    expect(shouldForwardTerminalData(input, true, false)).toBe(false);
    expect(shouldForwardTerminalData(input, false, true)).toBe(false);
    expect(shouldForwardTerminalData(input, true, true)).toBe(true);
  }
});
