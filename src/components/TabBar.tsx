import { useEffect, useRef, useState } from "react";
import type { SessionExitedInfo } from "../core/sessionLifecycle";
import { buildTabTooltip, isExitedTab, tabShortLabel } from "../core/sessionTabStatus";
import type { PtySessionInfo, SessionStatus } from "../core/terminal";

interface TabBarProps {
  sessions: PtySessionInfo[];
  sessionStatus: Record<string, SessionStatus>;
  sessionExited: Record<string, SessionExitedInfo>;
  activeSessionId: string | null;
  /** Display label per session id (custom name or numbered shell default). */
  tabLabels: Record<string, string>;
  onSelect: (sessionId: string) => void;
  onCreate: () => void;
  onClose: (sessionId: string) => void;
  onRestartSession: (sessionId: string) => void;
  /** Set (non-empty) or clear (empty/whitespace) a tab's custom name. */
  onRename: (sessionId: string, name: string) => void;
}

export function TabBar({
  sessions,
  sessionStatus,
  sessionExited,
  activeSessionId,
  tabLabels = {},
  onSelect,
  onCreate,
  onClose,
  onRestartSession,
  onRename = () => {},
}: TabBarProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (editingId && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editingId]);

  // Drop edit mode if the tab being renamed disappears (closed/exited away).
  useEffect(() => {
    if (editingId && !sessions.some((session) => session.id === editingId)) {
      setEditingId(null);
    }
  }, [editingId, sessions]);

  const beginRename = (sessionId: string) => {
    const session = sessions.find((candidate) => candidate.id === sessionId);
    setDraft(tabLabels[sessionId] ?? (session ? tabShortLabel(session.shell) : ""));
    setEditingId(sessionId);
  };

  const commitRename = () => {
    if (editingId) {
      onRename(editingId, draft);
    }
    setEditingId(null);
  };

  return (
    <div className="session-tabs">
      {sessions.map((session) => {
        const status = sessionStatus[session.id] ?? session.status;
        const exited = sessionExited[session.id];
        const isExited = isExitedTab(status, exited);
        const tooltip = buildTabTooltip(
          status,
          isExited ? exited.message : null,
          isExited ? exited.exitCode : null,
        );
        const label = tabLabels[session.id] ?? tabShortLabel(session.shell);
        const isEditing = editingId === session.id;
        return (
          <button
            key={session.id}
            type="button"
            className={`tab-btn ${activeSessionId === session.id ? "active" : ""} ${isExited ? "dead" : ""}`}
            onClick={() => onSelect(session.id)}
            onDoubleClick={(event) => {
              event.stopPropagation();
              beginRename(session.id);
            }}
            title={tooltip}
            aria-label={tooltip}
          >
            <span className={`tab-dot status-${status}`} aria-hidden="true" />
            {isEditing ? (
              <input
                ref={inputRef}
                className="tab-name-input"
                value={draft}
                aria-label="Rename tab"
                onClick={(event) => event.stopPropagation()}
                onChange={(event) => setDraft(event.currentTarget.value)}
                onBlur={commitRename}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    commitRename();
                  } else if (event.key === "Escape") {
                    event.preventDefault();
                    setEditingId(null);
                  }
                }}
              />
            ) : (
              <span className="tab-name">{label}</span>
            )}
            {isExited ? (
              <span
                className="tab-restart"
                role="button"
                aria-label="Restart session"
                title="Restart this session"
                tabIndex={0}
                onClick={(event) => {
                  event.stopPropagation();
                  onRestartSession(session.id);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    event.stopPropagation();
                    onRestartSession(session.id);
                  }
                }}
              >
                {"\u21BB"}
              </span>
            ) : null}
            <span
              className="tab-close"
              onClick={(event) => {
                event.stopPropagation();
                onClose(session.id);
              }}
            >
              x
            </span>
          </button>
        );
      })}
      <button type="button" className="tab-btn create" onClick={onCreate} aria-label="New session" title="New session">
        <span aria-hidden="true">+</span>
      </button>
    </div>
  );
}
