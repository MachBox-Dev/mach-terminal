import { TerminalSurface } from "./TerminalSurface";
import type { SessionCwdMap } from "../core/sessionCwd";
import type { SessionExitedInfo } from "../core/sessionLifecycle";
import type { PtySessionInfo, SessionStatus } from "../core/terminal";
import type { TerminalUiRequest } from "../core/terminalUiRequest";
import type { WorkspaceState } from "../state/workspace";

interface SplitWorkspaceProps {
  workspace: WorkspaceState;
  sessionsById: Record<string, PtySessionInfo>;
  sessionBuffers: Record<string, string>;
  sessionStatuses: Record<string, SessionStatus>;
  sessionMessages: Record<string, string | undefined>;
  sessionExited: Record<string, SessionExitedInfo>;
  sessionCwd: SessionCwdMap;
  terminalFontSize?: number;
  terminalUiRequest?: TerminalUiRequest | null;
  onInput: (sessionId: string, data: string) => void;
  onResize: (sessionId: string, cols: number, rows: number) => void;
  onFocusPane: (paneId: string) => void;
  onRequestRestartSession: (paneId: string) => void;
  onRequestCloseSession: (paneId: string) => void;
}

export function SplitWorkspace({
  workspace,
  sessionsById,
  sessionBuffers,
  sessionStatuses,
  sessionMessages,
  sessionExited,
  sessionCwd,
  terminalFontSize,
  terminalUiRequest,
  onInput,
  onResize,
  onFocusPane,
  onRequestRestartSession,
  onRequestCloseSession,
}: SplitWorkspaceProps) {
  const layoutClass = workspace.panes.length > 1 ? "split-grid" : "split-single";

  return (
    <div className={layoutClass}>
      {workspace.panes.map((pane) => {
        const session = pane.sessionId ? sessionsById[pane.sessionId] : undefined;
        const buffer = session ? sessionBuffers[session.id] ?? "" : "";
        const status = session ? sessionStatuses[session.id] ?? session.status : "idle";
        const message = session ? sessionMessages[session.id] : undefined;
        const exitedInfo = session ? sessionExited[session.id] ?? null : null;
        const liveCwd = session ? sessionCwd[session.id] ?? null : null;
        return (
          <div
            key={pane.id}
            className={`split-pane ${workspace.activePaneId === pane.id ? "focused" : ""}`}
            onClick={() => onFocusPane(pane.id)}
          >
            <TerminalSurface
              activeSession={session}
              activeBuffer={buffer}
              activeStatus={status}
              activeMessage={message}
              exitedInfo={exitedInfo}
              liveCwd={liveCwd}
              isFocused={workspace.activePaneId === pane.id}
              terminalFontSize={terminalFontSize}
              terminalUiRequest={terminalUiRequest}
              onInput={onInput}
              onResize={onResize}
              onRequestRestartSession={() => onRequestRestartSession(pane.id)}
              onRequestCloseSession={() => onRequestCloseSession(pane.id)}
            />
          </div>
        );
      })}
    </div>
  );
}
