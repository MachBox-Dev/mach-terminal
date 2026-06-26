/** Max ms before forcing a flush when rAF is throttled (WebView2 idle / background tab). */
export const PTY_OUTPUT_MAX_FLUSH_LATENCY_MS = 50;

export function shouldSkipVisibilityOutputKick(visibilityState: DocumentVisibilityState): boolean {
  return visibilityState === "hidden";
}

/**
 * When the document becomes visible again, always drain pending PTY chunks even if a
 * stale rAF handle is still registered — background throttling often leaves rAF
 * "scheduled" but never executed.
 */
export function shouldForceOutputFlushOnWake(hasPending: boolean): boolean {
  return hasPending;
}
