import { describe, expect, it } from "vitest";
import { buildFindOptions, formatFindStatus } from "./terminalFindStatus";

describe("formatFindStatus", () => {
  it("returns empty string for empty query regardless of result state", () => {
    expect(formatFindStatus({ query: "", resultIndex: 0, resultCount: 0 })).toBe("");
    expect(formatFindStatus({ query: "", resultIndex: 3, resultCount: 10 })).toBe("");
  });

  it("reports no matches for non-empty query with zero results", () => {
    expect(formatFindStatus({ query: "foo", resultIndex: -1, resultCount: 0 })).toBe(
      "no matches",
    );
    expect(formatFindStatus({ query: "foo", resultIndex: 0, resultCount: 0 })).toBe(
      "no matches",
    );
  });

  it("renders single-match position as 1 / 1", () => {
    expect(formatFindStatus({ query: "foo", resultIndex: 0, resultCount: 1 })).toBe("1 / 1");
  });

  it("renders mid-walk position with one-based index", () => {
    expect(formatFindStatus({ query: "foo", resultIndex: 2, resultCount: 12 })).toBe(
      "3 / 12",
    );
  });

  it("renders many matches when the addon exceeds its highlight limit", () => {
    expect(formatFindStatus({ query: "foo", resultIndex: -1, resultCount: 5000 })).toBe(
      "many matches",
    );
  });

  it("clamps an unexpected negative index to 0 when results exist", () => {
    expect(formatFindStatus({ query: "foo", resultIndex: -2, resultCount: 4 })).toBe("0 / 4");
  });
});

describe("buildFindOptions", () => {
  it("produces an empty options bag when all flags are off", () => {
    expect(buildFindOptions({ caseSensitive: false, wholeWord: false, regex: false })).toEqual(
      {},
    );
  });

  it("maps every flag 1:1 when all are on", () => {
    expect(buildFindOptions({ caseSensitive: true, wholeWord: true, regex: true })).toEqual({
      caseSensitive: true,
      wholeWord: true,
      regex: true,
    });
  });

  it("only sets flags that are enabled (case-sensitive only)", () => {
    expect(
      buildFindOptions({ caseSensitive: true, wholeWord: false, regex: false }),
    ).toEqual({ caseSensitive: true });
  });

  it("only sets flags that are enabled (whole-word only)", () => {
    expect(
      buildFindOptions({ caseSensitive: false, wholeWord: true, regex: false }),
    ).toEqual({ wholeWord: true });
  });

  it("only sets flags that are enabled (regex only)", () => {
    expect(
      buildFindOptions({ caseSensitive: false, wholeWord: false, regex: true }),
    ).toEqual({ regex: true });
  });
});
