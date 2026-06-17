interface AiInsightPanelProps {
  text: string | null;
  inFlight: boolean;
  statusLine: string | null;
  onDismiss: () => void;
  onOpenSettings?: () => void;
  /** When true, show the panel shell even before a response arrives (AI input mode). */
  showWhenIdle?: boolean;
}

export function AiInsightPanel({
  text,
  inFlight,
  statusLine,
  onDismiss,
  onOpenSettings,
  showWhenIdle = false,
}: AiInsightPanelProps) {
  if (!showWhenIdle && !inFlight && !text?.trim()) {
    return null;
  }

  return (
    <aside
      className={`ai-insight-panel${inFlight ? " ai-insight-loading" : ""}`}
      aria-live="polite"
      aria-label="AI response"
    >
      <div className="ai-insight-panel-header">
        <p className="ai-insight-panel-title">AI</p>
        <div className="ai-insight-panel-actions">
          {text ? (
            <button
              type="button"
              className="inline-btn ghost"
              onClick={() => void navigator.clipboard.writeText(text)}
            >
              Copy
            </button>
          ) : null}
          {onOpenSettings ? (
            <button type="button" className="inline-btn ghost" onClick={onOpenSettings}>
              Settings
            </button>
          ) : null}
          <button type="button" className="inline-btn ghost" onClick={onDismiss}>
            Dismiss
          </button>
        </div>
      </div>
      {text ? <pre className="ai-insight-panel-body">{text}</pre> : null}
      {!text && showWhenIdle && !inFlight ? (
        <p className="ai-insight-panel-idle">
          Prefix with <code>?</code> for AI-only questions, or run shell commands — everything stays in this session
          tape and history.
        </p>
      ) : null}
      {inFlight ? <p className="ai-insight-panel-status">{statusLine ?? "Working…"}</p> : null}
      {!inFlight && statusLine ? <p className="ai-insight-panel-status">{statusLine}</p> : null}
    </aside>
  );
}
