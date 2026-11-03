/** Monotonic signal from the app shell to the focused terminal surface (palette, etc.). */
export type TerminalUiRequestInput =
  | { kind: "openFind" }
  | { kind: "scrollToBottom" }
  | { kind: "scrollPage"; direction: "up" | "down" }
  | { kind: "findNext" }
  | { kind: "findPrevious" }
  | { kind: "clearViewport" }
  | { kind: "toggleFollowOutput" }
  /** Search scrollback for `query` (typically first line of a run); best-effort jump. */
  | { kind: "jumpSearch"; query: string };

export type TerminalUiRequest = TerminalUiRequestInput & { seq: number };
