/**
 * Whether the composer should receive focus when the terminal pane becomes active.
 * Find bar and session-exit overlay use other focus targets.
 */
export function canFocusComposerWhenPaneActive(findOpen: boolean, composerLocked: boolean): boolean {
  return !findOpen && !composerLocked;
}
