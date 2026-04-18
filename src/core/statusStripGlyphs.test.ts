import { describe, expect, it } from "vitest";
import { shellChipLabel } from "./statusStripGlyphs";

describe("shellChipLabel", () => {
  it("strips Windows exe suffix", () => {
    expect(shellChipLabel(String.raw`C:\Windows\System32\pwsh.exe`)).toBe("pwsh");
  });

  it("keeps posix basename", () => {
    expect(shellChipLabel("/usr/bin/bash")).toBe("bash");
  });
});
