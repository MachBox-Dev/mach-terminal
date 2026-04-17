import { describe, expect, it } from "vitest";
import {
  findAbsoluteFilePathsInLine,
  findHttpUrlsInLine,
  isSafeHttpUrlForOpener,
  isSafeLocalPathForOpener,
  mergeHttpAndFileLinksForLine,
} from "./terminalLinkRanges";

describe("findHttpUrlsInLine", () => {
  it("finds a simple https URL", () => {
    const line = "see https://example.com/path for more";
    const hits = findHttpUrlsInLine(line);
    expect(hits).toHaveLength(1);
    expect(hits[0].url).toBe("https://example.com/path");
    expect(hits[0].start).toBe(line.indexOf("https"));
  });

  it("trims trailing punctuation from URL", () => {
    const hits = findHttpUrlsInLine("link https://a.test/b).");
    expect(hits[0].url).toBe("https://a.test/b");
  });

  it("returns empty when no URL", () => {
    expect(findHttpUrlsInLine("no links here")).toEqual([]);
  });
});

describe("isSafeHttpUrlForOpener", () => {
  it("accepts http and https", () => {
    expect(isSafeHttpUrlForOpener("https://x.com")).toBe(true);
    expect(isSafeHttpUrlForOpener("http://x.com")).toBe(true);
  });

  it("rejects javascript and garbage", () => {
    expect(isSafeHttpUrlForOpener("javascript:alert(1)")).toBe(false);
    expect(isSafeHttpUrlForOpener("not a url")).toBe(false);
  });
});

describe("isSafeLocalPathForOpener", () => {
  it("accepts simple unix absolute paths", () => {
    expect(isSafeLocalPathForOpener("/etc/hosts")).toBe(true);
    expect(isSafeLocalPathForOpener("/tmp")).toBe(true);
  });

  it("accepts windows drive paths", () => {
    expect(isSafeLocalPathForOpener("C:\\Windows\\System32")).toBe(true);
    expect(isSafeLocalPathForOpener("C:/Users/mike/dev")).toBe(true);
  });

  it("accepts UNC paths", () => {
    expect(isSafeLocalPathForOpener("\\\\server\\share\\logs\\app.log")).toBe(true);
    expect(isSafeLocalPathForOpener("\\\\server\\share")).toBe(true);
  });

  it("rejects relative paths", () => {
    expect(isSafeLocalPathForOpener("./foo")).toBe(false);
    expect(isSafeLocalPathForOpener("foo/bar")).toBe(false);
  });

  it("rejects parent traversal", () => {
    expect(isSafeLocalPathForOpener("/tmp/../etc/passwd")).toBe(false);
    expect(isSafeLocalPathForOpener("C:\\foo\\..\\bar")).toBe(false);
  });

  it("rejects shell metacharacters", () => {
    expect(isSafeLocalPathForOpener("/tmp/foo;rm -rf /")).toBe(false);
    expect(isSafeLocalPathForOpener("/tmp|`id`")).toBe(false);
  });

  it("rejects double-slash bodies", () => {
    expect(isSafeLocalPathForOpener("/tmp//foo")).toBe(false);
  });
});

describe("findAbsoluteFilePathsInLine", () => {
  it("finds unix absolute paths", () => {
    const hits = findAbsoluteFilePathsInLine("file is /etc/hosts ok");
    expect(hits.length).toBeGreaterThanOrEqual(1);
    expect(hits.some((h) => h.path === "/etc/hosts")).toBe(true);
  });

  it("finds windows drive paths", () => {
    const hits = findAbsoluteFilePathsInLine("see C:\\Windows\\Temp\\foo.log");
    expect(hits.length).toBeGreaterThanOrEqual(1);
    expect(hits.some((h) => h.path.includes("Windows") && h.path.startsWith("C:"))).toBe(true);
  });

  it("prefers longer windows path over shorter prefix", () => {
    const line = "C:\\a\\b\\c";
    const hits = findAbsoluteFilePathsInLine(line);
    expect(hits).toHaveLength(1);
    expect(hits[0].path).toBe("C:\\a\\b\\c");
  });

  it("returns empty for relative paths", () => {
    expect(findAbsoluteFilePathsInLine("./src/foo.ts")).toEqual([]);
  });

  it("finds UNC paths", () => {
    const line = "artifact \\\\server\\share\\logs\\build.log uploaded";
    const hits = findAbsoluteFilePathsInLine(line);
    expect(hits.some((h) => h.path === "\\\\server\\share\\logs\\build.log")).toBe(true);
  });

  it("finds UNC paths with spaces in deeper segments", () => {
    const line = "saved at \\\\server\\share\\release notes\\v1\\out.txt";
    const hits = findAbsoluteFilePathsInLine(line);
    expect(hits.some((h) => h.path === "\\\\server\\share\\release notes\\v1\\out.txt")).toBe(true);
  });

  it("accepts spaces between segments (Program Files case)", () => {
    const line = "opened C:\\Program Files\\MyApp\\bin\\app.exe today";
    const hits = findAbsoluteFilePathsInLine(line);
    expect(hits.some((h) => h.path === "C:\\Program Files\\MyApp\\bin\\app.exe")).toBe(true);
  });

  it("accepts user directories with embedded spaces", () => {
    const line = "log at C:\\Users\\Mike Smith\\Documents\\out.log";
    const hits = findAbsoluteFilePathsInLine(line);
    expect(hits.some((h) => h.path === "C:\\Users\\Mike Smith\\Documents\\out.log")).toBe(true);
  });

  it("keeps paren-wrapped segments intact (x86)", () => {
    const line = "ran C:\\Program Files (x86)\\Thing\\run.bat";
    const hits = findAbsoluteFilePathsInLine(line);
    expect(hits.some((h) => h.path === "C:\\Program Files (x86)\\Thing\\run.bat")).toBe(true);
  });

  it("stops at closing paren when path is wrapped", () => {
    const line = "ran (C:\\Windows\\Temp\\foo.log) earlier";
    const hits = findAbsoluteFilePathsInLine(line);
    expect(hits.some((h) => h.path === "C:\\Windows\\Temp\\foo.log")).toBe(true);
    expect(hits.every((h) => !h.path.endsWith(")"))).toBe(true);
  });

  it("stops scanning at trailing prose when no separator follows the space", () => {
    const line = "wrote C:\\foo\\bar and then did something else";
    const hits = findAbsoluteFilePathsInLine(line);
    const win = hits.filter((h) => h.path.startsWith("C:"));
    expect(win).toHaveLength(1);
    expect(win[0].path).toBe("C:\\foo\\bar");
  });

  it("stops at colon introducing compiler line info", () => {
    const line = "error in C:\\src\\main.ts:42:7 missing";
    const hits = findAbsoluteFilePathsInLine(line);
    const win = hits.filter((h) => h.path.startsWith("C:"));
    expect(win).toHaveLength(1);
    expect(win[0].path).toBe("C:\\src\\main.ts");
  });

  it("trims compiler-style line info for unix paths", () => {
    const line = "at /src/main.ts:42:7 while compiling";
    const hits = findAbsoluteFilePathsInLine(line);
    expect(hits.some((h) => h.path === "/src/main.ts")).toBe(true);
  });

  it("stops on double space even with a later separator", () => {
    const line = "C:\\foo  C:\\other\\thing";
    const hits = findAbsoluteFilePathsInLine(line);
    expect(hits.map((h) => h.path).sort()).toEqual(["C:\\foo", "C:\\other\\thing"]);
  });

  it("recognizes quoted Windows paths with spaces", () => {
    const line = 'open "C:\\Program Files\\Thing With Spaces" now';
    const hits = findAbsoluteFilePathsInLine(line);
    expect(hits.some((h) => h.path === "C:\\Program Files\\Thing With Spaces")).toBe(true);
  });

  it("recognizes single-quoted Windows paths with spaces", () => {
    const line = "see 'C:\\Users\\John Doe\\notes.txt' for details";
    const hits = findAbsoluteFilePathsInLine(line);
    expect(hits.some((h) => h.path === "C:\\Users\\John Doe\\notes.txt")).toBe(true);
  });

  it("recognizes quoted Unix paths with spaces", () => {
    const line = 'launch "/opt/My App/bin/start.sh" now';
    const hits = findAbsoluteFilePathsInLine(line);
    expect(hits.some((h) => h.path === "/opt/My App/bin/start.sh")).toBe(true);
  });

  it("recognizes single-quoted Unix paths with spaces", () => {
    const line = "read '/var/log/My App/service.log' next";
    const hits = findAbsoluteFilePathsInLine(line);
    expect(hits.some((h) => h.path === "/var/log/My App/service.log")).toBe(true);
  });

  it("normalizes forward slashes in scanned Windows paths", () => {
    const line = "cwd C:/Users/Mike Smith/dev/mach-terminal done";
    const hits = findAbsoluteFilePathsInLine(line);
    expect(hits.some((h) => h.path === "C:\\Users\\Mike Smith\\dev\\mach-terminal")).toBe(true);
  });

  it("drops candidates with parent traversal even if scanned", () => {
    const line = "bad C:\\foo\\..\\bar";
    const hits = findAbsoluteFilePathsInLine(line);
    expect(hits.every((h) => !h.path.includes(".."))).toBe(true);
  });
});

describe("mergeHttpAndFileLinksForLine", () => {
  it("includes both http and file when non-overlapping", () => {
    const merged = mergeHttpAndFileLinksForLine("/etc/hosts then https://a.test/b end");
    const kinds = merged.map((m) => m.kind);
    expect(kinds).toContain("http");
    expect(kinds).toContain("file");
    expect(merged.some((m) => m.kind === "file" && m.path === "/etc/hosts")).toBe(true);
  });

  it("drops file range that overlaps an http URL path segment", () => {
    const line = "https://example.com/foo/bar";
    const merged = mergeHttpAndFileLinksForLine(line);
    expect(merged).toHaveLength(1);
    expect(merged[0].kind).toBe("http");
  });

  it("sorts merged links by start column", () => {
    const merged = mergeHttpAndFileLinksForLine("/tmp first https://z.com last");
    for (let i = 1; i < merged.length; i++) {
      expect(merged[i].start).toBeGreaterThanOrEqual(merged[i - 1].start);
    }
  });

  it("keeps spaced Windows path alongside an unrelated http URL", () => {
    const line = "open C:\\Program Files\\App\\run.exe and https://a.test/x now";
    const merged = mergeHttpAndFileLinksForLine(line);
    const http = merged.find((m) => m.kind === "http");
    const file = merged.find((m) => m.kind === "file");
    expect(http?.kind === "http" && http.url).toBe("https://a.test/x");
    expect(file?.kind === "file" && file.path).toBe("C:\\Program Files\\App\\run.exe");
  });

  it("keeps UNC path alongside an unrelated http URL", () => {
    const line = "\\\\server\\share\\logs\\build.log then https://a.test/x";
    const merged = mergeHttpAndFileLinksForLine(line);
    expect(merged.some((m) => m.kind === "file" && m.path === "\\\\server\\share\\logs\\build.log")).toBe(true);
    expect(merged.some((m) => m.kind === "http" && m.url === "https://a.test/x")).toBe(true);
  });
});
