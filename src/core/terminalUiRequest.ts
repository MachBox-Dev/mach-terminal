/** Monotonic signal from the app shell to the focused terminal surface (palette, etc.). */
export type TerminalUiRequest =
  | { seq: number; kind: "openFind" }
  | { seq: number; kind: "scrollToBottom" }
  | { seq: number; kind: "findNext" }
  | { seq: number; kind: "findPrevious" }
  | { seq: number; kind: "clearViewport" }
  | { seq: number; kind: "toggleFollowOutput" };
