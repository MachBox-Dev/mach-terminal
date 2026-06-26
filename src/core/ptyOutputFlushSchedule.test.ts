import { describe, expect, it } from "vitest";
import {
  shouldForceOutputFlushOnWake,
  shouldSkipVisibilityOutputKick,
} from "./ptyOutputFlushSchedule";

describe("ptyOutputFlushSchedule", () => {
  it("skips visibility kick while hidden", () => {
    expect(shouldSkipVisibilityOutputKick("hidden")).toBe(true);
    expect(shouldSkipVisibilityOutputKick("visible")).toBe(false);
  });

  it("forces wake flush whenever pending chunks exist (even if rAF is stale)", () => {
    expect(shouldForceOutputFlushOnWake(false)).toBe(false);
    expect(shouldForceOutputFlushOnWake(true)).toBe(true);
  });
});
