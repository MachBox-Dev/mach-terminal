/** Persisted toggles for the Mach status strip above the composer. */

export type StatusStripSettings = {
  /** Shell executable short name (e.g. pwsh) with terminal glyph */
  showShell: boolean;
  showPath: boolean;
  showClock: boolean;
  showGit: boolean;
  showElevated: boolean;
  showMetrics: boolean;
  /** Working-tree diff summary vs HEAD (`git diff HEAD --shortstat`); runs only when toggled on. */
  showGitDiffStats: boolean;
  /** Focused-pane terminal interaction state (find/follow-output). */
  showInteractionState: boolean;
};

export const STATUS_STRIP_STORAGE_KEY = "mach-terminal.statusStrip.v1";

export const DEFAULT_STATUS_STRIP_SETTINGS: StatusStripSettings = {
  showShell: false,
  showPath: true,
  showClock: true,
  showGit: true,
  showElevated: true,
  showMetrics: false,
  showGitDiffStats: false,
  showInteractionState: false,
};

export function loadStatusStripSettings(): StatusStripSettings {
  if (typeof window === "undefined") {
    return DEFAULT_STATUS_STRIP_SETTINGS;
  }
  try {
    const raw = window.localStorage.getItem(STATUS_STRIP_STORAGE_KEY);
    if (!raw) {
      return DEFAULT_STATUS_STRIP_SETTINGS;
    }
    const parsed = JSON.parse(raw) as Partial<StatusStripSettings>;
    return { ...DEFAULT_STATUS_STRIP_SETTINGS, ...parsed };
  } catch {
    return DEFAULT_STATUS_STRIP_SETTINGS;
  }
}

export function saveStatusStripSettings(settings: StatusStripSettings): void {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.localStorage.setItem(STATUS_STRIP_STORAGE_KEY, JSON.stringify(settings));
    window.dispatchEvent(new CustomEvent("mach-terminal-status-strip-settings"));
  } catch {
    /* ignore */
  }
}
