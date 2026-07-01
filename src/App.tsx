import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { check } from "@tauri-apps/plugin-updater";
import "./App.css";
import { AppSettingsModal } from "./components/AppSettingsModal";
import { CommandPalette } from "./components/CommandPalette";
import { FirstRunSetup, ONBOARDING_STORAGE_KEY } from "./components/FirstRunSetup";
import { NewTabProfileModal } from "./components/NewTabProfileModal";
import { SplitWorkspace, sessionIdForPane } from "./components/SplitWorkspace";
import { GroupComposer } from "./components/GroupComposer";
import { CustomTitleBar } from "./components/CustomTitleBar";
import { TabBar } from "./components/TabBar";
import { OpsRail, type OpsRailFilter } from "./components/OpsRail";
import { OpsRailResizeHandle } from "./components/OpsRailResizeHandle";
import { ExitPersistOverlay } from "./components/ExitPersistOverlay";
import type { SideRailTab } from "./components/AiChatPanel";
import { SETTINGS_SECTION_AI_PROVIDERS } from "./components/AiChatPanel";
import { APP_COMMANDS, DEV_PALETTE_COMMANDS, type AppCommandId } from "./core/commands";
import {
  clearExitedInfo,
  deriveExitedInfo,
  type SessionExitedInfo,
} from "./core/sessionLifecycle";
import { appendTerminalInputLine, isShellExitCommand } from "./core/shellExitCommand";
import { canApplyPendingComposerText } from "./core/composerDeepLink";
import {
  applyCwdChange,
  getRestartCwd,
  type SessionCwdMap,
} from "./core/sessionCwd";
import { collectExitedSessionIds } from "./core/sessionTabStatus";
import { commandToTerminalUiIntent } from "./core/terminalCommandRouting";
import type { TerminalUiRequest } from "./core/terminalUiRequest";
import {
  DEFAULT_UI_SURFACE_STATE,
  mergeUiSurfaceState,
  reduceUiSurfaceStateForRequest,
  type UiSurfaceState,
  type UiSurfaceStatePatch,
} from "./core/uiSurfaceState";
import {
  DEFAULT_KEYMAP,
  formatShortcut,
  matchShortcut,
  paneIndexFromCommand,
  shouldBlockWorkspaceShortcut,
  shortcutAllowedInTextField,
} from "./core/keymap";
import { DEFAULT_RUNTIME_CAPABILITIES, type RuntimeCapabilities } from "./core/runtime";
import {
  historyQuery,
  historyReplay,
  composerComplete,
  onAiContext,
  onAiNoteDeepLink,
  onComposerDeepLink,
  onPtyCwdChanged,
  onPtyCommandMarker,
  onPtyLifecycle,
  pluginExecute,
  pluginGrantsSnapshot,
  pluginGrantCapability,
  pluginMetricsSnapshot,
  profileGet,
  profilePatch,
  providerList,
  providerRoutingGet,
  runtimeDebugSnapshot,
  runtimeMetricsSnapshot,
  settingsSchemaDump,
  ptyClose,
  ptyResize,
  ptySpawn,
  ptyWrite,
  type AiNotePayload,
  type ComposerPayload,
  type HistoryEntry,
  type PtyCommandMarkerEvent,
  type PtyLifecycleEvent,
  type PtySessionInfo,
  type RuntimeMetricsSnapshot,
  type PluginMetricsSnapshot,
  type SessionStatus,
  type ShellCandidate,
  workspaceLayoutSet,
  trimAiContextExcerpt,
  type AiPromptContextPayload,
  type TerminalProfile,
} from "./core/terminal";
import {
  buildRestorableSessions,
  closePane,
  addNewSessionTab,
  activeGroupLayout,
  createWorkspaceState,
  displacedSessionIdForSplitCap,
  findSessionPaneHost,
  reconcileWorkspaceAfterPaneSpawn,
  removeSessionFromWorkspace,
  selectTabGroup,
  setActivePane,
  setTargetPane,
  setBroadcastMode,
  toggleBroadcastOnce,
  armBroadcastSticky,
  setSplitRatioOnWorkspace,
  selectSessionInWorkspace,
  sessionIdsInGroup,
  splitWorkspaceForNewSession,
  workspaceLayoutFromState,
  type WorkspaceState,
  type SplitDirection,
} from "./state/workspace";
import { useGroupComposer } from "./hooks/useGroupComposer";
import { usePtyOutputStream } from "./hooks/usePtyOutputStream";
import { useSessionBoot, type SessionBootCallbacks } from "./hooks/useSessionBoot";
import { useWorkspaceFocus } from "./hooks/useWorkspaceFocus";
import { buildTabLabels } from "./core/sessionTabStatus";
import { buildTabBarGroups } from "./core/tabGroups";
import {
  cycleSessionInputMode,
  defaultSessionInputMode,
  inputModeUsesComposer,
  isInputModeCycleChord,
  type SessionInputMode,
} from "./core/inputMode";
import {
  defaultComposerSubmitKind,
  shellEchoCommandForAiPrompt,
  toggleComposerSubmitKind,
  type ComposerSubmitKind,
} from "./core/composerAiIntent";
import { loadOpsRailWidth, saveOpsRailWidth } from "./core/opsRailLayout";
import {
  flushPersistedStateForExit,
  runExitPersistAndClose,
  yieldForExitOverlayPaint,
  type ExitPersistPhase,
} from "./core/exitPersist";
import {
  ensureChatKeysForSessionIds,
  resolveChatKeyForSession,
} from "./core/sessionRestore";
import {
  appendChatMessage,
  attachmentBlockForContext,
  attachmentFromAiNote,
  createChatMessageId,
  type AiChatState,
  type AiContextAttachment,
} from "./core/aiChatState";
import {
  applyCommandMarkerOutcome,
  buildFailureAiQuestion,
  failureOutputExcerpt,
  type SessionCommandFailure,
} from "./core/sessionCommandOutcome";
import {
  buildHistoryForExecute,
  mergeOutputExcerpts,
} from "./core/aiContextBudget";
import {
  hydrateAiChatStateFromStore,
  persistAiChatsForSessions,
  prunePersistedAiChats,
} from "./core/aiChatPersistence";
import {
  loadAiBehaviorSettings,
  saveAiBehaviorSettings,
  type AiBehaviorSettings,
} from "./core/aiBehaviorSettings";
import { isAiAssistReady } from "./core/providerUiState";
import { historyAiContract, useProviderAiState } from "./hooks/useProviderAiState";
import { HISTORY_UI_LIMIT, prependHistoryEntry } from "./core/historySync";
import { spawnProfileFromShellSelection, spawnProfileForLiveSession, type ShellSpawnSelection } from "./core/spawnProfile";
import {
  fetchShellPresets,
  parseShellPresetPaletteId,
  shellPresetDescription,
  shellPresetPaletteId,
  type ShellPreset,
} from "./core/shellPresets";
import {
  formatShellCommandPreview,
  parseShellCandidatePaletteId,
  shellCandidatePaletteId,
} from "./core/shellProfiles";
import { isTauri } from "./core/tauriRuntime";
import {
  appendCommandSubmitted,
  serializePinnedMap,
  toggleRunPin,
  type RunLedgerState,
  type RunRecord,
} from "./core/runLedger";
import { sessionBufferStore } from "./state/sessionBufferStore";
import {
  pruneAllSessionScopedState,
  removeSessionFromRegistry,
  type SessionRegistryContext,
} from "./state/sessionRegistry";

const MAX_SESSION_BUFFER = 120_000;
const RESIZE_THROTTLE_MS = 100;
const WORKSPACE_PERSIST_DEBOUNCE_MS = 320;
const OPS_RAIL_COLLAPSED_KEY = "mach-terminal.opsRail.collapsed";
const OPS_RAIL_PINS_KEY = "mach-terminal.opsRail.pins";
const AI_CHAT_PERSIST_DEBOUNCE_MS = 400;

const UPDATER_ENABLED = import.meta.env.VITE_ENABLE_UPDATER === "true";

function stepRunSelection(runs: RunRecord[], selectedId: string | null, delta: number): string | null {
  if (runs.length === 0) {
    return null;
  }
  const idx = selectedId ? runs.findIndex((r) => r.id === selectedId) : -1;
  const cur = idx < 0 ? runs.length - 1 : idx;
  const next = (cur + delta + runs.length) % runs.length;
  return runs[next]?.id ?? null;
}

function App() {
  const [capabilities, setCapabilities] = useState<RuntimeCapabilities>(DEFAULT_RUNTIME_CAPABILITIES);
  const [runtimeError, setRuntimeError] = useState<string | null>(null);
  const [transientRuntimeError, setTransientRuntimeError] = useState<string | null>(null);
  const [runtimeMetrics, setRuntimeMetrics] = useState<RuntimeMetricsSnapshot | null>(null);
  const [sessions, setSessions] = useState<PtySessionInfo[]>([]);
  const [workspace, setWorkspace] = useState<WorkspaceState>(createWorkspaceState);
  const workspaceRef = useRef(workspace);
  workspaceRef.current = workspace;
  const sessionsRef = useRef(sessions);
  sessionsRef.current = sessions;
  const composerDraftRef = useRef("");
  const createSessionInFlightRef = useRef(false);
  const cachedProfileRef = useRef<TerminalProfile | null>(null);
  const splitSessionInFlightRef = useRef(false);
  const lastPaneSplitAtRef = useRef(0);
  const focusGroupComposerRef = useRef<(() => void) | null>(null);
  const closePaneByIdRef = useRef<(paneId: string) => Promise<void>>(async () => {});
  const closeTabGroupRef = useRef<(groupId: string) => Promise<void>>(async () => {});
  const sessionCommandLineRef = useRef<Record<string, string>>({});
  const [runLedger, setRunLedger] = useState<RunLedgerState>({});
  const runLedgerRef = useRef(runLedger);
  runLedgerRef.current = runLedger;
  const [opsRailCollapsed, setOpsRailCollapsed] = useState(() => {
    if (typeof window === "undefined") {
      return true;
    }
    // Default to collapsed so the terminal gets full width on first run; honor the
    // user's explicit choice once they've toggled it (persisted as "0"/"1").
    const stored = window.localStorage.getItem(OPS_RAIL_COLLAPSED_KEY);
    return stored === null ? true : stored === "1";
  });
  const [opsRailWidth, setOpsRailWidth] = useState(() => loadOpsRailWidth());
  const [opsFilter, setOpsFilter] = useState<OpsRailFilter>("all");
  const [opsSelectedRunId, setOpsSelectedRunId] = useState<string | null>(null);
  const [sideRailTab, setSideRailTab] = useState<SideRailTab>("log");
  const [sessionStatus, setSessionStatus] = useState<Record<string, SessionStatus>>({});
  const [sessionMessages, setSessionMessages] = useState<Record<string, string | undefined>>({});
  const [sessionExited, setSessionExited] = useState<Record<string, SessionExitedInfo>>({});
  /**
   * Live CWD per session, sourced from the Rust `pty-cwd-changed` event. Populated
   * only when the user has wired one of the documented OSC 7 hooks into their
   * shell; otherwise stays empty and `restartSessionById` falls back to the
   * profile default, matching pre-tranche behavior.
   */
  const [sessionCwd, setSessionCwd] = useState<SessionCwdMap>({});
  /** User-set custom tab names by session id; absent = use the numbered shell default. */
  const [sessionNames, setSessionNames] = useState<Record<string, string>>({});
  /** Per-session input posture (operator / commander); defaults to operator. */
  const [sessionInputModes, setSessionInputModes] = useState<Record<string, SessionInputMode>>({});
  /** Operator-only: command vs AI composer intent (toggled with `?`). */
  const [composerSubmitKinds, setComposerSubmitKinds] = useState<Record<string, ComposerSubmitKind>>({});
  /** Last non-zero OSC 133 exit per session for failure → AI shortcuts. */
  const [sessionCommandFailures, setSessionCommandFailures] = useState<
    Record<string, SessionCommandFailure | undefined>
  >({});
  const [aiChatState, setAiChatState] = useState<AiChatState>({});
  const [sessionChatKeys, setSessionChatKeys] = useState<Record<string, string>>({});
  const [aiPendingAttachments, setAiPendingAttachments] = useState<Record<string, AiContextAttachment[]>>({});
  /** Queued `machterm://ai-note` deep link, attached once a session is active (handles cold start). */
  const [pendingAiNote, setPendingAiNote] = useState<AiNotePayload | null>(null);
  /** Queued `machterm://composer` deep link, applied once the composer is usable (handles cold start). */
  const [pendingComposerText, setPendingComposerText] = useState<ComposerPayload | null>(null);
  const [aiBehaviorSettings, setAiBehaviorSettings] = useState<AiBehaviorSettings>(() => loadAiBehaviorSettings());
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [renameRequestSessionId, setRenameRequestSessionId] = useState<string | null>(null);
  const handleRenameRequestHandled = useCallback(() => setRenameRequestSessionId(null), []);
  /** Spawn-time shell args per session (WSL distros, login flags, etc.) for restore. */
  const [sessionSpawnArgs, setSessionSpawnArgs] = useState<Record<string, string[]>>({});
  const [shellPresets, setShellPresets] = useState<ShellPreset[]>([]);
  const [detectedShells, setDetectedShells] = useState<ShellCandidate[]>([]);
  const [historyEntries, setHistoryEntries] = useState<HistoryEntry[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [historyActionStatus, setHistoryActionStatus] = useState<string | null>(null);
  const [pluginResult, setPluginResult] = useState<string | null>(null);
  const [pluginPolicyDecision, setPluginPolicyDecision] = useState<string | null>(null);
  const [pluginGrantSummary, setPluginGrantSummary] = useState<string | null>(null);
  const [pluginTelemetry, setPluginTelemetry] = useState<PluginMetricsSnapshot | null>(null);
  const [updateStatus, setUpdateStatus] = useState<string>(UPDATER_ENABLED ? "idle" : "disabled (build flag)");
  const [firstRunModalOpen, setFirstRunModalOpen] = useState(false);
  const [newTabPickerOpen, setNewTabPickerOpen] = useState(false);
  const [settingsModalOpen, setSettingsModalOpen] = useState(false);
  const [settingsInitialSection, setSettingsInitialSection] = useState<string | undefined>(undefined);

  const openSettings = useCallback((sectionId?: string) => {
    setSettingsInitialSection(sectionId);
    setSettingsModalOpen(true);
  }, []);
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);
  const [diagnosticsJson, setDiagnosticsJson] = useState<string | null>(null);
  const [diagnosticsLoading, setDiagnosticsLoading] = useState(false);
  const [diagnosticsError, setDiagnosticsError] = useState<string | null>(null);
  const [diagnosticsCopyStatus, setDiagnosticsCopyStatus] = useState<string | null>(null);
  const [recoveryBanner, setRecoveryBanner] = useState<string | null>(null);
  const [exitPersistPhase, setExitPersistPhase] = useState<ExitPersistPhase | null>(null);
  const exitCloseInFlightRef = useRef(false);
  const exitAllowDestroyRef = useRef(false);
  const [terminalFontSize, setTerminalFontSize] = useState(13);
  const [minimalShellPrompt, setMinimalShellPrompt] = useState(false);
  const [showComposerAssistMetrics, setShowComposerAssistMetrics] = useState(false);
  const [sessionOsc133Hints, setSessionOsc133Hints] = useState<Record<string, string>>({});
  const [sessionUiSurface, setSessionUiSurface] = useState<Record<string, UiSurfaceState>>({});
  const terminalUiSeqRef = useRef(0);
  const [terminalUiRequest, setTerminalUiRequest] = useState<TerminalUiRequest | null>(null);
  const resizeThrottleRef = useRef<Record<string, number>>({});
  const layoutPersistBootstrappedRef = useRef(false);
  const sessionBootCallbacksRef = useRef<SessionBootCallbacks>(null!);
  const persistSnapshotRef = useRef({
    workspace,
    sessions,
    sessionCwd,
    sessionNames,
    sessionInputModes,
    sessionChatKeys,
    sessionSpawnArgs,
    aiChatState,
    sessionsById: {} as Record<string, PtySessionInfo>,
  });

  const sessionsById = useMemo(
    () =>
      sessions.reduce<Record<string, PtySessionInfo>>((lookup, session) => {
        lookup[session.id] = session;
        return lookup;
      }, {}),
    [sessions],
  );

  useEffect(() => {
    persistSnapshotRef.current = {
      workspace,
      sessions,
      sessionCwd,
      sessionNames,
      sessionInputModes,
      sessionChatKeys,
      sessionSpawnArgs,
      aiChatState,
      sessionsById,
    };
  }, [workspace, sessions, sessionCwd, sessionNames, sessionInputModes, sessionChatKeys, sessionSpawnArgs, aiChatState, sessionsById]);

  const recordSpawnArgs = useCallback((sessionId: string, profile: TerminalProfile) => {
    if (!profile.args || profile.args.length === 0) {
      return;
    }
    setSessionSpawnArgs((current) => ({ ...current, [sessionId]: [...profile.args!] }));
  }, []);

  const { pendingOutputRef, lastSequenceRef } = usePtyOutputStream({
    maxSessionBuffer: MAX_SESSION_BUFFER,
    setRuntimeError,
  });

  const sessionRegistryRef = useRef<SessionRegistryContext>(null!);
  sessionRegistryRef.current = {
    setters: {
      setRunLedger,
      setSessionStatus,
      setSessionMessages,
      setSessionExited,
      setSessionCwd,
      setSessionNames,
      setSessionInputModes,
      setComposerSubmitKinds,
      setSessionCommandFailures,
      setAiChatState,
      setSessionChatKeys,
      setAiPendingAttachments,
      setSessionSpawnArgs,
      setSessionUiSurface,
      setSessionOsc133Hints,
    },
    transientRefs: {
      pendingOutputRef,
      lastSequenceRef,
      resizeThrottleRef,
      sessionCommandLineRef,
    },
  };

  const activeLayout = useMemo(() => activeGroupLayout(workspace), [workspace]);

  const activeSessionId = useMemo(() => {
    const activePane = activeLayout.panes.find((pane) => pane.id === activeLayout.activePaneId);
    return activePane?.sessionId ?? null;
  }, [activeLayout]);

  const activeSession = activeSessionId ? sessionsById[activeSessionId] : undefined;
  const activeUiSurfaceState = activeSessionId ? sessionUiSurface[activeSessionId] ?? DEFAULT_UI_SURFACE_STATE : null;

  const tabLabels = useMemo(() => buildTabLabels(sessions, sessionNames), [sessions, sessionNames]);

  const tabBarGroups = useMemo(
    () =>
      buildTabBarGroups(
        workspace.groups,
        sessionsById,
        tabLabels,
        sessionStatus,
        sessionExited,
        workspace.activeGroupId,
      ),
    [workspace.groups, workspace.activeGroupId, sessionsById, tabLabels, sessionStatus, sessionExited],
  );

  const cycleActiveInputMode = useCallback(() => {
    if (!activeSessionId) {
      return;
    }
    setSessionInputModes((current) => ({
      ...current,
      [activeSessionId]: cycleSessionInputMode(current[activeSessionId] ?? defaultSessionInputMode()),
    }));
  }, [activeSessionId]);

  const renameSession = useCallback((sessionId: string, name: string) => {
    const trimmed = name.trim();
    setSessionNames((current) => {
      if (trimmed.length === 0) {
        if (!(sessionId in current)) {
          return current;
        }
        const next = { ...current };
        delete next[sessionId];
        return next;
      }
      if (current[sessionId] === trimmed) {
        return current;
      }
      return { ...current, [sessionId]: trimmed };
    });
  }, []);

  const buildAiPromptContext = useCallback((): AiPromptContextPayload | undefined => {
    if (!activeSession) {
      return undefined;
    }
    const cwd = sessionCwd[activeSession.id] ?? activeSession.cwd ?? undefined;
    const rawBuffer = sessionBufferStore.get(activeSession.id);
    const output_excerpt = trimAiContextExcerpt(rawBuffer);
    return {
      cwd,
      shell: activeSession.shell ?? undefined,
      output_excerpt,
    };
  }, [activeSession, sessionCwd]);

  const openAiRail = useCallback(() => {
    setSideRailTab("ai");
    setOpsRailCollapsed(false);
  }, []);

  const ensureChatKey = useCallback((sessionId: string, preferredKey?: string): string => {
    const resolved = resolveChatKeyForSession(sessionChatKeys, sessionId, preferredKey);
    if (resolved.nextKeys !== sessionChatKeys) {
      setSessionChatKeys(resolved.nextKeys);
    }
    return resolved.chatKey;
  }, [sessionChatKeys]);

  const bootstrapSessionChat = useCallback((sessionIds: string[], keys: Record<string, string>) => {
    const merged = ensureChatKeysForSessionIds(sessionIds, keys);
    setSessionChatKeys(merged);
    setAiChatState((current) => ({ ...hydrateAiChatStateFromStore(merged), ...current }));
  }, []);

  const appendAssistantReply = useCallback((sessionId: string, output: string) => {
    ensureChatKey(sessionId);
    setAiChatState((current) =>
      appendChatMessage(current, sessionId, {
        id: createChatMessageId(),
        role: "assistant",
        content: output,
        atMs: Date.now(),
      }),
    );
  }, [ensureChatKey]);

  const appendUserChatMessage = useCallback(
    (sessionId: string, content: string, attachments: AiContextAttachment[] = []) => {
      ensureChatKey(sessionId);
      setAiChatState((current) =>
        appendChatMessage(current, sessionId, {
          id: createChatMessageId(),
          role: "user",
          content,
          attachments: attachments.length > 0 ? attachments : undefined,
          atMs: Date.now(),
        }),
      );
    },
    [ensureChatKey],
  );

  const filteredRunsForOps = useMemo(() => {
    const list = activeSessionId ? (runLedger[activeSessionId] ?? []) : [];
    if (opsFilter === "pinned") {
      return list.filter((r) => r.pinned);
    }
    return list;
  }, [runLedger, activeSessionId, opsFilter]);

  const handleJumpRun = useCallback((run: RunRecord) => {
    const q = run.commandText.split(/\r?\n/)[0]?.trim() ?? run.commandText.trim();
    if (!q) {
      return;
    }
    terminalUiSeqRef.current += 1;
    setTerminalUiRequest({ seq: terminalUiSeqRef.current, kind: "jumpSearch", query: q });
  }, []);

  const handleOpsTogglePin = useCallback(
    (runId: string) => {
      if (!activeSessionId) {
        return;
      }
      setRunLedger((ledger) => toggleRunPin(ledger, activeSessionId, runId));
    },
    [activeSessionId],
  );

  /** Taskbar / title-bar window icon (dev + prod); PNG bytes avoid stale embedded icon cache on Windows. */
  useEffect(() => {
    if (!isTauri()) {
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const { getCurrentWindow } = await import("@tauri-apps/api/window");
        const rawBase = import.meta.env.BASE_URL ?? "/";
        const base = rawBase.endsWith("/") ? rawBase : `${rawBase}/`;
        const res = await fetch(`${base}mach-terminal-logo.png`);
        if (!res.ok) {
          return;
        }
        const buf = await res.arrayBuffer();
        if (cancelled) {
          return;
        }
        await getCurrentWindow().setIcon(new Uint8Array(buf));
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (filteredRunsForOps.length === 0) {
      setOpsSelectedRunId(null);
      return;
    }
    setOpsSelectedRunId((prev) =>
      prev && filteredRunsForOps.some((r) => r.id === prev)
        ? prev
        : (filteredRunsForOps[filteredRunsForOps.length - 1]?.id ?? null),
    );
  }, [filteredRunsForOps]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    try {
      window.localStorage.setItem(OPS_RAIL_PINS_KEY, JSON.stringify(serializePinnedMap(runLedger)));
    } catch {
      /* ignore */
    }
  }, [runLedger]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    try {
      window.localStorage.setItem(OPS_RAIL_COLLAPSED_KEY, opsRailCollapsed ? "1" : "0");
    } catch {
      /* ignore */
    }
  }, [opsRailCollapsed]);

  useEffect(() => {
    saveOpsRailWidth(opsRailWidth);
  }, [opsRailWidth]);

  const handleOpsRailWidthChange = useCallback((width: number) => {
    setOpsRailWidth(width);
  }, []);

  const flushPersistedState = useCallback(async (onPhase?: (phase: ExitPersistPhase) => void) => {
    await flushPersistedStateForExit(persistSnapshotRef.current, layoutPersistBootstrappedRef.current, onPhase);
  }, []);

  const {
    providers,
    routing,
    routingDraft,
    providerEndpointDrafts,
    providerApiKeyDrafts,
    providerConfigStatus,
    aiPrompt,
    aiResponse,
    aiRequestInFlight,
    aiRequestStatus,
    lastAiContext,
    initializeProviderAiState,
    setRoutingDraft,
    updateProviderEndpointDraft,
    updateProviderApiKeyDraft,
    setAiPrompt,
    setLastAiContext,
    toggleProvider,
    saveProviderEndpoint,
    saveProviderApiKey,
    clearProviderApiKey,
    saveRoutingConfig,
    setAiOptIn,
    runAiPrompt,
    runAiPromptWithText,
    explainCommand,
    fixCommand,
  } = useProviderAiState({
    activeSession,
    onHistoryActionStatus: (status) => setHistoryActionStatus(status),
    buildAiPromptContext,
    buildAiToolContext: (sessionId: string) => ({
      sessionId,
      runLedger: runLedgerRef.current,
      sessionBuffers: sessionBufferStore.getAll(),
    }),
    enableAiTools: aiBehaviorSettings.enableAiTools,
    onAiAssistantReply: ({ output, sessionId }) => {
      const sid = sessionId ?? activeSessionId;
      if (!sid) {
        return;
      }
      appendAssistantReply(sid, output);
    },
  });

  const aiAssistEnabled = useMemo(
    () => isAiAssistReady(routing.ai_feature_enabled, routing.default_provider, providers),
    [providers, routing.ai_feature_enabled, routing.default_provider],
  );

  const toggleComposerSubmitKindForSession = useCallback((sessionId: string) => {
    setComposerSubmitKinds((current) => ({
      ...current,
      [sessionId]: toggleComposerSubmitKind(current[sessionId] ?? defaultComposerSubmitKind()),
    }));
  }, []);

  const queueAiSelection = useCallback(
    (sessionId: string, attachment: AiContextAttachment) => {
      openAiRail();
      setAiPendingAttachments((current) => ({
        ...current,
        [sessionId]: [...(current[sessionId] ?? []), attachment],
      }));
      setComposerSubmitKinds((current) => ({
        ...current,
        [sessionId]: "ai",
      }));
    },
    [openAiRail],
  );

  // Attaches a queued `machterm://ai-note` deep link once a session is active. On cold
  // start `activeSessionId` starts null until session boot finishes, so this naturally
  // waits rather than dropping the note (see docs/deep-link-contract.md).
  useEffect(() => {
    if (!pendingAiNote || !activeSessionId) {
      return;
    }
    queueAiSelection(activeSessionId, attachmentFromAiNote(pendingAiNote));
    setPendingAiNote(null);
  }, [activeSessionId, pendingAiNote, queueAiSelection]);

  const explainCommandToChat = useCallback(
    (command: string) => {
      if (!activeSessionId) {
        return;
      }
      openAiRail();
      const contract = historyAiContract("explain", command);
      appendUserChatMessage(activeSessionId, contract.prompt);
      void explainCommand(command);
    },
    [activeSessionId, appendUserChatMessage, explainCommand, openAiRail],
  );

  const fixCommandToChat = useCallback(
    (command: string) => {
      if (!activeSessionId) {
        return;
      }
      openAiRail();
      const contract = historyAiContract("fix", command);
      appendUserChatMessage(activeSessionId, contract.prompt);
      void fixCommand(command);
    },
    [activeSessionId, appendUserChatMessage, fixCommand, openAiRail],
  );

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const onAiBehavior = () => setAiBehaviorSettings(loadAiBehaviorSettings());
    window.addEventListener("mach-terminal-ai-behavior-settings", onAiBehavior);
    return () => window.removeEventListener("mach-terminal-ai-behavior-settings", onAiBehavior);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const v = window.localStorage.getItem(ONBOARDING_STORAGE_KEY);
    if (v !== "done" && v !== "skipped") {
      setFirstRunModalOpen(true);
    }
  }, []);

  sessionBootCallbacksRef.current = {
    setHistoryLoading,
    setHistoryError,
    setCapabilities,
    initializeProviderAiState,
    setTerminalFontSize,
    setMinimalShellPrompt,
    setShowComposerAssistMetrics,
    setCachedProfile: (profile) => {
      cachedProfileRef.current = profile;
    },
    setSessions,
    setSessionStatus,
    setSessionNames,
    setSessionInputModes,
    setSessionSpawnArgs,
    setWorkspace,
    bootstrapSessionChat,
    setHistoryEntries,
    setRecoveryBanner,
    setRuntimeMetrics,
    setRuntimeError,
    setDetectedShells,
    setShellPresets,
    recordSpawnArgs,
    onBootstrapped: () => {
      layoutPersistBootstrappedRef.current = true;
    },
  };
  useSessionBoot(sessionBootCallbacksRef);

  useEffect(() => {
    if (!recoveryBanner) {
      return;
    }
    const timeout = window.setTimeout(() => setRecoveryBanner(null), 8200);
    return () => window.clearTimeout(timeout);
  }, [recoveryBanner]);

  useEffect(() => {
    if (!runtimeError) {
      return;
    }
    setTransientRuntimeError(runtimeError);
    const timeout = window.setTimeout(() => {
      setTransientRuntimeError((current) => (current === runtimeError ? null : current));
    }, 4200);
    return () => window.clearTimeout(timeout);
  }, [runtimeError]);

  useEffect(() => {
    if (!historyActionStatus) {
      return;
    }
    const timeout = window.setTimeout(() => setHistoryActionStatus(null), 2600);
    return () => window.clearTimeout(timeout);
  }, [historyActionStatus]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    if (!layoutPersistBootstrappedRef.current) {
      return;
    }
    const handle = window.setTimeout(() => {
      const restorable = buildRestorableSessions(
        sessions,
        (id) => sessionCwd[id] ?? sessionsById[id]?.cwd,
        sessionNames,
        sessionInputModes,
        sessionChatKeys,
        sessionSpawnArgs,
      );
      const layout = workspaceLayoutFromState(workspace, restorable);
      void workspaceLayoutSet(layout).catch((error) => {
        console.warn("failed to persist workspace layout", error);
      });
    }, WORKSPACE_PERSIST_DEBOUNCE_MS);
    return () => window.clearTimeout(handle);
  }, [workspace, sessions, sessionCwd, sessionNames, sessionInputModes, sessionChatKeys, sessionSpawnArgs, sessionsById]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const handle = window.setTimeout(() => {
      persistAiChatsForSessions(aiChatState, sessionChatKeys);
      const aliveKeys = new Set(Object.values(sessionChatKeys));
      prunePersistedAiChats(aliveKeys);
    }, AI_CHAT_PERSIST_DEBOUNCE_MS);
    return () => window.clearTimeout(handle);
  }, [aiChatState, sessionChatKeys]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const onExitFlush = () => {
      void flushPersistedState();
    };
    window.addEventListener("pagehide", onExitFlush);
    window.addEventListener("beforeunload", onExitFlush);
    return () => {
      window.removeEventListener("pagehide", onExitFlush);
      window.removeEventListener("beforeunload", onExitFlush);
    };
  }, [flushPersistedState]);

  useEffect(() => {
    if (!isTauri()) {
      return;
    }
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    void (async () => {
      try {
        const { getCurrentWindow } = await import("@tauri-apps/api/window");
        if (cancelled) {
          return;
        }
        unlisten = await getCurrentWindow().onCloseRequested(async (event) => {
          if (exitAllowDestroyRef.current) {
            return;
          }
          if (exitCloseInFlightRef.current) {
            event.preventDefault();
            return;
          }
          event.preventDefault();
          exitCloseInFlightRef.current = true;
          setExitPersistPhase("ai-chats");
          await yieldForExitOverlayPaint();
          const closeResult = await runExitPersistAndClose(
            () => flushPersistedState((phase) => setExitPersistPhase(phase)),
            async () => {
              exitAllowDestroyRef.current = true;
              await getCurrentWindow().destroy();
            },
          );
          if (closeResult === "close-failed") {
            setExitPersistPhase(null);
            exitCloseInFlightRef.current = false;
            exitAllowDestroyRef.current = false;
            setRuntimeError(
              "Mach could not close the window. Try again or force-quit from the OS task manager.",
            );
          }
        });
      } catch (error) {
        console.warn("failed to bind close persist handler", error);
      }
    })();
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [flushPersistedState]);

  useEffect(() => {
    let lifecycleUnlisten: (() => void) | undefined;
    let cwdUnlisten: (() => void) | undefined;
    let markerUnlisten: (() => void) | undefined;
    let contextUnlisten: (() => void) | undefined;
    let aiNoteUnlisten: (() => void) | undefined;
    let composerDeepLinkUnlisten: (() => void) | undefined;

    const bindEvents = async () => {
      lifecycleUnlisten = await onPtyLifecycle((event: PtyLifecycleEvent) => {
        const sid = event.session_id;
        if (event.status === "running") {
          // Reset sequence baseline for a fresh run, but do NOT clear pending output:
          // with the raw-bytes channel, PTY chunks often arrive before this lifecycle
          // event (especially on multi-tab cold restore). Clearing pending here was
          // wiping shell prompts that already landed.
          delete lastSequenceRef.current[sid];
          setSessionExited((current) => clearExitedInfo(current, sid));
        }

        setSessionStatus((current) => {
          const next = { ...current, [sid]: event.status };
          return next;
        });
        setSessionMessages((current) => ({ ...current, [sid]: event.message }));

        const exitedInfo = deriveExitedInfo(event);
        if (exitedInfo) {
          delete pendingOutputRef.current[sid];
          delete lastSequenceRef.current[sid];
          const host = findSessionPaneHost(workspaceRef.current, sid);
          if (!host) {
            setSessionExited((current) => ({ ...current, [sid]: exitedInfo }));
          } else {
            queueMicrotask(() => {
              if (host.paneCount > 1) {
                void closePaneByIdRef.current(host.paneId);
              } else {
                void closeTabGroupRef.current(host.groupId);
              }
            });
          }
        }
      });

      cwdUnlisten = await onPtyCwdChanged((event) => {
        setSessionCwd((current) => applyCwdChange(current, event));
        const cwd = event.cwd;
        if (!cwd) {
          return;
        }
        setSessions((current) => {
          let changed = false;
          const next = current.map((session) => {
            if (session.id !== event.session_id) {
              return session;
            }
            if (session.cwd === cwd) {
              return session;
            }
            changed = true;
            return { ...session, cwd };
          });
          return changed ? next : current;
        });
      });

      markerUnlisten = await onPtyCommandMarker((event: PtyCommandMarkerEvent) => {
        setSessionOsc133Hints((prev) => {
          const label =
            event.phase === "outputEnd"
              ? event.exit_code != null
                ? `OSC 133 · exit ${event.exit_code}`
                : "OSC 133 · output end"
              : event.phase === "promptStart"
                ? "OSC 133 · prompt"
                : event.phase === "commandStart"
                  ? "OSC 133 · command"
                  : "OSC 133 · output";
          return { ...prev, [event.session_id]: label };
        });
        if (event.phase === "outputEnd") {
          const runs = runLedgerRef.current[event.session_id] ?? [];
          const lastRun = runs.length > 0 ? runs[runs.length - 1] : undefined;
          setSessionCommandFailures((prev) =>
            applyCommandMarkerOutcome(prev, event, lastRun?.commandText),
          );
        }
      });

      contextUnlisten = await onAiContext((event) => {
        setLastAiContext(event);
        if (event.event_type !== "command_submitted") {
          return;
        }
        const sid = event.session_id;
        const bufLen = sessionBufferStore.get(sid).length;
        setRunLedger((ledger) =>
          appendCommandSubmitted(ledger, {
            sessionId: sid,
            commandText: event.payload,
            submittedAtMs: event.timestamp_ms,
            sequence: event.sequence,
            bufferLengthBefore: bufLen,
          }),
        );
        setHistoryEntries((current) =>
          prependHistoryEntry(current, {
            id: event.sequence,
            session_id: sid,
            command: event.payload,
            timestamp_ms: event.timestamp_ms,
          }),
        );
        void historyQuery({ limit: HISTORY_UI_LIMIT })
          .then((entries) => setHistoryEntries(entries))
          .catch(() => undefined);
      });

      aiNoteUnlisten = await onAiNoteDeepLink((event) => {
        setPendingAiNote(event);
      });

      composerDeepLinkUnlisten = await onComposerDeepLink((event) => {
        setPendingComposerText(event);
      });
    };

    void bindEvents();

    return () => {
      lifecycleUnlisten?.();
      cwdUnlisten?.();
      markerUnlisten?.();
      contextUnlisten?.();
      composerDeepLinkUnlisten?.();
      aiNoteUnlisten?.();
    };
  }, []);

  useEffect(() => {
    const aliveIds = sessions.map((session) => session.id);
    pruneAllSessionScopedState(aliveIds, sessionRegistryRef.current);
  }, [sessions]);

  /**
   * Spawn a shell into the currently-active pane. When `cwdOverride` is provided,
   * the user's profile `cwd` is replaced with it for this one spawn only
   * (profile storage stays untouched). Used by `restartSessionById` to land the
   * replacement shell where the old one left off per the live-cwd map.
   */
  const refreshShellPresets = useCallback(() => {
    void fetchShellPresets().then(setShellPresets);
  }, []);

  const createSessionAt = useCallback(async (cwdOverride: string | null, shellSelection?: ShellSpawnSelection) => {
    if (createSessionInFlightRef.current) {
      return;
    }
    createSessionInFlightRef.current = true;
    try {
      const profile = cachedProfileRef.current ?? (await profileGet());
      cachedProfileRef.current = profile;
      setTerminalFontSize(profile.font_size);
      let spawnProfile = shellSelection ? spawnProfileFromShellSelection(profile, shellSelection) : profile;
      if (cwdOverride && cwdOverride.length > 0) {
        spawnProfile = { ...spawnProfile, cwd: cwdOverride };
      }
      const created = await ptySpawn({ profile: spawnProfile });
      recordSpawnArgs(created.id, spawnProfile);

      setSessions((current) =>
        current.some((session) => session.id === created.id) ? current : [...current, created],
      );
      setWorkspace((currentWorkspace) => {
        const next = addNewSessionTab(currentWorkspace, [], created.id);
        workspaceRef.current = next;
        return next;
      });
      setSessionStatus((current) => ({ ...current, [created.id]: "running" }));
      ensureChatKey(created.id);
    } catch (error) {
      setRuntimeError(error instanceof Error ? error.message : "Failed to create session.");
    } finally {
      createSessionInFlightRef.current = false;
    }
  }, [ensureChatKey, recordSpawnArgs]);

  const openNewTabPicker = useCallback(() => {
    setNewTabPickerOpen(true);
  }, []);

  const createSession = useCallback(async () => {
    await createSessionAt(null);
  }, [createSessionAt]);

  const createSessionWithShell = useCallback(
    async (shellSelection: ShellSpawnSelection) => {
      await createSessionAt(null, shellSelection);
    },
    [createSessionAt],
  );

  const clearSessionFromUiState = useCallback((sessionId: string) => {
    const nextSessions = sessionsRef.current.filter((session) => session.id !== sessionId);
    const nextSessionIds = nextSessions.map((session) => session.id);
    sessionsRef.current = nextSessions;
    setSessions(nextSessions);
    setWorkspace((currentWorkspace) => {
      const next = removeSessionFromWorkspace(currentWorkspace, sessionId, nextSessionIds);
      workspaceRef.current = next;
      return next;
    });
    removeSessionFromRegistry(sessionId, sessionRegistryRef.current);
  }, []);

  const updateSessionUiSurfaceState = useCallback((sessionId: string, patch: UiSurfaceStatePatch) => {
    setSessionUiSurface((current) => {
      const existing = current[sessionId];
      const baseline = existing ?? DEFAULT_UI_SURFACE_STATE;
      const nextState = mergeUiSurfaceState(baseline, patch);
      // Bail when the patch is a no-op so we don't emit a new state reference (and a
      // re-render) for every repeated identical surface signal (e.g. scroll events
      // re-asserting followOutput).
      if (
        existing &&
        existing.followOutput === nextState.followOutput &&
        existing.findOpen === nextState.findOpen &&
        existing.findQuery === nextState.findQuery
      ) {
        return current;
      }
      return { ...current, [sessionId]: nextState };
    });
  }, []);

  const closeSession = useCallback(
    async (sessionId: string) => {
      try {
        await ptyClose(sessionId);
        clearSessionFromUiState(sessionId);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to close session.";
        if (message.includes("does not exist")) {
          // Backend sessions can already be removed after natural exit; keep close/restart
          // actions convergent by applying local teardown anyway.
          clearSessionFromUiState(sessionId);
          return;
        }
        setRuntimeError(message);
      }
    },
    [clearSessionFromUiState],
  );

  /** Split the workspace and spawn a fresh shell in the new pane (independent PTY). */
  const createSessionInNewPane = useCallback(
    async (splitDirection?: SplitDirection) => {
      if (splitSessionInFlightRef.current) {
        return;
      }
      const now = Date.now();
      if (now - lastPaneSplitAtRef.current < 500) {
        return;
      }
      lastPaneSplitAtRef.current = now;
      splitSessionInFlightRef.current = true;
      try {
        const snapshot = persistSnapshotRef.current;
        const ws = workspaceRef.current;
        const layout = activeGroupLayout(ws);
        const paneToSplit =
          layout.panes.find((pane) => pane.id === layout.targetPaneId) ??
          layout.panes.find((pane) => pane.id === layout.activePaneId);
        const sourceSession = paneToSplit?.sessionId
          ? snapshot.sessionsById[paneToSplit.sessionId]
          : undefined;

        const baseProfile = cachedProfileRef.current ?? (await profileGet());
        cachedProfileRef.current = baseProfile;
        setTerminalFontSize(baseProfile.font_size);
        const spawnProfile = sourceSession
          ? spawnProfileForLiveSession(
              baseProfile,
              sourceSession,
              snapshot.sessionSpawnArgs,
              snapshot.sessionCwd,
            )
          : baseProfile;
        const displacedId = displacedSessionIdForSplitCap(ws);
        const created = await ptySpawn({ profile: spawnProfile });
        recordSpawnArgs(created.id, spawnProfile);

        const priorIds = sessionsRef.current.map((session) => session.id);
        const nextSessionIds = [
          ...priorIds.filter((id) => id !== displacedId),
          ...(priorIds.includes(created.id) ? [] : [created.id]),
        ];
        const nextSessions = (() => {
          const withoutDisplaced = displacedId
            ? sessionsRef.current.filter((session) => session.id !== displacedId)
            : sessionsRef.current;
          return withoutDisplaced.some((session) => session.id === created.id)
            ? withoutDisplaced
            : [...withoutDisplaced, created];
        })();
        sessionsRef.current = nextSessions;
        setSessions(nextSessions);

        setWorkspace((currentWorkspace) => {
          const split = splitWorkspaceForNewSession(currentWorkspace, created.id, splitDirection);
          const reconciled = reconcileWorkspaceAfterPaneSpawn(split, nextSessionIds);
          workspaceRef.current = reconciled;
          return reconciled;
        });
        setSessionStatus((current) => ({ ...current, [created.id]: "running" }));
        ensureChatKey(created.id);
        if (displacedId) {
          try {
            await ptyClose(displacedId);
          } catch (error) {
            const message = error instanceof Error ? error.message : "Failed to close displaced session.";
            if (!message.includes("does not exist")) {
              console.warn("failed to close displaced split session", displacedId, error);
            }
          }
          clearSessionFromUiState(displacedId);
        }
      } catch (error) {
        setRuntimeError(error instanceof Error ? error.message : "Failed to create session.");
      } finally {
        splitSessionInFlightRef.current = false;
      }
    },
    [clearSessionFromUiState, ensureChatKey, recordSpawnArgs],
  );

  const closeTabGroup = useCallback(
    async (groupId: string) => {
      const group = workspaceRef.current.groups.find((candidate) => candidate.id === groupId);
      if (!group) {
        return;
      }
      const ids = sessionIdsInGroup(group);
      for (const sessionId of ids) {
        await closeSession(sessionId);
      }
    },
    [closeSession],
  );

  const handleInput = useCallback(async (sessionId: string, data: string) => {
    try {
      await ptyWrite(sessionId, data);
    } catch (error) {
      setSessionStatus((current) => ({ ...current, [sessionId]: "error" }));
      setRuntimeError(error instanceof Error ? error.message : "Failed to send terminal input.");
    }
  }, []);

  const submitAiChat = useCallback(
    async (sessionId: string, prompt: string, extraAttachments: AiContextAttachment[] = []) => {
      const trimmed = prompt.trim();
      if (trimmed.length === 0) {
        return;
      }
      openAiRail();
      const pending = aiPendingAttachments[sessionId] ?? [];
      const attachments = [...pending, ...extraAttachments];
      const priorMessages = aiChatState[sessionId] ?? [];
      const history = buildHistoryForExecute(
        priorMessages,
        trimmed,
        routing.ai_context_budget_chars,
      );
      appendUserChatMessage(sessionId, trimmed, attachments);
      if (pending.length > 0) {
        setAiPendingAttachments((current) => {
          if (!(sessionId in current) || (current[sessionId]?.length ?? 0) === 0) {
            return current;
          }
          const next = { ...current };
          delete next[sessionId];
          return next;
        });
      }
      if (aiBehaviorSettings.echoAiPromptToTape) {
        const echo = shellEchoCommandForAiPrompt(trimmed);
        if (echo) {
          void handleInput(sessionId, `${echo}\r`);
        }
      }
      const scrollbackExcerpt = trimAiContextExcerpt(sessionBufferStore.get(sessionId));
      const attachmentBlock =
        attachments.length > 0 ? attachmentBlockForContext(attachments) : undefined;
      const output_excerpt = mergeOutputExcerpts(scrollbackExcerpt, attachmentBlock);
      await runAiPromptWithText(trimmed, {
        sessionId,
        history,
        contextExtras: output_excerpt ? { output_excerpt } : undefined,
      });
    },
    [
      aiBehaviorSettings.echoAiPromptToTape,
      aiChatState,
      aiPendingAttachments,
      appendUserChatMessage,
      handleInput,
      openAiRail,
      routing.ai_context_budget_chars,
      runAiPromptWithText,
    ],
  );

  const askAboutCommandFailure = useCallback(
    (sessionId: string) => {
      const failure = sessionCommandFailures[sessionId];
      if (!failure) {
        return;
      }
      const runs = runLedger[sessionId] ?? [];
      const lastRun = runs.length > 0 ? runs[runs.length - 1] : undefined;
      const excerpt = failureOutputExcerpt(sessionBufferStore.get(sessionId), lastRun);
      const question = buildFailureAiQuestion(failure, excerpt);
      void submitAiChat(sessionId, question);
    },
    [runLedger, sessionCommandFailures, submitAiChat],
  );

  const handleResize = useCallback(async (sessionId: string, cols: number, rows: number) => {
    if (!sessionsRef.current.some((session) => session.id === sessionId)) {
      return;
    }
    const now = Date.now();
    const lastResize = resizeThrottleRef.current[sessionId] ?? 0;
    if (now - lastResize < RESIZE_THROTTLE_MS) {
      return;
    }
    resizeThrottleRef.current[sessionId] = now;
    try {
      await ptyResize(sessionId, cols, rows);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to resize terminal session.";
      if (message.includes("does not exist")) {
        return;
      }
      setRuntimeError(message);
    }
  }, []);

  const refreshHistory = useCallback(async () => {
    setHistoryLoading(true);
    setHistoryError(null);
    try {
      const entries = await historyQuery({ limit: HISTORY_UI_LIMIT });
      setHistoryEntries(entries);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to load command history.";
      setRuntimeError(message);
      setHistoryError(message);
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  const refreshRuntimeMetrics = useCallback(async () => {
    try {
      const snapshot = await runtimeMetricsSnapshot();
      setRuntimeMetrics(snapshot);
    } catch (error) {
      setRuntimeError(error instanceof Error ? error.message : "Failed to refresh runtime metrics.");
    }
  }, []);

  useEffect(() => {
    if (!settingsModalOpen) {
      return;
    }
    void refreshRuntimeMetrics();
    void refreshHistory();
  }, [settingsModalOpen, refreshRuntimeMetrics, refreshHistory]);

  const refreshDiagnostics = useCallback(async () => {
    setDiagnosticsLoading(true);
    setDiagnosticsError(null);
    setDiagnosticsCopyStatus(null);
    try {
      const [runtime, settingsSchema] = await Promise.all([
        runtimeDebugSnapshot(),
        settingsSchemaDump().catch(() => null),
      ]);
      const payload = { runtime, settings_schema: settingsSchema };
      setDiagnosticsJson(JSON.stringify(payload, null, 2));
    } catch (error) {
      setDiagnosticsJson(null);
      setDiagnosticsError(
        error instanceof Error ? error.message : "Diagnostics failed (requires debug Tauri build for snapshot APIs).",
      );
    } finally {
      setDiagnosticsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!diagnosticsOpen) {
      return;
    }
    void refreshDiagnostics();
  }, [diagnosticsOpen, refreshDiagnostics]);

  const replayCommand = useCallback(
    async (command: string) => {
      if (!activeSession) {
        return;
      }
      setHistoryActionStatus("Replaying command in active session...");
      try {
        await historyReplay(activeSession.id, command);
        setHistoryActionStatus("Replay submitted to active session.");
      } catch (error) {
        setRuntimeError(error instanceof Error ? error.message : "Failed to replay command.");
        setHistoryActionStatus("Replay failed.");
      }
    },
    [activeSession],
  );

  const runPluginDemo = useCallback(async () => {
    try {
      const grantDecision = await pluginGrantCapability({
        pluginId: "history-tools",
        capability: "command-history.read",
      });
      const result = await pluginExecute({
        pluginId: "history-tools",
        capability: "command-history.read",
        payload: "{\"scope\":\"active\"}",
      });
      const [metrics, grants] = await Promise.all([pluginMetricsSnapshot(), pluginGrantsSnapshot()]);
      setPluginPolicyDecision(
        `${grantDecision.accepted ? "grant allowed" : "grant denied"} [${grantDecision.reasonCode}]: ${grantDecision.message}`,
      );
      setPluginGrantSummary(
        `grants: ${grants.length} plugin(s), ${
          grants.find((entry) => entry.pluginId === "history-tools")?.capabilities.length ?? 0
        } capability grant(s) for history-tools`,
      );
      setPluginTelemetry(metrics);
      setPluginResult(
        `${result.accepted ? "allowed" : "denied"} [${result.reason_code}]: ${result.message}`,
      );
    } catch (error) {
      setPluginPolicyDecision(null);
      setPluginGrantSummary(null);
      setPluginTelemetry(null);
      setPluginResult(error instanceof Error ? error.message : "Plugin execution failed.");
    }
  }, []);

  const handleSetupSaved = useCallback(async () => {
    const [providerDescriptors, providerRouting, profile] = await Promise.all([
      providerList(),
      providerRoutingGet(),
      profileGet(),
    ]);
    initializeProviderAiState(providerDescriptors, providerRouting);
    setTerminalFontSize(profile.font_size);
    setMinimalShellPrompt(profile.minimal_shell_prompt ?? false);
    setShowComposerAssistMetrics(profile.show_composer_assist_metrics ?? false);
    cachedProfileRef.current = profile;
  }, [initializeProviderAiState]);

  const setMinimalShellPromptPreference = useCallback(async (enabled: boolean) => {
    try {
      const updated = await profilePatch({ minimal_shell_prompt: enabled });
      cachedProfileRef.current = updated;
      setMinimalShellPrompt(updated.minimal_shell_prompt ?? enabled);
    } catch (error) {
      setRuntimeError(error instanceof Error ? error.message : "Failed to update profile.");
    }
  }, []);

  const setShowComposerAssistMetricsPreference = useCallback(async (enabled: boolean) => {
    try {
      const updated = await profilePatch({ show_composer_assist_metrics: enabled });
      cachedProfileRef.current = updated;
      setShowComposerAssistMetrics(updated.show_composer_assist_metrics ?? enabled);
    } catch (error) {
      setRuntimeError(error instanceof Error ? error.message : "Failed to update profile.");
    }
  }, []);

  const checkForUpdates = useCallback(async () => {
    if (!UPDATER_ENABLED) {
      setUpdateStatus("disabled (build flag)");
      return;
    }
    try {
      setUpdateStatus("checking");
      const update = await check();
      if (!update) {
        setUpdateStatus("up-to-date");
        return;
      }
      setUpdateStatus(`downloading ${update.version}`);
      await update.downloadAndInstall();
      setUpdateStatus(`installed ${update.version} (restart required)`);
    } catch (error) {
      setUpdateStatus(error instanceof Error ? error.message : "update check failed");
    }
  }, []);

  const splitPane = useCallback(async () => {
    await createSessionInNewPane("column");
  }, [createSessionInNewPane]);

  const splitPaneRow = useCallback(async () => {
    await createSessionInNewPane("row");
  }, [createSessionInNewPane]);

  const splitPaneColumn = useCallback(async () => {
    await createSessionInNewPane("column");
  }, [createSessionInNewPane]);

  const closePaneById = useCallback(
    async (paneId: string) => {
      let sessionId: string | null = null;
      let paneCount = 1;
      let activeGroupId = "";
      let groupCount = 1;

      setWorkspace((current) => {
        const layout = activeGroupLayout(current);
        sessionId = sessionIdForPane(layout, paneId);
        paneCount = layout.panes.length;
        activeGroupId = current.activeGroupId;
        groupCount = current.groups.length;
        if (paneCount <= 1) {
          return current;
        }
        const next = closePane(current, paneId);
        workspaceRef.current = next;
        return next;
      });

      if (sessionId) {
        await closeSession(sessionId);
        return;
      }

      if (paneCount <= 1 && groupCount > 1) {
        await closeTabGroup(activeGroupId);
      }
    },
    [closeSession, closeTabGroup],
  );

  const closeSessionAfterShellExit = useCallback(
    async (sessionId: string) => {
      const host = findSessionPaneHost(workspaceRef.current, sessionId);
      if (!host) {
        return;
      }
      if (host.paneCount > 1) {
        await closePaneById(host.paneId);
        return;
      }
      await closeTabGroup(host.groupId);
    },
    [closePaneById, closeTabGroup],
  );

  const closePaneForSession = useCallback(
    async (sessionId: string) => {
      await closeSessionAfterShellExit(sessionId);
    },
    [closeSessionAfterShellExit],
  );

  const closeComposerTargetPane = useCallback(async () => {
    const layout = activeGroupLayout(workspaceRef.current);
    const targetPane = layout.panes.find((pane) => pane.id === layout.targetPaneId);
    if (!targetPane?.sessionId) {
      return;
    }
    await closeSessionAfterShellExit(targetPane.sessionId);
  }, [closeSessionAfterShellExit]);

  const closePanesForBroadcastExit = useCallback(
    async (sessionIds: readonly string[]) => {
      const paneIds: string[] = [];
      setWorkspace((current) => {
        const seen = new Set<string>();
        for (const sessionId of sessionIds) {
          const host = findSessionPaneHost(current, sessionId);
          if (host && host.paneCount > 1 && !seen.has(host.paneId)) {
            seen.add(host.paneId);
            paneIds.push(host.paneId);
          }
        }
        return current;
      });
      for (const paneId of paneIds) {
        await closePaneById(paneId);
      }
    },
    [closePaneById],
  );

  const handleTerminalInput = useCallback(
    async (sessionId: string, data: string) => {
      const tracked = appendTerminalInputLine(sessionCommandLineRef.current[sessionId] ?? "", data);
      sessionCommandLineRef.current[sessionId] = tracked.line;
      try {
        await handleInput(sessionId, data);
      } finally {
        if (tracked.submitted && isShellExitCommand(tracked.submitted)) {
          await closePaneForSession(sessionId);
        }
      }
    },
    [closePaneForSession, handleInput],
  );

  useEffect(() => {
    closePaneByIdRef.current = closePaneById;
    closeTabGroupRef.current = closeTabGroup;
  }, [closePaneById, closeTabGroup]);

  const closeActivePane = useCallback(async () => {
    let paneId: string | null = null;
    setWorkspace((current) => {
      paneId = activeGroupLayout(current).activePaneId;
      return current;
    });
    if (paneId) {
      await closePaneById(paneId);
    }
  }, [closePaneById]);

  const dispatchTerminalUiRequest = useCallback((payload: Omit<TerminalUiRequest, "seq">) => {
    terminalUiSeqRef.current += 1;
    setTerminalUiRequest({ ...payload, seq: terminalUiSeqRef.current } as TerminalUiRequest);
  }, []);

  const restartSessionById = useCallback(
    async (sessionId: string) => {
      // Activate the pane that hosts `sessionId` up-front (synchronous functional
      // setState read) so `createSessionAt` lands in the same pane slot. We fall
      // back to the current active pane when no pane hosts the id.
      setWorkspace((current) => selectSessionInWorkspace(current, sessionId));
      // Snapshot the live cwd *before* `closeSession` clears it. Fall back to
      // whatever cwd the backend recorded on the session itself (profile default
      // at spawn time) so shells without an OSC 7 hook still behave exactly as
      // they did before this tranche.
      const fallbackCwd = sessionsById[sessionId]?.cwd ?? null;
      const restartCwd = getRestartCwd(sessionCwd, sessionId, fallbackCwd);
      await closeSession(sessionId);
      setSessionExited((current) => clearExitedInfo(current, sessionId));
      await createSessionAt(restartCwd);
    },
    [closeSession, createSessionAt, sessionCwd, sessionsById],
  );

  const restartActiveSession = useCallback(async () => {
    if (!activeSession) {
      return;
    }
    await restartSessionById(activeSession.id);
  }, [activeSession, restartSessionById]);

  const closeActiveSession = useCallback(async () => {
    if (!activeSession) {
      return;
    }
    const sid = activeSession.id;
    await closeSession(sid);
    setSessionExited((current) => clearExitedInfo(current, sid));
  }, [activeSession, closeSession]);

  const closeAllExited = useCallback(async () => {
    const targets = collectExitedSessionIds(
      sessionExited,
      sessions.map((session) => session.id),
    );
    for (const sid of targets) {
      await closeSession(sid);
    }
  }, [closeSession, sessionExited, sessions]);

  const restartAllExited = useCallback(async () => {
    const targets = collectExitedSessionIds(
      sessionExited,
      sessions.map((session) => session.id),
    );
    for (const sid of targets) {
      await restartSessionById(sid);
    }
  }, [restartSessionById, sessionExited, sessions]);

  const executeCommand = useCallback(
    async (commandId: AppCommandId | string) => {
      const presetId = parseShellPresetPaletteId(String(commandId));
      if (presetId) {
        const preset = shellPresets.find((entry) => entry.id === presetId);
        if (preset) {
          await createSessionAt(preset.cwd ?? null, {
            shell: preset.shell,
            args: preset.args,
            env: preset.env,
          });
        }
        return;
      }
      const shellCandidateId = parseShellCandidatePaletteId(String(commandId));
      if (shellCandidateId) {
        const candidate = detectedShells.find((entry) => entry.id === shellCandidateId);
        if (candidate?.available) {
          await createSessionAt(null, { shell: candidate.shell, args: candidate.args });
        }
        return;
      }
      const paneCmd = paneIndexFromCommand(String(commandId));
      if (paneCmd) {
        setWorkspace((current) => {
          const layout = activeGroupLayout(current);
          const pane = layout.panes[paneCmd.index - 1];
          if (!pane) {
            return current;
          }
          return paneCmd.mode === "focus"
            ? setActivePane(current, pane.id)
            : setTargetPane(current, pane.id);
        });
        if (paneCmd.mode === "target") {
          queueMicrotask(() => focusGroupComposerRef.current?.());
        }
        return;
      }
      const terminalIntent = commandToTerminalUiIntent(commandId as AppCommandId);
      if (terminalIntent) {
        if (activeSessionId) {
          setSessionUiSurface((current) => {
            const baseline = current[activeSessionId] ?? DEFAULT_UI_SURFACE_STATE;
            const nextState =
              terminalIntent === "jumpSearch"
                ? baseline
                : reduceUiSurfaceStateForRequest(baseline, { kind: terminalIntent });
            return { ...current, [activeSessionId]: nextState };
          });
        }
        dispatchTerminalUiRequest({ kind: terminalIntent });
        return;
      }
      switch (commandId) {
        case "session.new":
          await createSession();
          break;
        case "session.newWithProfile":
          openNewTabPicker();
          break;
        case "session.rename":
          if (activeSessionId) {
            setRenameRequestSessionId(activeSessionId);
          }
          break;
        case "session.restart":
          await restartActiveSession();
          break;
        case "session.close":
          await closeActiveSession();
          break;
        case "sessions.closeAllExited":
          await closeAllExited();
          break;
        case "sessions.restartAllExited":
          await restartAllExited();
          break;
        case "pane.split":
          await splitPane();
          break;
        case "pane.split.column":
          await splitPaneColumn();
          break;
        case "pane.split.row":
          await splitPaneRow();
          break;
        case "pane.close":
          await closeActivePane();
          break;
        case "pane.broadcast":
          setWorkspace((current) => toggleBroadcastOnce(current));
          break;
        case "pane.broadcastSticky":
          setWorkspace((current) => armBroadcastSticky(current));
          break;
        case "pane.broadcastDisarm":
          setWorkspace((current) => setBroadcastMode(current, "off"));
          break;
        case "palette.toggle":
          setPaletteOpen((current) => !current);
          break;
        case "input.cycleMode":
          cycleActiveInputMode();
          break;
        case "history.refresh":
          await refreshHistory();
          await refreshRuntimeMetrics();
          break;
        case "ai.explainSelection":
          if (aiAssistEnabled && historyEntries.length > 0) {
            await explainCommand(historyEntries[0].command);
          }
          break;
        case "ai.explainComposerDraft": {
          const draft = composerDraftRef.current.trim();
          if (aiAssistEnabled && draft) {
            await explainCommand(draft);
          }
          break;
        }
        case "ai.fixComposerDraft": {
          const draft = composerDraftRef.current.trim();
          if (aiAssistEnabled && draft) {
            await fixCommand(draft);
          }
          break;
        }
        case "dev.diagnostics":
          setDiagnosticsOpen(true);
          break;
        case "ops.toggleRail":
          setOpsRailCollapsed((current) => !current);
          break;
        case "ops.selectNextRun":
          setOpsSelectedRunId((prev) => stepRunSelection(filteredRunsForOps, prev, 1));
          break;
        case "ops.selectPrevRun":
          setOpsSelectedRunId((prev) => stepRunSelection(filteredRunsForOps, prev, -1));
          break;
        case "ops.jumpSelectedRun": {
          const run = filteredRunsForOps.find((r) => r.id === opsSelectedRunId);
          if (run) {
            handleJumpRun(run);
          }
          break;
        }
      }
    },
    [
      activeSessionId,
      closeActivePane,
      closePaneById,
      closeActiveSession,
      closeAllExited,
      createSession,
      createSessionAt,
      cycleActiveInputMode,
      openNewTabPicker,
      detectedShells,
      shellPresets,
      dispatchTerminalUiRequest,
      explainCommand,
      fixCommand,
      filteredRunsForOps,
      handleJumpRun,
      historyEntries,
      opsSelectedRunId,
      refreshHistory,
      refreshRuntimeMetrics,
      restartActiveSession,
      restartAllExited,
      splitPane,
      splitPaneColumn,
      splitPaneRow,
      aiAssistEnabled,
    ],
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isInputModeCycleChord(event)) {
        event.preventDefault();
        event.stopPropagation();
        cycleActiveInputMode();
        return;
      }
      const target = event.target as HTMLElement | null;
      const binding = DEFAULT_KEYMAP.find((candidate) => matchShortcut(event, candidate));
      if (!binding) {
        return;
      }
      if (shouldBlockWorkspaceShortcut(target) && !shortcutAllowedInTextField(binding.command)) {
        return;
      }
      event.preventDefault();
      void executeCommand(binding.command);
    };

    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [cycleActiveInputMode, executeCommand]);

  const commandPaletteItems = useMemo(() => {
    const baseCommands = import.meta.env.DEV ? [...APP_COMMANDS, ...DEV_PALETTE_COMMANDS] : APP_COMMANDS;
    const presetCommands = shellPresets.map((preset) => ({
      id: shellPresetPaletteId(preset.id),
      label: `Open shell: ${preset.name}`,
      description: shellPresetDescription(preset),
    }));
    const shellCommands = detectedShells
      .filter((candidate) => candidate.available)
      .map((candidate) => ({
        id: shellCandidatePaletteId(candidate.id),
        label: `Open shell: ${candidate.label}`,
        description: formatShellCommandPreview(candidate.shell, candidate.args),
      }));
    const commands = [...baseCommands, ...presetCommands, ...shellCommands];
    return commands
      .filter((command) => {
        if (
          command.id === "ai.explainSelection" ||
          command.id === "ai.explainComposerDraft" ||
          command.id === "ai.fixComposerDraft"
        ) {
          return aiAssistEnabled;
        }
        return true;
      })
      .map((command) => {
        const matchingBinding = DEFAULT_KEYMAP.find((binding) => binding.command === command.id);
        const commandShortcut = "shortcut" in command ? command.shortcut : undefined;
        return {
          ...command,
          shortcut: commandShortcut ?? (matchingBinding ? formatShortcut(matchingBinding) : undefined),
        };
      });
  }, [aiAssistEnabled, detectedShells, shellPresets]);

  const globalShortcutItems = useMemo(
    () => commandPaletteItems.filter((command) => DEFAULT_KEYMAP.some((binding) => binding.command === command.id)),
    [commandPaletteItems],
  );

  const terminalCommandItems = useMemo(
    () => commandPaletteItems.filter((command) => command.id.startsWith("terminal.")),
    [commandPaletteItems],
  );

  const activeAiMessages = activeSessionId ? aiChatState[activeSessionId] ?? [] : [];
  const activeAiPendingAttachments = activeSessionId ? aiPendingAttachments[activeSessionId] ?? [] : [];

  const runAiPromptToChat = useCallback(async () => {
    if (!activeSessionId) {
      await runAiPrompt();
      return;
    }
    const trimmed = aiPrompt.trim();
    if (trimmed.length === 0) {
      return;
    }
    await submitAiChat(activeSessionId, trimmed);
  }, [activeSessionId, aiPrompt, runAiPrompt, submitAiChat]);

  const requestComposerCompletion = useCallback(
    async (request: {
      draft: string;
      cursor: number;
      cwd?: string;
      shell?: string;
      sessionId?: string;
    }) => {
      return composerComplete({
        ...request,
        limit: 60,
      });
    },
    [],
  );

  const activeInputMode = activeSessionId
    ? (sessionInputModes[activeSessionId] ?? defaultSessionInputMode())
    : defaultSessionInputMode();
  const showGroupComposer = Boolean(activeSessionId) && inputModeUsesComposer(activeInputMode);
  const targetSessionIdForComposer = sessionIdForPane(activeLayout, activeLayout.targetPaneId);

  const groupComposer = useGroupComposer({
    groupId: workspace.activeGroupId,
    panes: activeLayout.panes,
    activePaneId: activeLayout.activePaneId,
    targetPaneId: activeLayout.targetPaneId,
    broadcastMode: activeLayout.broadcastMode,
    sessionsById,
    tabLabels,
    sessionInputModes,
    composerSubmitKinds,
    commandFailure: targetSessionIdForComposer
      ? (sessionCommandFailures[targetSessionIdForComposer] ?? null)
      : null,
    historyEntries,
    aiAssistEnabled,
    onComposerDraftChange: (draft) => {
      composerDraftRef.current = draft;
    },
    onToggleComposerSubmitKind: toggleComposerSubmitKindForSession,
    onAskAboutFailure: askAboutCommandFailure,
    onAiComposerSubmit: (sessionId, text) => void submitAiChat(sessionId, text),
    onSubmitToPty: (sessionIds, payload) => {
      for (const sessionId of sessionIds) {
        void handleInput(sessionId, payload);
      }
    },
    onShellExitSubmitted: () => {
      void closeComposerTargetPane();
    },
    onShellExitBroadcast: (sessionIds) => {
      void closePanesForBroadcastExit(sessionIds);
    },
    onRequestComposerCompletion: requestComposerCompletion,
    onBroadcastConsumed: () => {
      setWorkspace((current) => setBroadcastMode(current, "off"));
    },
  });

  useEffect(() => {
    focusGroupComposerRef.current = groupComposer.focusComposerInput;
  }, [groupComposer.focusComposerInput]);

  // Applies a queued `machterm://composer` deep link once the composer is usable (an
  // operator-mode session active) AND empty. Mirrors the `pendingAiNote` queue above so a
  // cold start or a locked composer waits rather than dropping the handoff (see
  // docs/deep-link-contract.md); the empty-draft check additionally avoids silently
  // clobbering a command the user is already mid-typing. Only ever populates the draft —
  // the user still has to review it and press Enter, same "never auto-submit" rule as the
  // AI-note attachment.
  useEffect(() => {
    if (!canApplyPendingComposerText(pendingComposerText, groupComposer.composerLocked, groupComposer.composerDraft)) {
      return;
    }
    groupComposer.setComposerDraft(pendingComposerText.text);
    groupComposer.focusComposerInput();
    setPendingComposerText(null);
  }, [
    pendingComposerText,
    groupComposer.composerLocked,
    groupComposer.composerDraft,
    groupComposer.setComposerDraft,
    groupComposer.focusComposerInput,
  ]);

  useWorkspaceFocus({
    activeGroupId: workspace.activeGroupId,
    activePaneId: activeLayout.activePaneId,
    activeSessionId,
    sessionInputModes,
    focusGroupComposer: () => focusGroupComposerRef.current?.(),
  });

  const handleGroupComposerKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (groupComposer.isComposerAiToggleKey(event)) {
        event.preventDefault();
        groupComposer.onToggleComposerSubmitKind?.();
        return;
      }
      if (
        aiAssistEnabled &&
        groupComposer.isAskFailureShortcut(
          event,
          groupComposer.composerDraft.trim().length === 0,
          Boolean(groupComposer.commandFailure),
        ) &&
        groupComposer.onAskAboutFailure
      ) {
        event.preventDefault();
        groupComposer.onAskAboutFailure();
        return;
      }
      if (event.key === "ArrowUp" && !event.shiftKey && !event.ctrlKey && !event.altKey && !event.metaKey) {
        event.preventDefault();
        groupComposer.stepComposerHistory("prev");
        return;
      }
      if (event.key === "ArrowDown" && !event.shiftKey && !event.ctrlKey && !event.altKey && !event.metaKey) {
        event.preventDefault();
        groupComposer.stepComposerHistory("next");
        return;
      }
      if (event.key === "Tab" && groupComposer.composerSubmitKind !== "ai") {
        event.preventDefault();
        void groupComposer.requestComposerCompletion();
        return;
      }
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        groupComposer.submitComposer();
      }
    },
    [aiAssistEnabled, groupComposer],
  );

  return (
    <div className="app-frame">
      <CustomTitleBar
        onOpenSettings={() => openSettings()}
        onOpenDiagnostics={() => setDiagnosticsOpen(true)}
        showDiagnostics={import.meta.env.DEV}
        tabs={
          <TabBar
            groups={tabBarGroups}
            onSelect={(groupId) =>
              setWorkspace((current) => {
                const next = selectTabGroup(current, groupId);
                workspaceRef.current = next;
                return next;
              })
            }
            onCreate={() => void createSession()}
            onCreateWithProfile={() => openNewTabPicker()}
            onClose={(groupId) => void closeTabGroup(groupId)}
            onRestartSession={(sessionId) => void restartSessionById(sessionId)}
            onRename={renameSession}
            renameRequestSessionId={renameRequestSessionId}
            onRenameRequestHandled={handleRenameRequestHandled}
          />
        }
      />
      <main className="app-shell">
        {transientRuntimeError ? <p className="runtime-toast">{transientRuntimeError}</p> : null}
        {recoveryBanner ? <p className="runtime-toast recovery-banner">{recoveryBanner}</p> : null}
        {runtimeError ? (
          <div className="runtime-error-strip" role="status">
            <span>{runtimeError}</span>
            <button type="button" className="inline-btn ghost" onClick={() => setRuntimeError(null)}>
              Dismiss
            </button>
            <button type="button" className="inline-btn ghost" onClick={() => openSettings()}>
              Open settings
            </button>
          </div>
        ) : null}

        <section className="terminal-surface">
          <div className={`terminal-workspace-split${opsRailCollapsed ? " ops-rail-window-collapsed" : ""}`}>
          <section className="terminal-stack">
          <SplitWorkspace
            layout={activeLayout}
            sessionsById={sessionsById}
            sessionStatuses={sessionStatus}
            sessionMessages={sessionMessages}
            sessionExited={sessionExited}
            sessionCwd={sessionCwd}
            terminalFontSize={terminalFontSize}
            terminalUiRequest={terminalUiRequest}
            showComposerAssistMetrics={showComposerAssistMetrics}
            sessionOsc133Hints={sessionOsc133Hints}
            sessionUiSurface={sessionUiSurface}
            sessionInputModes={sessionInputModes}
            composerSubmitKinds={composerSubmitKinds}
            sessionCommandFailures={sessionCommandFailures}
            aiAssistEnabled={aiAssistEnabled}
            groupComposerActive={showGroupComposer}
            onAskAiSelection={queueAiSelection}
            onInput={(sessionId, data) => {
              void handleTerminalInput(sessionId, data);
            }}
            onResize={(sessionId, cols, rows) => void handleResize(sessionId, cols, rows)}
            onFocusPane={(paneId) => setWorkspace((current) => setActivePane(current, paneId))}
            onUiSurfaceStateChange={(sessionId, patch) => updateSessionUiSurfaceState(sessionId, patch)}
            onSplitRatioChange={(branchId, ratio) =>
              setWorkspace((current) => setSplitRatioOnWorkspace(current, branchId, ratio))
            }
            onResizeDragEnd={() => window.dispatchEvent(new Event("resize"))}
            onRequestRestartSession={(paneId) => {
              const sid = sessionIdForPane(activeLayout, paneId);
              if (!sid) {
                return;
              }
              void restartSessionById(sid);
            }}
            onRequestCloseSession={(paneId) => {
              void closePaneById(paneId);
            }}
          />
          <GroupComposer
            visible={showGroupComposer}
            composerDraft={groupComposer.composerDraft}
            setComposerDraft={groupComposer.setComposerDraft}
            composerTextareaRef={groupComposer.composerTextareaRef}
            composerLocked={groupComposer.composerLocked}
            inputMode={groupComposer.inputMode}
            composerSubmitKind={groupComposer.composerSubmitKind}
            composerPlaceholder={groupComposer.composerPlaceholder}
            commandFailure={groupComposer.commandFailure}
            prediction={groupComposer.prediction}
            completionState={groupComposer.completionState}
            completionMetricsTick={groupComposer.completionMetricsTick}
            completionMetricsRef={groupComposer.completionMetricsRef}
            showComposerAssistMetrics={showComposerAssistMetrics}
            aiAssistEnabled={aiAssistEnabled}
            broadcastMode={activeLayout.broadcastMode}
            panePills={groupComposer.panePills}
            liveCwd={
              targetSessionIdForComposer
                ? (sessionCwd[targetSessionIdForComposer] ?? sessionsById[targetSessionIdForComposer]?.cwd ?? null)
                : null
            }
            shellExe={targetSessionIdForComposer ? (sessionsById[targetSessionIdForComposer]?.shell ?? null) : null}
            osc133Hint={
              targetSessionIdForComposer ? (sessionOsc133Hints[targetSessionIdForComposer] ?? null) : null
            }
            onToggleComposerSubmitKind={groupComposer.onToggleComposerSubmitKind}
            onAskAboutFailure={groupComposer.onAskAboutFailure}
            onAiExplainComposer={() => {
              const draft = composerDraftRef.current.trim();
              if (draft) {
                void explainCommandToChat(draft);
              }
            }}
            onAiFixComposer={() => {
              const draft = composerDraftRef.current.trim();
              if (draft) {
                void fixCommandToChat(draft);
              }
            }}
            onToggleBroadcast={() => setWorkspace((current) => toggleBroadcastOnce(current))}
            onArmBroadcastSticky={() => setWorkspace((current) => armBroadcastSticky(current))}
            onSelectPanePill={(paneId) => setWorkspace((current) => setTargetPane(current, paneId))}
            onKeyDown={handleGroupComposerKeyDown}
          />
          </section>
          {!opsRailCollapsed ? (
            <OpsRailResizeHandle width={opsRailWidth} onWidthChange={handleOpsRailWidthChange} />
          ) : null}
          <OpsRail
            collapsed={opsRailCollapsed}
            width={opsRailCollapsed ? undefined : opsRailWidth}
            onToggleCollapsed={() => setOpsRailCollapsed((current) => !current)}
            activeTab={sideRailTab}
            onTabChange={setSideRailTab}
            filter={opsFilter}
            onFilterChange={setOpsFilter}
            entries={filteredRunsForOps}
            selectedRunId={opsSelectedRunId}
            onSelectRun={setOpsSelectedRunId}
            onTogglePin={handleOpsTogglePin}
            onJump={handleJumpRun}
            aiAssistEnabled={aiAssistEnabled}
            aiBusy={aiRequestInFlight}
            onExplainEntry={(command) => void explainCommandToChat(command)}
            onFixEntry={(command) => void fixCommandToChat(command)}
            aiMessages={activeAiMessages}
            aiStatusLine={aiRequestStatus}
            aiPendingAttachments={activeAiPendingAttachments}
            onRemoveAiAttachment={(attachmentId) => {
              if (!activeSessionId) {
                return;
              }
              setAiPendingAttachments((current) => {
                const list = current[activeSessionId];
                if (!list) {
                  return current;
                }
                const nextList = list.filter((attachment) => attachment.id !== attachmentId);
                if (nextList.length === list.length) {
                  return current;
                }
                if (nextList.length === 0) {
                  const next = { ...current };
                  delete next[activeSessionId];
                  return next;
                }
                return { ...current, [activeSessionId]: nextList };
              });
            }}
            onAiChatSubmit={(text) => {
              if (!activeSessionId) {
                return;
              }
              void submitAiChat(activeSessionId, text);
            }}
            onOpenAiSettings={() => openSettings(SETTINGS_SECTION_AI_PROVIDERS)}
          />
          </div>
        </section>

        <AppSettingsModal
          open={settingsModalOpen}
          initialSectionId={settingsInitialSection}
          onClose={() => {
            setSettingsModalOpen(false);
            setSettingsInitialSection(undefined);
          }}
          onOpenProfile={() => {
            setSettingsModalOpen(false);
            setFirstRunModalOpen(true);
          }}
          onRefreshMetrics={refreshRuntimeMetrics}
          capabilities={capabilities}
          runtimeError={runtimeError}
          runtimeMetrics={runtimeMetrics}
          providers={providers}
          providerConfigStatus={providerConfigStatus}
          providerEndpointDrafts={providerEndpointDrafts}
          providerApiKeyDrafts={providerApiKeyDrafts}
          updateProviderEndpointDraft={updateProviderEndpointDraft}
          updateProviderApiKeyDraft={updateProviderApiKeyDraft}
          toggleProvider={toggleProvider}
          saveProviderEndpoint={saveProviderEndpoint}
          saveProviderApiKey={saveProviderApiKey}
          clearProviderApiKey={clearProviderApiKey}
          activeSession={activeSession}
          sessionStatus={sessionStatus}
          restartActiveSession={restartActiveSession}
          splitPane={splitPane}
          splitPaneColumn={splitPaneColumn}
          splitPaneRow={splitPaneRow}
          closeActivePane={closeActivePane}
          onOpenCommandPalette={() => setPaletteOpen(true)}
          onToggleFollowOutput={() => void executeCommand("terminal.toggleFollowOutput")}
          onOpenTerminalFind={() => void executeCommand("terminal.openFind")}
          onFindNextMatch={() => void executeCommand("terminal.findNext")}
          onFindPreviousMatch={() => void executeCommand("terminal.findPrevious")}
          uiSurfaceState={activeUiSurfaceState}
          workspaceSplitDirection={activeLayout.splitDirection}
          checkForUpdates={checkForUpdates}
          updateStatus={updateStatus}
          updaterEnabled={UPDATER_ENABLED}
          routing={routing}
          routingDraft={routingDraft}
          setRoutingDraft={setRoutingDraft}
          saveRoutingConfig={saveRoutingConfig}
          setAiOptIn={setAiOptIn}
          aiPrompt={aiPrompt}
          setAiPrompt={setAiPrompt}
          runAiPrompt={runAiPromptToChat}
          aiRequestInFlight={aiRequestInFlight}
          aiRequestStatus={aiRequestStatus}
          aiResponse={aiResponse}
          lastAiContext={lastAiContext}
          historyEntries={historyEntries}
          historyLoading={historyLoading}
          historyError={historyError}
          historyActionStatus={historyActionStatus}
          onReplayCommand={replayCommand}
          onExplainCommand={explainCommand}
          onFixCommand={fixCommand}
          globalShortcutItems={globalShortcutItems}
          terminalCommandItems={terminalCommandItems}
          pluginResult={pluginResult}
          pluginPolicyDecision={pluginPolicyDecision}
          pluginGrantSummary={pluginGrantSummary}
          pluginTelemetry={pluginTelemetry}
          runPluginDemo={runPluginDemo}
          onProfileSaved={(savedProfile) => {
            cachedProfileRef.current = savedProfile;
            setTerminalFontSize(savedProfile.font_size);
            setMinimalShellPrompt(savedProfile.minimal_shell_prompt ?? false);
            setShowComposerAssistMetrics(savedProfile.show_composer_assist_metrics ?? false);
          }}
          onShellPresetsChanged={refreshShellPresets}
          minimalShellPrompt={minimalShellPrompt}
          onMinimalShellPromptChange={setMinimalShellPromptPreference}
          showComposerAssistMetrics={showComposerAssistMetrics}
          onShowComposerAssistMetricsChange={setShowComposerAssistMetricsPreference}
          echoAiPromptToTape={aiBehaviorSettings.echoAiPromptToTape}
          onEchoAiPromptToTapeChange={(enabled) => {
            const next = { ...aiBehaviorSettings, echoAiPromptToTape: enabled };
            setAiBehaviorSettings(next);
            saveAiBehaviorSettings(next);
          }}
          enableAiTools={aiBehaviorSettings.enableAiTools}
          onEnableAiToolsChange={(enabled) => {
            const next = { ...aiBehaviorSettings, enableAiTools: enabled };
            setAiBehaviorSettings(next);
            saveAiBehaviorSettings(next);
          }}
        />
        <CommandPalette
          open={paletteOpen}
          commands={commandPaletteItems}
          onClose={() => setPaletteOpen(false)}
          onRun={(commandId) => void executeCommand(commandId as AppCommandId)}
        />
        <FirstRunSetup
          open={firstRunModalOpen}
          onClose={() => setFirstRunModalOpen(false)}
          onSaved={handleSetupSaved}
          liveProviderSettings={{
            providers,
            routing,
            routingDraft,
            setRoutingDraft,
            providerConfigStatus,
            providerEndpointDrafts,
            providerApiKeyDrafts,
            updateProviderEndpointDraft,
            updateProviderApiKeyDraft,
            toggleProvider,
            saveProviderEndpoint,
            saveProviderApiKey,
            clearProviderApiKey,
            setAiOptIn,
            saveRoutingConfig,
          }}
        />
        <NewTabProfileModal
          open={newTabPickerOpen}
          onClose={() => setNewTabPickerOpen(false)}
          onConfirm={createSessionWithShell}
        />

        {diagnosticsOpen ? (
        <div
          className="modal-overlay"
          role="presentation"
          onClick={() => {
            setDiagnosticsOpen(false);
            setDiagnosticsCopyStatus(null);
          }}
        >
          <div
            className="modal-card diagnostics-modal"
            role="dialog"
            aria-labelledby="diagnostics-title"
            onClick={(event) => event.stopPropagation()}
          >
            <h2 id="diagnostics-title">Diagnostics</h2>
            <p className="muted-block">
              Vite dev UI + debug Tauri build only. Snapshot merges <code>runtime_debug_snapshot</code> and{" "}
              <code>settings_schema_dump</code> when available.
            </p>
            {diagnosticsError ? <p className="error-text">{diagnosticsError}</p> : null}
            {diagnosticsLoading ? <p className="muted-block">Loading…</p> : null}
            {diagnosticsJson ? (
              <pre className="diagnostics-json" tabIndex={0}>
                {diagnosticsJson}
              </pre>
            ) : null}
            <div className="modal-actions">
              <button type="button" className="inline-btn ghost" onClick={() => setDiagnosticsOpen(false)}>
                Close
              </button>
              <button type="button" className="inline-btn" onClick={() => void refreshDiagnostics()} disabled={diagnosticsLoading}>
                Refresh
              </button>
              <button
                type="button"
                className="inline-btn primary"
                disabled={!diagnosticsJson || diagnosticsLoading}
                onClick={async () => {
                  if (!diagnosticsJson) {
                    return;
                  }
                  try {
                    await navigator.clipboard.writeText(diagnosticsJson);
                    setDiagnosticsCopyStatus("Copied to clipboard.");
                  } catch {
                    setDiagnosticsCopyStatus("Copy failed — select text manually.");
                  }
                }}
              >
                Copy JSON
              </button>
            </div>
            {diagnosticsCopyStatus ? <p className="muted-block">{diagnosticsCopyStatus}</p> : null}
          </div>
        </div>
        ) : null}
      </main>
      {exitPersistPhase ? <ExitPersistOverlay phase={exitPersistPhase} /> : null}
    </div>
  );
}

export default App;
