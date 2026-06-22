import type { CSSProperties, ReactNode } from "react";
import { TerminalSurface } from "./TerminalSurface";
import { SplitResizeHandle } from "./SplitResizeHandle";
import type { SessionCwdMap } from "../core/sessionCwd";
import type { SessionExitedInfo } from "../core/sessionLifecycle";
import type {
  PtySessionInfo,
  SessionStatus,
} from "../core/terminal";
import type { TerminalUiRequest } from "../core/terminalUiRequest";
import type { UiSurfaceState, UiSurfaceStatePatch } from "../core/uiSurfaceState";
import type { SessionInputMode } from "../core/inputMode";
import { defaultSessionInputMode } from "../core/inputMode";
import type { ComposerSubmitKind } from "../core/composerAiIntent";
import type { SessionCommandFailure } from "../core/sessionCommandOutcome";
import type { GroupLayoutSnapshot } from "../state/workspace";
import { isPaneLeaf, isSplitBranch, type SplitNode } from "../state/splitTree";

interface PaneLayoutProps {
  layout: GroupLayoutSnapshot;
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
  /** When true, per-pane composers are hidden (group composer handles input). */
  groupComposerActive?: boolean;
  onAskAiSelection?: (sessionId: string, attachment: import("../core/aiChatState").AiContextAttachment) => void;
  onInput: (sessionId: string, data: string) => void;
  onResize: (sessionId: string, cols: number, rows: number) => void;
  onFocusPane: (paneId: string) => void;
  onUiSurfaceStateChange?: (sessionId: string, patch: UiSurfaceStatePatch) => void;
  onRequestRestartSession: (paneId: string) => void;
  onRequestCloseSession: (paneId: string) => void;
  onSplitRatioChange?: (branchId: string, ratio: number) => void;
  onResizeDragEnd?: () => void;
}

export function PaneLayout({
  layout,
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
  groupComposerActive = false,
  onAskAiSelection,
  onInput,
  onResize,
  onFocusPane,
  onUiSurfaceStateChange,
  onRequestRestartSession,
  onRequestCloseSession,
  onSplitRatioChange,
  onResizeDragEnd,
}: PaneLayoutProps) {
  const paneCount = layout.panes.length;
  const rootClass = paneCount > 1 ? "split-tree-root" : "split-single";

  const renderPane = (paneId: string, sessionId: string | null): ReactNode => {
    const session = sessionId ? sessionsById[sessionId] : undefined;
    const buffer = session ? sessionBuffers[session.id] ?? "" : "";
    const status = session ? sessionStatuses[session.id] ?? session.status : "idle";
    const message = session ? sessionMessages[session.id] : undefined;
    const exitedInfo = session ? sessionExited[session.id] ?? null : null;
    const liveCwd = session ? sessionCwd[session.id] ?? session.cwd ?? null : null;
    const inputMode = session ? (sessionInputModes[session.id] ?? defaultSessionInputMode()) : defaultSessionInputMode();
    const isFocused = layout.activePaneId === paneId;
    const isTarget = layout.targetPaneId === paneId;
    const paneIndex = layout.panes.findIndex((pane) => pane.id === paneId) + 1;
    const shellLabel = session?.shell?.split(/[/\\]/).pop() ?? "empty";
    const showPerPaneComposer = !groupComposerActive;
    const paneClasses = [
      "split-pane",
      isFocused ? "focused" : "",
      isTarget ? "target-pane" : "",
      layout.broadcastMode ? "broadcast-active" : "",
    ]
      .filter(Boolean)
      .join(" ");

    return (
      <div
        key={paneId}
        className={paneClasses}
        onPointerDown={(event) => {
          if (event.button !== 0) {
            return;
          }
          onFocusPane(paneId);
        }}
      >
        {paneCount > 1 ? (
          <div className="split-pane-chrome" aria-label={`Pane ${paneIndex}`}>
            <span className="split-pane-chrome-title">
              <span className="split-pane-chrome-index">{paneIndex}</span>
              <span className="split-pane-chrome-shell">{shellLabel}</span>
            </span>
            <span className="split-pane-chrome-badges">
              {isFocused ? <span className="split-pane-badge split-pane-badge-focus">Focus</span> : null}
              {isTarget ? <span className="split-pane-badge split-pane-badge-target">Target</span> : null}
            </span>
          </div>
        ) : null}
        <div className="split-pane-body">
        <TerminalSurface
          activeSession={session}
          activeBuffer={buffer}
          activeStatus={status}
          activeMessage={message}
          exitedInfo={exitedInfo}
          liveCwd={liveCwd}
          isFocused={isFocused}
          inputMode={inputMode}
          composerSubmitKind={session ? composerSubmitKinds[session.id] ?? "command" : "command"}
          commandFailure={session ? sessionCommandFailures[session.id] ?? null : null}
          terminalFontSize={terminalFontSize}
          terminalUiRequest={terminalUiRequest}
          showComposerAssistMetrics={showComposerAssistMetrics}
          osc133Hint={session ? sessionOsc133Hints[session.id] ?? null : null}
          uiSurfaceState={session ? sessionUiSurface[session.id] : undefined}
          aiAssistEnabled={aiAssistEnabled}
          showComposer={showPerPaneComposer}
          onAskAiSelection={
            session && onAskAiSelection ? (attachment) => onAskAiSelection(session.id, attachment) : undefined
          }
          onInput={onInput}
          onResize={onResize}
          onUiSurfaceStateChange={onUiSurfaceStateChange}
          onRequestRestartSession={() => onRequestRestartSession(paneId)}
          onRequestCloseSession={() => onRequestCloseSession(paneId)}
        />
        </div>
      </div>
    );
  };

  const renderNode = (node: SplitNode): ReactNode => {
    if (isPaneLeaf(node)) {
      return renderPane(node.id, node.sessionId);
    }
    if (!isSplitBranch(node)) {
      return null;
    }
    const ratio = node.ratio;
    const trackStyle: CSSProperties =
      node.direction === "column"
        ? {
            display: "grid",
            gridTemplateColumns: `${ratio}fr auto ${1 - ratio}fr`,
            gridTemplateRows: "minmax(0, 1fr)",
            minHeight: 0,
            height: "100%",
          }
        : {
            display: "grid",
            gridTemplateRows: `${ratio}fr auto ${1 - ratio}fr`,
            gridTemplateColumns: "minmax(0, 1fr)",
            minHeight: 0,
            height: "100%",
          };

    return (
      <div key={node.id} className={`split-branch split-branch-${node.direction}`} style={trackStyle}>
        <div className="split-branch-child">{renderNode(node.first)}</div>
        <SplitResizeHandle
          direction={node.direction}
          ratio={ratio}
          onRatioChange={(next) => onSplitRatioChange?.(node.id, next)}
          onDragEnd={onResizeDragEnd}
        />
        <div className="split-branch-child">{renderNode(node.second)}</div>
      </div>
    );
  };

  return <div className={rootClass}>{renderNode(layout.layout)}</div>;
}
