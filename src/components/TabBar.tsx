import type { SessionExitedInfo } from "../core/sessionLifecycle";
import { buildTabTooltip, isExitedTab } from "../core/sessionTabStatus";
import type { PtySessionInfo, SessionStatus } from "../core/terminal";

interface TabBarProps {
  sessions: PtySessionInfo[];
  sessionStatus: Record<string, SessionStatus>;
  sessionExited: Record<string, SessionExitedInfo>;
  activeSessionId: string | null;
  onSelect: (sessionId: string) => void;
  onCreate: () => void;
  onClose: (sessionId: string) => void;
  onRestartSession: (sessionId: string) => void;
}

export function TabBar({
  sessions,
  sessionStatus,
  sessionExited,
  activeSessionId,
  onSelect,
  onCreate,
  onClose,
  onRestartSession,
}: TabBarProps) {
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
        return (
          <button
            key={session.id}
            type="button"
            className={`tab-btn ${activeSessionId === session.id ? "active" : ""} ${isExited ? "dead" : ""}`}
            onClick={() => onSelect(session.id)}
            title={tooltip}
            aria-label={tooltip}
          >
            <span className={`tab-dot status-${status}`} aria-hidden="true" />
            {session.id}
            <span>{session.shell}</span>
            <small>{status}</small>
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
