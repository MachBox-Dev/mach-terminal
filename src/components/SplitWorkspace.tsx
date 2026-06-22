import { PaneLayout } from "./PaneLayout";
import type { SessionCwdMap } from "../core/sessionCwd";
import type { SessionExitedInfo } from "../core/sessionLifecycle";
import type { PtySessionInfo, SessionStatus } from "../core/terminal";
import type { TerminalUiRequest } from "../core/terminalUiRequest";
import type { UiSurfaceState, UiSurfaceStatePatch } from "../core/uiSurfaceState";
import type { SessionInputMode } from "../core/inputMode";
import type { ComposerSubmitKind } from "../core/composerAiIntent";
import type { SessionCommandFailure } from "../core/sessionCommandOutcome";
import type { GroupLayoutSnapshot } from "../state/workspace";
import { findPane } from "../state/splitTree";

interface SplitWorkspaceProps {
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

export function SplitWorkspace(props: SplitWorkspaceProps) {
  return <PaneLayout {...props} />;
}

export function sessionIdForPane(layout: GroupLayoutSnapshot, paneId: string): string | null {
  const leaf = findPane(layout.layout, paneId);
  return leaf?.sessionId ?? null;
}
