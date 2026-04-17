import { isTerminalStatus, type SessionExitedInfo } from "./sessionLifecycle";
import type { SessionStatus } from "./terminal";

/**
 * Alias kept local so downstream components can import a single symbol for
 * status-variant work without reaching into `./terminal` for the full enum.
 */
export type TabStatusVariant = SessionStatus;

/**
 * Compose the `title` string we hang off a `.tab-btn`. Non-terminal statuses
 * get the legacy "Switch session" / "Starting session..." phrasing so hover
 * feedback on healthy tabs does not regress. Terminal statuses carry either
 * "click to focus pane" (no message) or "<status>: <message>" so hovering a
 * dead tab surfaces the exit reason without opening the pane.
 *
 * When the backend reported an exit code via `PtyLifecycleEvent.exit_code` we
 * splice a `(code <n>)` fragment between the status and the message so the
 * tooltip mirrors what the exit overlay shows in its dedicated code line.
 */
export function buildTabTooltip(
  status: SessionStatus,
  exitedMessage: string | null,
  exitCode: number | null = null,
): string {
  if (status === "starting") {
    return "Starting session...";
  }
  if (!isTerminalStatus(status)) {
    return "Switch session";
  }
  const trimmed = (exitedMessage ?? "").trim();
  const codeSuffix = exitCode !== null ? ` (code ${exitCode})` : "";
  if (trimmed.length === 0) {
    return `Session ${status}${codeSuffix} - click to focus pane`;
  }
  return `Session ${status}${codeSuffix}: ${trimmed}`;
}

/**
 * Return the session ids that are currently in the `sessionExited` map,
 * preserving the caller-provided `order`. Callers pass `sessions.map(s => s.id)`
 * so batch operations walk tabs left-to-right instead of relying on the
 * non-deterministic `Object.keys` insertion order of the exited map.
 */
export function collectExitedSessionIds(
  sessionExited: Record<string, SessionExitedInfo>,
  order: readonly string[],
): string[] {
  return order.filter((id) => Object.prototype.hasOwnProperty.call(sessionExited, id));
}

/**
 * Narrow type guard so JSX branches in TabBar can pattern-match on
 * `{ status, exited }` pairs without repeating the `isTerminalStatus`
 * check plus an `!= null` on the map lookup.
 */
export function isExitedTab(
  status: SessionStatus,
  exited: SessionExitedInfo | undefined,
): exited is SessionExitedInfo {
  return isTerminalStatus(status) && exited !== undefined;
}
