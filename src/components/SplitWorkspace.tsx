import { TerminalSurface } from "./TerminalSurface";
import type { SessionCwdMap } from "../core/sessionCwd";
import type { SessionExitedInfo } from "../core/sessionLifecycle";
import type {
  ComposerCompletionResponse,
  HistoryEntry,
  PtySessionInfo,
  SessionStatus,
} from "../core/terminal";
import type { TerminalUiRequest } from "../core/terminalUiRequest";
import type { UiSurfaceState, UiSurfaceStatePatch } from "../core/uiSurfaceState";
import type { SessionInputMode } from "../core/inputMode";
import { defaultSessionInputMode } from "../core/inputMode";
import type { ComposerSubmitKind } from "../core/composerAiIntent";
import type { SessionCommandFailure } from "../core/sessionCommandOutcome";
import type { AiContextAttachment } from "../core/aiChatState";
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
  showComposerAssistMetrics?: boolean;
  sessionOsc133Hints?: Record<string, string>;
  sessionUiSurface?: Record<string, UiSurfaceState>;
  sessionInputModes?: Record<string, SessionInputMode>;
  composerSubmitKinds?: Record<string, ComposerSubmitKind>;
  sessionCommandFailures?: Record<string, SessionCommandFailure | undefined>;
  aiAssistEnabled?: boolean;
  onComposerDraftChange?: (paneId: string, draft: string) => void;
  onToggleComposerSubmitKind?: (sessionId: string) => void;
  onAskAboutFailure?: (sessionId: string) => void;
  onAiComposerSubmit?: (sessionId: string, text: string) => void;
  onAskAiSelection?: (sessionId: string, attachment: AiContextAttachment) => void;
  onAiExplainComposer?: () => void;
  onAiFixComposer?: () => void;
  historyEntries?: HistoryEntry[];
  onRequestComposerCompletion?: (request: {
    draft: string;
    cursor: number;
    cwd?: string;
    shell?: string;
    sessionId?: string;
  }) => Promise<ComposerCompletionResponse>;
  onInput: (sessionId: string, data: string) => void;
  onResize: (sessionId: string, cols: number, rows: number) => void;
  onFocusPane: (paneId: string) => void;
  onUiSurfaceStateChange?: (sessionId: string, patch: UiSurfaceStatePatch) => void;
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
  showComposerAssistMetrics = false,
  sessionOsc133Hints = {},
  sessionUiSurface = {},
  sessionInputModes = {},
  composerSubmitKinds = {},
  sessionCommandFailures = {},
  aiAssistEnabled = false,
  onComposerDraftChange,
  onToggleComposerSubmitKind,
  onAskAboutFailure,
  onAiComposerSubmit,
  onAskAiSelection,
  onAiExplainComposer,
  onAiFixComposer,
  historyEntries = [],
  onRequestComposerCompletion,
  onInput,
  onResize,
  onFocusPane,
  onUiSurfaceStateChange,
  onRequestRestartSession,
  onRequestCloseSession,
}: SplitWorkspaceProps) {
  const layoutClass =
    workspace.panes.length > 1
      ? workspace.splitDirection === "row"
        ? "split-grid split-grid-row"
        : "split-grid split-grid-column"
      : "split-single";

  return (
    <div className={layoutClass}>
      {workspace.panes.map((pane) => {
        const session = pane.sessionId ? sessionsById[pane.sessionId] : undefined;
        const buffer = session ? sessionBuffers[session.id] ?? "" : "";
        const status = session ? sessionStatuses[session.id] ?? session.status : "idle";
        const message = session ? sessionMessages[session.id] : undefined;
        const exitedInfo = session ? sessionExited[session.id] ?? null : null;
        const liveCwd = session ? sessionCwd[session.id] ?? session.cwd ?? null : null;
        const inputMode = session ? (sessionInputModes[session.id] ?? defaultSessionInputMode()) : defaultSessionInputMode();
        const composerSubmitKind = session ? composerSubmitKinds[session.id] ?? "command" : "command";
        const commandFailure = session ? sessionCommandFailures[session.id] ?? null : null;
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
              inputMode={inputMode}
              composerSubmitKind={composerSubmitKind}
              onToggleComposerSubmitKind={
                session && onToggleComposerSubmitKind ? () => onToggleComposerSubmitKind(session.id) : undefined
              }
              commandFailure={commandFailure}
              onAskAboutFailure={
                session && onAskAboutFailure ? () => onAskAboutFailure(session.id) : undefined
              }
              onAiComposerSubmit={
                session && onAiComposerSubmit ? (text) => onAiComposerSubmit(session.id, text) : undefined
              }
              onAskAiSelection={
                session && onAskAiSelection ? (attachment) => onAskAiSelection(session.id, attachment) : undefined
              }
              terminalFontSize={terminalFontSize}
              terminalUiRequest={terminalUiRequest}
              showComposerAssistMetrics={showComposerAssistMetrics}
              osc133Hint={session ? sessionOsc133Hints[session.id] ?? null : null}
              uiSurfaceState={session ? sessionUiSurface[session.id] : undefined}
              aiAssistEnabled={aiAssistEnabled}
              onComposerDraftChange={
                onComposerDraftChange ? (draft) => onComposerDraftChange(pane.id, draft) : undefined
              }
              onAiExplainComposer={onAiExplainComposer}
              onAiFixComposer={onAiFixComposer}
              historyEntries={historyEntries}
              onRequestComposerCompletion={onRequestComposerCompletion}
              onInput={onInput}
              onResize={onResize}
              onUiSurfaceStateChange={onUiSurfaceStateChange}
              onRequestRestartSession={() => onRequestRestartSession(pane.id)}
              onRequestCloseSession={() => onRequestCloseSession(pane.id)}
            />
          </div>
        );
      })}
    </div>
  );
}
