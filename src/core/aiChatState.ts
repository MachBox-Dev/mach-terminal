import { trimAiContextExcerpt, type AiNotePayload } from "./terminal";

export interface AiContextAttachment {
  id: string;
  /** Short label, e.g. `lines 42–48`. */
  label: string;
  text: string;
}

export interface AiChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  attachments?: AiContextAttachment[];
  atMs: number;
  status?: "pending" | "error";
}

export type AiChatState = Record<string, AiChatMessage[]>;

export function attachmentBlockForContext(attachments: readonly AiContextAttachment[]): string {
  return attachments.map((attachment) => `[${attachment.label}]\n${attachment.text}`).join("\n\n");
}

export function createAttachmentId(): string {
  return `att-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function createChatMessageId(): string {
  return `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Shapes an incoming `machterm://ai-note` deep link (see `docs/deep-link-contract.md`)
 * into a pending AI-context attachment, matching how a terminal-selection "Ask AI"
 * attachment is built. Falls back to a generic label and trims text to the same budget
 * used elsewhere for AI context.
 */
export function attachmentFromAiNote(payload: AiNotePayload): AiContextAttachment {
  return {
    id: createAttachmentId(),
    label: payload.label?.trim() || "Armory note",
    text: trimAiContextExcerpt(payload.text) ?? payload.text,
  };
}

export function appendChatMessage(state: AiChatState, sessionId: string, message: AiChatMessage): AiChatState {
  const list = state[sessionId] ?? [];
  return { ...state, [sessionId]: [...list, message] };
}

export function updateChatMessage(
  state: AiChatState,
  sessionId: string,
  messageId: string,
  patch: Partial<AiChatMessage>,
): AiChatState {
  const list = state[sessionId];
  if (!list) {
    return state;
  }
  return {
    ...state,
    [sessionId]: list.map((message) => (message.id === messageId ? { ...message, ...patch } : message)),
  };
}

export function pruneAiChatForSessions(state: AiChatState, aliveSessionIds: readonly string[]): AiChatState {
  const alive = new Set(aliveSessionIds);
  let changed = false;
  const next: AiChatState = {};
  for (const [sid, messages] of Object.entries(state)) {
    if (alive.has(sid)) {
      next[sid] = messages;
    } else {
      changed = true;
    }
  }
  return changed ? next : state;
}

/** Build a display label for a terminal selection excerpt. */
export function formatSelectionAttachmentLabel(startLine: number, endLine: number): string {
  if (startLine === endLine) {
    return `line ${startLine}`;
  }
  return `lines ${startLine}–${endLine}`;
}

/**
 * Best-effort 1-based line numbers for a selection by scanning the active xterm buffer.
 * Returns null when the selection cannot be located.
 */
export function locateSelectionLineRange(
  bufferLineCount: number,
  readLine: (index: number) => string | undefined,
  selection: string,
): { startLine: number; endLine: number } | null {
  const needle = selection.trim();
  if (needle.length === 0 || bufferLineCount <= 0) {
    return null;
  }
  const firstLine = needle.split(/\r?\n/)[0] ?? "";
  if (firstLine.length === 0) {
    return null;
  }
  let start: number | null = null;
  let end: number | null = null;
  for (let i = 0; i < bufferLineCount; i += 1) {
    const text = readLine(i);
    if (!text || !text.includes(firstLine.slice(0, Math.min(24, firstLine.length)))) {
      continue;
    }
    if (start == null) {
      start = i + 1;
    }
    end = i + 1;
  }
  if (start == null || end == null) {
    return null;
  }
  return { startLine: start, endLine: end };
}
