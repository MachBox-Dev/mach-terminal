export type PasteRiskLevel = "safe" | "confirm";

export interface PasteRiskResult {
  level: PasteRiskLevel;
  reasons: string[];
}

export interface PastePayloadSummary {
  /** Control-character-sanitized preview; may be truncated. */
  previewText: string;
  /** Physical line count of the raw text (split on `\r?\n`). */
  lineCount: number;
  /** Raw `String.length` of the original text. */
  charCount: number;
  /** True when `previewText` is shorter than the raw text (after sanitization). */
  truncated: boolean;
}

export interface PendingPasteState {
  text: string;
  reasons: string[];
  summary: PastePayloadSummary;
}

export type PasteDecision =
  | { kind: "send" }
  | { kind: "confirm"; risk: PasteRiskResult };

export interface PasteDecisionInput {
  text: string;
  bypassForSession: boolean;
}

const LONG_PASTE_THRESHOLD = 500;
const CHAIN_MARKER_RE = /(?:&&|\|\||;|\|)/;
const DEFAULT_PREVIEW_LIMIT = 120;
// Strip C0 control chars except TAB (09) / LF (0A) / CR (0D), plus DEL (7F).
const CONTROL_CHAR_RE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

export function classifyPasteRisk(text: string): PasteRiskResult {
  const reasons: string[] = [];
  if (text.includes("\n")) {
    reasons.push("Contains multiple lines");
  }
  if (text.length > LONG_PASTE_THRESHOLD) {
    reasons.push(`Large paste (${text.length} chars)`);
  }
  if (CHAIN_MARKER_RE.test(text)) {
    reasons.push("Contains shell chaining operators");
  }
  return {
    level: reasons.length > 0 ? "confirm" : "safe",
    reasons,
  };
}

export function summarizePastePayload(
  text: string,
  maxPreview: number = DEFAULT_PREVIEW_LIMIT,
): PastePayloadSummary {
  const charCount = text.length;
  const lineCount = text.length === 0 ? 0 : text.split(/\r?\n/).length;
  const sanitized = text.replace(CONTROL_CHAR_RE, "");
  const limit = Math.max(1, maxPreview);
  const truncated = sanitized.length > limit;
  const previewText = truncated ? `${sanitized.slice(0, limit)}...` : sanitized;
  return { previewText, lineCount, charCount, truncated };
}

export function decidePasteAction(input: PasteDecisionInput): PasteDecision {
  if (input.bypassForSession) {
    return { kind: "send" };
  }
  const risk = classifyPasteRisk(input.text);
  if (risk.level === "safe") {
    return { kind: "send" };
  }
  return { kind: "confirm", risk };
}

export function createPendingPasteState(
  text: string,
  bypassForSession: boolean,
): PendingPasteState | null {
  const decision = decidePasteAction({ text, bypassForSession });
  if (decision.kind === "send") {
    return null;
  }
  return {
    text,
    reasons: decision.risk.reasons,
    summary: summarizePastePayload(text),
  };
}

export function pendingPasteGuardActionForKey(key: string): "confirm" | "cancel" | null {
  if (key === "Enter") {
    return "confirm";
  }
  if (key === "Escape") {
    return "cancel";
  }
  return null;
}

export interface PendingPasteResolution {
  sendText: string | null;
  nextPending: PendingPasteState | null;
}

export function resolvePendingPasteAction(
  pending: PendingPasteState | null,
  action: "confirm" | "cancel",
): PendingPasteResolution {
  if (!pending) {
    return { sendText: null, nextPending: null };
  }
  if (action === "confirm") {
    return {
      sendText: pending.text,
      nextPending: null,
    };
  }
  return {
    sendText: null,
    nextPending: null,
  };
}
