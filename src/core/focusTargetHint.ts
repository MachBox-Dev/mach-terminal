export const FOCUS_TARGET_HINT_STORAGE_KEY = "mach-terminal.focus-target-hint.v1";

function hintStorage(): Storage | null {
  if (typeof globalThis.localStorage === "undefined") {
    return null;
  }
  return globalThis.localStorage;
}

export function shouldShowFocusTargetHint(): boolean {
  const storage = hintStorage();
  if (!storage) {
    return false;
  }
  return storage.getItem(FOCUS_TARGET_HINT_STORAGE_KEY) !== "dismissed";
}

export function dismissFocusTargetHint(): void {
  hintStorage()?.setItem(FOCUS_TARGET_HINT_STORAGE_KEY, "dismissed");
}
