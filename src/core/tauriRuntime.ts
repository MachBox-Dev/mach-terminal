/** True when the bundle is running inside the Tauri webview (not Vite-in-browser). */
export function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}
