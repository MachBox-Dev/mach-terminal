export interface FindStatusInput {
  query: string;
  /** Zero-based index of the active match, or -1 when the addon exceeded its highlight limit. */
  resultIndex: number;
  resultCount: number;
}

export interface FindOptionFlags {
  caseSensitive: boolean;
  wholeWord: boolean;
  regex: boolean;
}

/**
 * xterm `ISearchOptions` subset we actually write to the addon.
 * Flags omitted when false so the options bag stays minimal and stable for tests.
 */
export interface FindSearchOptions {
  caseSensitive?: boolean;
  wholeWord?: boolean;
  regex?: boolean;
}

/**
 * Deterministic human-readable counter for the find bar.
 *
 * Contract:
 * - Empty query -> "" (nothing to display).
 * - Non-empty query with `resultCount === 0` -> "no matches".
 * - `resultIndex === -1` with `resultCount > 0` -> "many matches" (addon's over-highlight-limit sentinel).
 * - Otherwise -> "<resultIndex + 1> / <resultCount>"; if `resultIndex < 0` for any other reason, we
 *   clamp to "0 / <resultCount>" so the UI never renders a negative position.
 */
export function formatFindStatus(input: FindStatusInput): string {
  if (input.query.length === 0) {
    return "";
  }
  if (input.resultCount === 0) {
    return "no matches";
  }
  if (input.resultIndex === -1) {
    return "many matches";
  }
  const position = input.resultIndex < 0 ? 0 : input.resultIndex + 1;
  return `${position} / ${input.resultCount}`;
}

/**
 * Build the `ISearchOptions` payload passed to `SearchAddon.findNext` / `findPrevious`.
 * Decorations live at the call site because they are static per surface and don't belong
 * in the pure flag projection.
 */
export function buildFindOptions(flags: FindOptionFlags): FindSearchOptions {
  const options: FindSearchOptions = {};
  if (flags.caseSensitive) {
    options.caseSensitive = true;
  }
  if (flags.wholeWord) {
    options.wholeWord = true;
  }
  if (flags.regex) {
    options.regex = true;
  }
  return options;
}
