import type { SessionExitedInfo, TerminalSessionStatus } from "./sessionLifecycle";

export interface ExitSummaryInput {
  status: TerminalSessionStatus;
  message: string | null;
  exitCode: number | null;
}

export interface ExitSummaryLines {
  /** Short headline rendered inside the overlay card (already title-cased via CSS). */
  headline: string;
  /** Detail paragraph with either the backend message or a status-specific fallback. */
  detail: string;
  /** "Exited with code <n>" when the backend reported one, otherwise `null`. */
  codeLine: string | null;
}

/**
 * Default detail wording when the backend lifecycle `message` is absent or whitespace.
 * Deliberately concrete so the overlay is never empty-voiced.
 */
function defaultDetailFor(status: TerminalSessionStatus): string {
  switch (status) {
    case "stopped":
      return "Shell exited.";
    case "closed":
      return "Session closed.";
    case "error":
      return "Shell reader hit an error.";
  }
}

/**
 * Pure formatter for the exit overlay. Keeping this outside the React tree lets us
 * unit-test every status x message x exitCode combination without JSDOM. The overlay
 * renders `codeLine` only when non-null so `closed` / `error` paths stay visually
 * identical to the pre-tranche-12 behavior until a future tranche wires them up too.
 */
export function formatExitSummary(input: ExitSummaryInput): ExitSummaryLines {
  const trimmed = input.message?.trim() ?? "";
  const detail = trimmed.length > 0 ? trimmed : defaultDetailFor(input.status);
  const codeLine = input.exitCode !== null ? `Exited with code ${input.exitCode}` : null;
  return {
    headline: `Session ${input.status}`,
    detail,
    codeLine,
  };
}

/**
 * Narrow adapter so call sites can pass the stored `SessionExitedInfo` directly instead
 * of destructuring at every overlay render.
 */
export function summarizeExitedInfo(info: SessionExitedInfo): ExitSummaryLines {
  return formatExitSummary({
    status: info.status,
    message: info.message,
    exitCode: info.exitCode,
  });
}
