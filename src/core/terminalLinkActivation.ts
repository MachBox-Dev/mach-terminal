import { isSafeHttpUrlForOpener, isSafeLocalPathForOpener } from "./terminalLinkRanges";

/**
 * Shared activation policy for terminal hyperlinks surfaced by xterm — both
 * the heuristic HTTP/filesystem scraping in {@link ./terminalLinkRanges} and
 * structured OSC 8 hyperlinks emitted by the shell. Centralizing the decision
 * keeps the security posture consistent: a single allowlist of protocols, a
 * single path sanity check, and a single place to extend when new schemes are
 * supported.
 *
 * The helper is intentionally dependency-light so it is trivial to unit test.
 * The opener wiring is injected by the caller (the xterm surface passes
 * `openUrl`/`openPath` from `@tauri-apps/plugin-opener`); tests supply stubs.
 */

export type TerminalLinkActivationKind = "http" | "file" | "rejected";

export interface TerminalLinkActivationResult {
  kind: TerminalLinkActivationKind;
  /** Canonicalized target handed to the opener (HTTP URL or filesystem path). */
  target?: string;
  /** Human-readable reason when `kind === "rejected"` for logs/tests. */
  reason?: string;
}

export interface TerminalLinkOpeners {
  /** Opens `http:` / `https:` URLs in the OS default browser. */
  openUrl: (url: string) => Promise<unknown> | unknown;
  /** Opens a local filesystem path in the OS default handler. */
  openPath: (path: string) => Promise<unknown> | unknown;
}

function decodeFileUri(uri: string): string | null {
  // file://host/path  OR  file:///C:/... / file:///etc/...
  const match = /^file:\/\/([^/]*)(\/.*)$/u.exec(uri);
  if (!match) {
    return null;
  }
  const host = match[1];
  let path = match[2];
  // Reject remote hosts in file:// — these should not round-trip through
  // the local opener. Empty host and `localhost` are both "this machine".
  if (host && host.toLowerCase() !== "localhost") {
    return null;
  }
  try {
    path = decodeURIComponent(path);
  } catch {
    return null;
  }
  // Windows drive-letter forms arrive as `/C:/...`; strip the leading slash
  // before the drive letter and normalize separators for `openPath`.
  const winDrive = /^\/([A-Za-z]):(\/.*)?$/u.exec(path);
  if (winDrive) {
    const drive = winDrive[1];
    const rest = winDrive[2] ?? "/";
    path = `${drive}:${rest}`.replace(/\//g, "\\");
  }
  return path;
}

/**
 * Decide how to activate a terminal hyperlink. Does NOT invoke any opener by
 * itself; the returned {@link TerminalLinkActivationResult.kind} tells the
 * caller which opener to route to, and {@link activateTerminalLink} wires
 * that up for callers that already hold opener refs.
 */
export function resolveTerminalLinkActivation(uri: string): TerminalLinkActivationResult {
  if (!uri || typeof uri !== "string") {
    return { kind: "rejected", reason: "empty uri" };
  }
  if (uri.startsWith("http://") || uri.startsWith("https://")) {
    return isSafeHttpUrlForOpener(uri)
      ? { kind: "http", target: uri }
      : { kind: "rejected", reason: "unsafe http url" };
  }
  if (uri.startsWith("file://")) {
    const decoded = decodeFileUri(uri);
    if (!decoded) {
      return { kind: "rejected", reason: "malformed or remote file uri" };
    }
    if (!isSafeLocalPathForOpener(decoded)) {
      return { kind: "rejected", reason: "unsafe local path" };
    }
    return { kind: "file", target: decoded };
  }
  return { kind: "rejected", reason: "unsupported scheme" };
}

/**
 * Activate an OSC 8 / custom-provider hyperlink using the provided openers.
 * Rejected links silently no-op so opener misfires cannot toast-spam the UI.
 */
export function activateTerminalLink(
  uri: string,
  openers: TerminalLinkOpeners,
): TerminalLinkActivationResult {
  const decision = resolveTerminalLinkActivation(uri);
  if (decision.kind === "http" && decision.target) {
    try {
      const maybe = openers.openUrl(decision.target);
      if (maybe && typeof (maybe as Promise<unknown>).then === "function") {
        void (maybe as Promise<unknown>).catch(() => {
          /* opener failures are non-fatal */
        });
      }
    } catch {
      /* opener failures are non-fatal */
    }
    return decision;
  }
  if (decision.kind === "file" && decision.target) {
    try {
      const maybe = openers.openPath(decision.target);
      if (maybe && typeof (maybe as Promise<unknown>).then === "function") {
        void (maybe as Promise<unknown>).catch(() => {
          /* opener failures are non-fatal */
        });
      }
    } catch {
      /* opener failures are non-fatal */
    }
    return decision;
  }
  return decision;
}
