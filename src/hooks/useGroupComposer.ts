import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ComposerCompletionResponse, HistoryEntry, PtySessionInfo } from "../core/terminal";
import {
  applyCompletionCandidate,
  completionRequestKey,
  createComposerCompletionState,
  hasCompletionCandidates,
  nextCompletionIndex,
} from "../core/composerCompletion";
import {
  canAcceptPrediction,
  createComposerHistoryState,
  nextHistoryDraft,
  predictionForDraft,
  type ComposerHistoryDirection,
} from "../core/composerHistory";
import { isShellExitCommand } from "../core/shellExitCommand";
import { composerOutputScrollIntentFromKeyboardEvent } from "../core/composerOutputScroll";
import {
  composerPlaceholderForMode,
  inputModeUsesComposer,
  type SessionInputMode,
} from "../core/inputMode";
import {
  isComposerAiToggleKey,
  type ComposerSubmitKind,
} from "../core/composerAiIntent";
import type { SessionCommandFailure } from "../core/sessionCommandOutcome";
import { isAskFailureShortcut } from "../core/sessionCommandOutcome";
import type { PaneNode } from "../state/workspace";
import { defaultSessionInputMode } from "../core/inputMode";

const COMPOSER_HISTORY_WINDOW = 250;

export interface PanePill {
  index: number;
  paneId: string;
  sessionId: string | null;
  label: string;
  isActive: boolean;
  isTarget: boolean;
}

export interface UseGroupComposerOptions {
  groupId: string;
  panes: PaneNode[];
  activePaneId: string;
  targetPaneId: string;
  broadcastMode: boolean;
  sessionsById: Record<string, PtySessionInfo>;
  tabLabels: Record<string, string>;
  sessionInputModes: Record<string, SessionInputMode>;
  composerSubmitKinds: Record<string, ComposerSubmitKind>;
  commandFailure?: SessionCommandFailure | null;
  historyEntries: HistoryEntry[];
  aiAssistEnabled: boolean;
  onComposerDraftChange?: (draft: string) => void;
  onToggleComposerSubmitKind?: (sessionId: string) => void;
  onAskAboutFailure?: (sessionId: string) => void;
  onAiComposerSubmit?: (sessionId: string, text: string) => void;
  onSubmitToPty: (sessionIds: string[], payload: string) => void;
  /** Composer submitted exit/logout — close the live target pane (not the focused pane). */
  onShellExitSubmitted?: () => void;
  /** Broadcast exit — close every pane that received the command. */
  onShellExitBroadcast?: (sessionIds: string[]) => void;
  onRequestComposerCompletion?: (request: {
    draft: string;
    cursor: number;
    cwd?: string;
    shell?: string;
    sessionId?: string;
  }) => Promise<ComposerCompletionResponse>;
  onBroadcastConsumed?: () => void;
}

export function useGroupComposer({
  groupId,
  panes,
  activePaneId,
  targetPaneId,
  broadcastMode,
  sessionsById,
  tabLabels,
  sessionInputModes,
  composerSubmitKinds,
  commandFailure = null,
  historyEntries,
  aiAssistEnabled,
  onComposerDraftChange,
  onToggleComposerSubmitKind,
  onAskAboutFailure,
  onAiComposerSubmit,
  onSubmitToPty,
  onShellExitSubmitted,
  onShellExitBroadcast,
  onRequestComposerCompletion,
  onBroadcastConsumed,
}: UseGroupComposerOptions) {
  const draftsRef = useRef<Record<string, string>>({});
  const [composerDraft, setComposerDraft] = useState("");
  const composerTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const completionRequestSeqRef = useRef(0);
  const completionStateRef = useRef(createComposerCompletionState());
  const historyStateRef = useRef(createComposerHistoryState());
  const [completionState, setCompletionState] = useState(createComposerCompletionState);
  const [prediction, setPrediction] = useState<string | null>(null);
  const completionMetricsRef = useRef({ requests: 0, accepted: 0, totalLatencyMs: 0 });
  const [completionMetricsTick, setCompletionMetricsTick] = useState(0);

  const targetPane = panes.find((pane) => pane.id === targetPaneId) ?? panes.find((pane) => pane.id === activePaneId);
  const targetSessionId = targetPane?.sessionId ?? null;
  const targetSession = targetSessionId ? sessionsById[targetSessionId] : undefined;
  const inputMode = targetSessionId
    ? (sessionInputModes[targetSessionId] ?? defaultSessionInputMode())
    : defaultSessionInputMode();
  const composerSubmitKind = targetSessionId ? (composerSubmitKinds[targetSessionId] ?? "command") : "command";
  const composerLocked = !targetSession || inputMode !== "operator";
  const boundedHistoryEntries = useMemo(
    () => historyEntries.slice(0, COMPOSER_HISTORY_WINDOW),
    [historyEntries],
  );

  useEffect(() => {
    draftsRef.current[groupId] = composerDraft;
    onComposerDraftChange?.(composerDraft);
  }, [composerDraft, groupId, onComposerDraftChange]);

  useEffect(() => {
    const saved = draftsRef.current[groupId];
    setComposerDraft(saved ?? "");
    historyStateRef.current = createComposerHistoryState();
    setCompletionState(createComposerCompletionState());
  }, [groupId]);

  useEffect(() => {
    completionStateRef.current = completionState;
  }, [completionState]);

  useEffect(() => {
    setPrediction(predictionForDraft(composerDraft, boundedHistoryEntries));
  }, [boundedHistoryEntries, composerDraft]);

  const resetCompletionState = useCallback((error: string | null = null) => {
    setCompletionState({
      response: null,
      selectedIndex: -1,
      requestKey: null,
      error,
    });
  }, []);

  const focusComposerInput = useCallback(() => {
    if (composerLocked) {
      return;
    }
    queueMicrotask(() => composerTextareaRef.current?.focus());
  }, [composerLocked]);

  const resolveSubmitSessionIds = useCallback((): string[] => {
    if (broadcastMode) {
      const ids: string[] = [];
      for (const pane of panes) {
        if (!pane.sessionId) {
          continue;
        }
        const mode = sessionInputModes[pane.sessionId] ?? defaultSessionInputMode();
        if (mode !== "operator") {
          continue;
        }
        if (!ids.includes(pane.sessionId)) {
          ids.push(pane.sessionId);
        }
      }
      return ids;
    }
    return targetSessionId ? [targetSessionId] : [];
  }, [broadcastMode, panes, sessionInputModes, targetSessionId]);

  const submitComposer = useCallback(() => {
    const normalized = composerDraft.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    if (!normalized.trim()) {
      return;
    }
    const sessionIds = resolveSubmitSessionIds();
    if (sessionIds.length === 0) {
      return;
    }
    if (composerSubmitKind === "ai" && sessionIds.length === 1) {
      onAiComposerSubmit?.(sessionIds[0], normalized.trim());
    } else if (composerSubmitKind !== "ai") {
      const payload = `${normalized.replace(/\n/g, "\r\n")}\r`;
      onSubmitToPty(sessionIds, payload);
      if (isShellExitCommand(normalized.trim())) {
        if (broadcastMode) {
          onShellExitBroadcast?.(sessionIds);
        } else {
          onShellExitSubmitted?.();
        }
      }
    }
    setComposerDraft("");
    historyStateRef.current = createComposerHistoryState();
    resetCompletionState(null);
    if (broadcastMode) {
      onBroadcastConsumed?.();
    }
    queueMicrotask(() => composerTextareaRef.current?.focus());
  }, [
    broadcastMode,
    composerDraft,
    composerSubmitKind,
    onAiComposerSubmit,
    onBroadcastConsumed,
    onSubmitToPty,
    onShellExitSubmitted,
    onShellExitBroadcast,
    resetCompletionState,
    resolveSubmitSessionIds,
  ]);

  const requestComposerCompletion = useCallback(async (): Promise<boolean> => {
    if (!onRequestComposerCompletion || composerLocked || !targetSessionId) {
      return false;
    }
    const textarea = composerTextareaRef.current;
    const cursor = textarea?.selectionStart ?? composerDraft.length;
    const requestKey = completionRequestKey(composerDraft, cursor);
    const seq = ++completionRequestSeqRef.current;
    const started = performance.now();
    try {
      const response = await onRequestComposerCompletion({
        draft: composerDraft,
        cursor,
        cwd: targetSession?.cwd,
        shell: targetSession?.shell,
        sessionId: targetSessionId,
      });
      if (seq !== completionRequestSeqRef.current) {
        return false;
      }
      completionMetricsRef.current.requests += 1;
      completionMetricsRef.current.totalLatencyMs += performance.now() - started;
      setCompletionMetricsTick((tick) => tick + 1);
      const applied = applyCompletionCandidate(composerDraft, response, 0);
      if (!applied) {
        resetCompletionState(null);
        return false;
      }
      setComposerDraft(applied.draft);
      setCompletionState({
        response,
        selectedIndex: 0,
        requestKey,
        error: null,
      });
      if (composerTextareaRef.current) {
        composerTextareaRef.current.selectionStart = applied.cursor;
        composerTextareaRef.current.selectionEnd = applied.cursor;
      }
      return true;
    } catch (error) {
      if (seq !== completionRequestSeqRef.current) {
        return false;
      }
      resetCompletionState(error instanceof Error ? error.message : "Completion failed.");
      return false;
    }
  }, [composerDraft, composerLocked, onRequestComposerCompletion, resetCompletionState, targetSession, targetSessionId]);

  const cycleComposerCompletion = useCallback((): boolean => {
    const current = completionStateRef.current;
    if (!current.response || !hasCompletionCandidates(current.response)) {
      return false;
    }
    const nextIndex = nextCompletionIndex(current.response, current.selectedIndex);
    const applied = applyCompletionCandidate(composerDraft, current.response, nextIndex);
    if (!applied) {
      return false;
    }
    setComposerDraft(applied.draft);
    setCompletionState({ ...current, selectedIndex: nextIndex });
    if (composerTextareaRef.current) {
      composerTextareaRef.current.selectionStart = applied.cursor;
      composerTextareaRef.current.selectionEnd = applied.cursor;
    }
    return true;
  }, [composerDraft]);

  const stepComposerHistory = useCallback(
    (direction: ComposerHistoryDirection) => {
      if (composerLocked) {
        return;
      }
      const next = nextHistoryDraft(historyStateRef.current, boundedHistoryEntries, composerDraft, direction);
      historyStateRef.current = next.state;
      setComposerDraft(next.draft ?? "");
      resetCompletionState(null);
      queueMicrotask(() => {
        const ta = composerTextareaRef.current;
        const draftLen = (next.draft ?? "").length;
        if (ta) {
          ta.selectionStart = draftLen;
          ta.selectionEnd = draftLen;
        }
      });
    },
    [boundedHistoryEntries, composerDraft, composerLocked, resetCompletionState],
  );

  const panePills: PanePill[] = useMemo(
    () =>
      panes.map((pane, index) => ({
        index: index + 1,
        paneId: pane.id,
        sessionId: pane.sessionId,
        label: pane.sessionId ? (tabLabels[pane.sessionId] ?? "shell") : "empty",
        isActive: pane.id === activePaneId,
        isTarget: pane.id === targetPaneId,
      })),
    [activePaneId, panes, tabLabels, targetPaneId],
  );

  const onComposerKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (isComposerAiToggleKey(event)) {
        event.preventDefault();
        if (targetSessionId) {
          onToggleComposerSubmitKind?.(targetSessionId);
        }
        return;
      }
      if (
        aiAssistEnabled &&
        isAskFailureShortcut(event, composerDraft.trim().length === 0, Boolean(commandFailure)) &&
        targetSessionId
      ) {
        event.preventDefault();
        onAskAboutFailure?.(targetSessionId);
        return;
      }
      if (event.key === "ArrowUp" && !event.shiftKey && !event.ctrlKey && !event.altKey && !event.metaKey) {
        event.preventDefault();
        stepComposerHistory("prev");
        return;
      }
      if (event.key === "ArrowDown" && !event.shiftKey && !event.ctrlKey && !event.altKey && !event.metaKey) {
        event.preventDefault();
        stepComposerHistory("next");
        return;
      }
      if (event.key === "ArrowRight" && prediction) {
        const ta = composerTextareaRef.current;
        const selectionStart = ta?.selectionStart ?? composerDraft.length;
        const selectionEnd = ta?.selectionEnd ?? composerDraft.length;
        if (canAcceptPrediction(composerDraft, prediction, selectionStart, selectionEnd)) {
          event.preventDefault();
          setComposerDraft(prediction);
          completionMetricsRef.current.accepted += 1;
          setCompletionMetricsTick((tick) => tick + 1);
          return;
        }
      }
      if (event.key === "Escape" && completionState.response) {
        event.preventDefault();
        resetCompletionState(null);
        return;
      }
      if (event.key === "Tab") {
        if (composerSubmitKind === "ai") {
          return;
        }
        event.preventDefault();
        const ta = composerTextareaRef.current;
        const selectionStart = ta?.selectionStart ?? composerDraft.length;
        const selectionEnd = ta?.selectionEnd ?? composerDraft.length;
        const requestKey = completionRequestKey(composerDraft, selectionStart);
        const canCycle =
          completionStateRef.current.requestKey === requestKey &&
          hasCompletionCandidates(completionStateRef.current.response);
        if (canCycle && cycleComposerCompletion()) {
          return;
        }
        void requestComposerCompletion().then((applied) => {
          if (applied) {
            return;
          }
          if (prediction && canAcceptPrediction(composerDraft, prediction, selectionStart, selectionEnd)) {
            setComposerDraft(prediction);
            completionMetricsRef.current.accepted += 1;
            setCompletionMetricsTick((tick) => tick + 1);
          }
        });
        return;
      }
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        submitComposer();
      }
    },
    [
      aiAssistEnabled,
      commandFailure,
      composerDraft,
      composerSubmitKind,
      completionState.response,
      cycleComposerCompletion,
      onAskAboutFailure,
      onToggleComposerSubmitKind,
      prediction,
      requestComposerCompletion,
      resetCompletionState,
      stepComposerHistory,
      submitComposer,
      targetSessionId,
    ],
  );

  return {
    composerDraft,
    setComposerDraft,
    composerTextareaRef,
    composerLocked,
    inputMode,
    composerSubmitKind,
    targetSessionId,
    commandFailure,
    prediction,
    completionState,
    completionMetricsRef,
    completionMetricsTick,
    panePills,
    focusComposerInput,
    submitComposer,
    requestComposerCompletion,
    cycleComposerCompletion,
    stepComposerHistory,
    resetCompletionState,
    onComposerKeyDown,
    onToggleComposerSubmitKind:
      targetSessionId && onToggleComposerSubmitKind ? () => onToggleComposerSubmitKind(targetSessionId) : undefined,
    onAskAboutFailure:
      targetSessionId && onAskAboutFailure ? () => onAskAboutFailure(targetSessionId) : undefined,
    aiAssistEnabled,
    composerPlaceholder: composerPlaceholderForMode(
      inputMode,
      composerLocked,
      composerSubmitKind === "ai",
    ),
    inputModeUsesComposer: inputModeUsesComposer(inputMode),
    isComposerAiToggleKey,
    isAskFailureShortcut,
    composerOutputScrollIntentFromKeyboardEvent,
    canAcceptPrediction,
    completionRequestKey,
    hasCompletionCandidates,
  };
}
