/**
 * Find http(s) URL substrings on a single buffer line (0-based column indices).
 * Used by the xterm link provider; keep regex conservative to avoid false positives.
 */
const URL_PATTERN = /https?:\/\/[^\s\]"'<>[\]`]+/gi;

/** Unix absolute paths: leading slash, no whitespace or shell metacharacters in the span. */
const UNIX_ABS_PATH = /\/[^\s"'<>[\]`{}|;&\\]+/g;

/**
 * Characters that unconditionally end a Windows drive-letter scan once the
 * drive prefix has been consumed. `:` is included because after the drive
 * letter at position 1, any further colon is either compiler-style
 * `:line:col` (rustc / clang / tsc) or an NTFS alternate data stream, neither
 * of which we want to swallow into the clickable span.
 */
const WIN_PATH_HARD_STOPS = new Set<string>([
  "\r",
  "\n",
  '"',
  "'",
  "<",
  ">",
  "|",
  "`",
  "{",
  "}",
  ";",
  "&",
  "[",
  "]",
  ":",
]);

/** UNC scanner uses the same conservative stop set as Windows drive paths. */
const UNC_PATH_HARD_STOPS = WIN_PATH_HARD_STOPS;

export interface UrlRange {
  /** 0-based start column in the line string */
  start: number;
  /** 0-based exclusive end column */
  endExclusive: number;
  /** URL to open (trimmed of common trailing punctuation) */
  url: string;
}

export interface FilePathRange {
  start: number;
  endExclusive: number;
  /** Normalized path suitable for `openPath` (Windows: backslashes). */
  path: string;
}

export type MergedTerminalLink =
  | { kind: "http"; start: number; endExclusive: number; url: string }
  | { kind: "file"; start: number; endExclusive: number; path: string };

function trimTrailingPunctuation(raw: string): string {
  return raw.replace(/[),.;:]+$/u, "");
}

function trimTrailingSpaceAndPunct(raw: string): string {
  return raw.replace(/[\s),.;:]+$/u, "");
}

export function findHttpUrlsInLine(line: string): UrlRange[] {
  const out: UrlRange[] = [];
  let match: RegExpExecArray | null;
  URL_PATTERN.lastIndex = 0;
  while ((match = URL_PATTERN.exec(line)) !== null) {
    const raw = match[0];
    const url = trimTrailingPunctuation(raw);
    if (!url.startsWith("http://") && !url.startsWith("https://")) {
      continue;
    }
    const endExclusive = match.index + raw.length;
    out.push({
      start: match.index,
      endExclusive,
      url,
    });
  }
  return out;
}

function rangesOverlap(
  a: { start: number; endExclusive: number },
  b: { start: number; endExclusive: number },
): boolean {
  return a.start < b.endExclusive && a.endExclusive > b.start;
}

function pathHasParentTraversal(path: string): boolean {
  const segments = path.split(/[/\\]+/).filter(Boolean);
  return segments.includes("..");
}

/**
 * Sync guard before handing a matched string to the OS opener. Conservative:
 * absolute-looking paths only, no `..` segments, no NUL, no obvious shell
 * injection characters. Does not hit the filesystem.
 */
export function isSafeLocalPathForOpener(path: string): boolean {
  if (!path || path.length < 2 || path.includes("\0")) {
    return false;
  }
  if (/[|;&`]/.test(path)) {
    return false;
  }
  if (pathHasParentTraversal(path)) {
    return false;
  }
  const isWinDrive = /^[A-Za-z]:[/\\]/.test(path);
  const isUnixAbs = path.startsWith("/");
  const isUncPath = /^\\\\[^\\/]+\\[^\\/]+/.test(path);
  if (!isWinDrive && !isUnixAbs && !isUncPath) {
    return false;
  }
  // Reject ambiguous `//` runs in non-UNC paths.
  if (!isUncPath && path.includes("//")) {
    return false;
  }
  return true;
}

function stripCompilerLocationSuffix(path: string): string {
  return path.replace(/:(\d+)(?::(\d+))?$/u, "");
}

/** Bytes of `raw` that should underline as the file link (path only; not `:line:col`). */
function clickableFileSpanLength(raw: string): number {
  const trimmed = stripCompilerLocationSuffix(trimTrailingSpaceAndPunct(raw));
  return trimmed.length;
}

function normalizeFilePathForOpen(raw: string): string {
  const trimmed = stripCompilerLocationSuffix(trimTrailingSpaceAndPunct(raw));
  if (/^(?:[A-Za-z]:[/\\]|\\\\)/.test(trimmed)) {
    return trimmed.replace(/\//g, "\\");
  }
  return trimmed;
}

function isValidUnixPathMatchStart(line: string, start: number): boolean {
  if (start === 0) {
    return true;
  }
  const prev = line[start - 1];
  // `./src/...` is relative, not absolute.
  if (prev === ".") {
    return false;
  }
  // `file:///etc` or `https://host/path` — skip path-looking spans right after `//`.
  if (prev === "/") {
    return false;
  }
  return true;
}

function collectRegexMatches(
  line: string,
  re: RegExp,
  normalize: (raw: string) => string,
  unixStartGuard: boolean,
): FilePathRange[] {
  const out: FilePathRange[] = [];
  let match: RegExpExecArray | null;
  re.lastIndex = 0;
  while ((match = re.exec(line)) !== null) {
    const start = match.index;
    if (unixStartGuard && !isValidUnixPathMatchStart(line, start)) {
      continue;
    }
    const raw = match[0];
    const path = normalize(raw);
    if (!isSafeLocalPathForOpener(path)) {
      continue;
    }
    const spanLen = clickableFileSpanLength(raw);
    out.push({
      start,
      endExclusive: start + spanLen,
      path,
    });
  }
  return out;
}

/**
 * Look forward from an unescaped space during a Windows-path scan to decide
 * whether the space is intra-path (sits between two path segments) or a
 * boundary. Returns true when a `\` or `/` separator appears before the next
 * hard-stop character / double-space / line end. This keeps
 * `C:\Program Files\foo` and `C:\Users\John Doe\file.log` as single spans,
 * while preventing bare `C:\foo` from eating following English prose.
 */
function hasPathSeparatorBeforeStopWithHardStops(
  line: string,
  from: number,
  hardStops: ReadonlySet<string>,
): boolean {
  for (let j = from; j < line.length; j++) {
    const c = line[j];
    if (hardStops.has(c)) {
      return false;
    }
    if (c === "\\" || c === "/") {
      return true;
    }
    if (c === " " && line[j + 1] === " ") {
      return false;
    }
  }
  return false;
}

/**
 * Scan forward from the end of a `X:\` / `X:/` drive-letter prefix to find
 * plausible Windows absolute paths, including those containing spaces.
 *
 * Heuristics:
 * - Hard stop at control chars, quotes, angle brackets, shell metacharacters,
 *   square brackets, backtick, semicolon, ampersand, or any `:` (colons after
 *   the drive letter indicate compiler-style `:line:col` or NTFS alternate
 *   data streams — we stop so the clickable span is just the path).
 * - `(` / `)` are balanced so `C:\Program Files (x86)\foo` resolves as one
 *   span; an unmatched `)` ends the scan.
 * - Double-space terminates the scan (common prose separator).
 * - Single spaces are only accepted when a `\` or `/` separator appears
 *   before any hard stop — i.e. the space sits between two path segments.
 *   Bare trailing segments with an embedded space (e.g. `C:\Program Files`
 *   with nothing after) are not extended through the space; wrap such
 *   paths in quotes to disambiguate.
 */
function scanWindowsDriveLetterPaths(line: string): FilePathRange[] {
  const out: FilePathRange[] = [];
  const starter = /[A-Za-z]:(?:\\|\/)/g;
  let m: RegExpExecArray | null;
  while ((m = starter.exec(line)) !== null) {
    const start = m.index;
    // Skip starters that land inside a previously accepted span.
    if (out.some((r) => start < r.endExclusive && start >= r.start)) {
      continue;
    }
    const prefixEnd = start + m[0].length;
    let i = prefixEnd;
    let parenDepth = 0;
    while (i < line.length) {
      const c = line[i];
      if (WIN_PATH_HARD_STOPS.has(c)) {
        break;
      }
      if (c === "(") {
        parenDepth++;
        i++;
        continue;
      }
      if (c === ")") {
        if (parenDepth === 0) {
          break;
        }
        parenDepth--;
        i++;
        continue;
      }
      if (c === " ") {
        if (
          line[i + 1] === " " ||
          !hasPathSeparatorBeforeStopWithHardStops(line, i + 1, WIN_PATH_HARD_STOPS)
        ) {
          break;
        }
        i++;
        continue;
      }
      i++;
    }
    // Trim trailing whitespace and common punctuation, but never chew back
    // into the drive prefix itself.
    let rawEnd = i;
    while (rawEnd > prefixEnd && /[\s),.]/.test(line[rawEnd - 1])) {
      rawEnd--;
    }
    const raw = line.slice(start, rawEnd);
    const path = normalizeFilePathForOpen(raw);
    if (!isSafeLocalPathForOpener(path)) {
      continue;
    }
    const spanLen = clickableFileSpanLength(raw);
    out.push({
      start,
      endExclusive: start + spanLen,
      path,
    });
  }
  return out;
}

/**
 * Scan forward from UNC roots (`\\server\share`) and extend through plausible
 * path segments, including spaces between separators.
 */
function scanUncPaths(line: string): FilePathRange[] {
  const out: FilePathRange[] = [];
  const starter = /\\\\[^\\/\s"'<>[\]`{}|;&:]+\\[^\\/\s"'<>[\]`{}|;&:]+(?:\\|\/)?/g;
  let m: RegExpExecArray | null;
  while ((m = starter.exec(line)) !== null) {
    const start = m.index;
    const prefixEnd = start + m[0].length;
    let i = prefixEnd;
    let parenDepth = 0;
    while (i < line.length) {
      const c = line[i];
      if (UNC_PATH_HARD_STOPS.has(c)) {
        break;
      }
      if (c === "(") {
        parenDepth++;
        i++;
        continue;
      }
      if (c === ")") {
        if (parenDepth === 0) {
          break;
        }
        parenDepth--;
        i++;
        continue;
      }
      if (c === " ") {
        if (
          line[i + 1] === " " ||
          !hasPathSeparatorBeforeStopWithHardStops(line, i + 1, UNC_PATH_HARD_STOPS)
        ) {
          break;
        }
        i++;
        continue;
      }
      i++;
    }
    let rawEnd = i;
    while (rawEnd > prefixEnd && /[\s),.]/.test(line[rawEnd - 1])) {
      rawEnd--;
    }
    const raw = line.slice(start, rawEnd);
    const path = normalizeFilePathForOpen(raw);
    if (!isSafeLocalPathForOpener(path)) {
      continue;
    }
    const spanLen = clickableFileSpanLength(raw);
    out.push({
      start,
      endExclusive: start + spanLen,
      path,
    });
  }
  return out;
}

/**
 * Match explicitly quoted Windows drive-letter paths so spaces inside the
 * span are unambiguously part of the path. The clickable range is the *inner*
 * path (quotes are excluded) so a click registers on the path text itself.
 */
function findQuotedWindowsPaths(line: string): FilePathRange[] {
  const re = /(["'])([A-Za-z]:(?:\\|\/)[^\r\n"']+)\1/g;
  const out: FilePathRange[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(line)) !== null) {
    const inner = m[2];
    const innerStart = m.index + 1;
    const path = normalizeFilePathForOpen(inner);
    if (!isSafeLocalPathForOpener(path)) {
      continue;
    }
    const spanLen = clickableFileSpanLength(inner);
    out.push({
      start: innerStart,
      endExclusive: innerStart + spanLen,
      path,
    });
  }
  return out;
}

function findQuotedUnixPaths(line: string): FilePathRange[] {
  const re = /(["'])(\/[^\r\n"']+)\1/g;
  const out: FilePathRange[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(line)) !== null) {
    const inner = m[2];
    const innerStart = m.index + 1;
    if (!isValidUnixPathMatchStart(line, innerStart)) {
      continue;
    }
    const path = normalizeFilePathForOpen(inner);
    if (!isSafeLocalPathForOpener(path)) {
      continue;
    }
    const spanLen = clickableFileSpanLength(inner);
    out.push({
      start: innerStart,
      endExclusive: innerStart + spanLen,
      path,
    });
  }
  return out;
}

/**
 * Find absolute filesystem path substrings on a single line. Unix paths use a
 * conservative regex (spaces are still not supported there — wrap in quotes or
 * use a drive-letter alternative); Windows drive-letter paths use a
 * delimiter-aware scanner that accepts intra-segment spaces plus a quoted-path
 * pass for unambiguous spans. Overlapping candidates are resolved by keeping
 * longer matches first.
 */
export function findAbsoluteFilePathsInLine(line: string): FilePathRange[] {
  const unix = collectRegexMatches(line, UNIX_ABS_PATH, (raw) => normalizeFilePathForOpen(raw), true);
  const win = scanWindowsDriveLetterPaths(line);
  const unc = scanUncPaths(line);
  const quotedWindows = findQuotedWindowsPaths(line);
  const quotedUnix = findQuotedUnixPaths(line);
  const candidates = [...unix, ...win, ...unc, ...quotedWindows, ...quotedUnix];
  candidates.sort((a, b) => {
    const la = a.endExclusive - a.start;
    const lb = b.endExclusive - b.start;
    if (lb !== la) {
      return lb - la;
    }
    return a.start - b.start;
  });
  const kept: FilePathRange[] = [];
  for (const c of candidates) {
    if (kept.some((k) => rangesOverlap(k, c))) {
      continue;
    }
    kept.push(c);
  }
  kept.sort((a, b) => a.start - b.start);
  return kept;
}

/**
 * Build ordered link descriptors for one buffer line: all HTTP ranges, then file
 * ranges that do not overlap any HTTP span (HTTP wins on overlap).
 */
export function mergeHttpAndFileLinksForLine(line: string): MergedTerminalLink[] {
  const http = findHttpUrlsInLine(line);
  const files = findAbsoluteFilePathsInLine(line);
  const merged: MergedTerminalLink[] = [];
  for (const h of http) {
    merged.push({
      kind: "http",
      start: h.start,
      endExclusive: h.endExclusive,
      url: h.url,
    });
  }
  for (const f of files) {
    if (http.some((h) => rangesOverlap(f, h))) {
      continue;
    }
    merged.push({
      kind: "file",
      start: f.start,
      endExclusive: f.endExclusive,
      path: f.path,
    });
  }
  merged.sort((a, b) => a.start - b.start);
  return merged;
}

export function isSafeHttpUrlForOpener(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}
