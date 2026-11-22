import { useCallback, useEffect, useRef, useState } from "react";
import type { AiChatMessage, AiContextAttachment } from "../core/aiChatState";

export type SideRailTab = "log" | "agent" | "ai";

export const SETTINGS_SECTION_AI_PROVIDERS = "settings-section-ai-providers";

export function extractAiCommandText(content: string): string {
  const fenced = /```[^\n]*\n([\s\S]*?)```/.exec(content);
  if (fenced && fenced[1]) {
    return fenced[1].trim();
  }
  return content.trim();
}

interface AiChatPanelProps {
  messages: AiChatMessage[];
  inFlight: boolean;
  statusLine: string | null;
  pendingAttachments: AiContextAttachment[];
  onRemoveAttachment: (attachmentId: string) => void;
  onSubmitMessage: (text: string) => void;
  onInsertToComposer?: (text: string) => void;
  aiAssistEnabled?: boolean;
  onOpenSettings?: () => void;
}

export function AiChatPanel({
  messages,
  inFlight,
  statusLine,
  pendingAttachments,
  onRemoveAttachment,
  onSubmitMessage,
  onInsertToComposer,
  aiAssistEnabled = false,
  onOpenSettings,
}: AiChatPanelProps) {
  const [draft, setDraft] = useState("");
  const threadRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = threadRef.current;
    if (!el) {
      return;
    }
    el.scrollTop = el.scrollHeight;
  }, [messages, inFlight, statusLine]);

  const submitDraft = useCallback(() => {
    const trimmed = draft.trim();
    if (trimmed.length === 0 || inFlight || !aiAssistEnabled) {
      return;
    }
    onSubmitMessage(trimmed);
    setDraft("");
  }, [aiAssistEnabled, draft, inFlight, onSubmitMessage]);

  const composerDisabled = !aiAssistEnabled || inFlight;

  return (
    <div className="ai-chat-panel" aria-label="AI conversation">
      {pendingAttachments.length > 0 ? (
        <div className="ai-chat-attachments" aria-label="Pending context attachments">
          {pendingAttachments.map((attachment) => (
            <span key={attachment.id} className="ai-chat-attachment-chip" title={attachment.text}>
              <span className="ai-chat-attachment-label">{attachment.label}</span>
              <button
                type="button"
                className="ai-chat-attachment-remove"
                aria-label={`Remove ${attachment.label}`}
                onClick={() => onRemoveAttachment(attachment.id)}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      ) : null}
      <div className="ai-chat-thread" ref={threadRef}>
        {messages.length === 0 && !inFlight ? (
          <p className="ai-chat-empty">
            {aiAssistEnabled ? (
              <>
                Ask below, press <kbd>?</kbd> in the operator composer to route Enter to AI, or right-click output → Ask
                AI. Commander mode (<kbd>Ctrl</kbd>+<kbd>`</kbd>) is for tmux/vim.
              </>
            ) : (
              <>
                Enable AI in settings (opt in + configure a provider) to start a conversation.
              </>
            )}
          </p>
        ) : (
          messages.map((message) => (
            <article key={message.id} className={`ai-chat-message ai-chat-message-${message.role}`}>
              <header className="ai-chat-message-header">
                <span>{message.role === "user" ? "You" : "AI"}</span>
                <time dateTime={new Date(message.atMs).toISOString()}>
                  {new Date(message.atMs).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                </time>
              </header>
              {message.attachments && message.attachments.length > 0 ? (
                <div className="ai-chat-message-attachments">
                  {message.attachments.map((attachment) => (
                    <span key={attachment.id} className="ai-chat-attachment-chip readonly" title={attachment.text}>
                      {attachment.label}
                    </span>
                  ))}
                </div>
              ) : null}
              <pre className="ai-chat-message-body">{message.content}</pre>
              {message.role === "assistant" && message.content.trim().length > 0 ? (
                <div className="ai-chat-message-actions">
                  <button
                    type="button"
                    className="inline-btn ghost ops-rail-action-btn"
                    onClick={() => void navigator.clipboard.writeText(extractAiCommandText(message.content))}
                  >
                    Copy command
                  </button>
                  {onInsertToComposer ? (
                    <button
                      type="button"
                      className="inline-btn ghost ops-rail-action-btn"
                      onClick={() => onInsertToComposer(extractAiCommandText(message.content))}
                    >
                      Insert into composer
                    </button>
                  ) : null}
                </div>
              ) : null}
              {message.status === "error" ? <p className="ai-chat-message-error">Request failed.</p> : null}
            </article>
          ))
        )}
        {inFlight ? <p className="ai-chat-status">{statusLine ?? "Working…"}</p> : null}
        {!inFlight && statusLine && messages.length > 0 ? <p className="ai-chat-status">{statusLine}</p> : null}
      </div>
      <div className="ai-chat-composer">
        <textarea
          className="ai-chat-composer-field"
          rows={3}
          placeholder={
            aiAssistEnabled
              ? "Ask AI about this session…"
              : "Enable AI features in settings to chat"
          }
          value={draft}
          disabled={composerDisabled}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              submitDraft();
            }
          }}
          aria-label="AI message"
        />
        <div className="ai-chat-composer-actions">
          {onOpenSettings ? (
            <button type="button" className="inline-btn ghost" onClick={onOpenSettings}>
              AI settings
            </button>
          ) : null}
          <button
            type="button"
            className="inline-btn"
            disabled={composerDisabled || draft.trim().length === 0}
            onClick={submitDraft}
          >
            Send
          </button>
        </div>
      </div>
    </div>
  );
}
