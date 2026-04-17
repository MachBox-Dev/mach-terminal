import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { check } from "@tauri-apps/plugin-updater";
import "./App.css";
import { CommandPalette } from "./components/CommandPalette";
import { FirstRunSetup, ONBOARDING_STORAGE_KEY } from "./components/FirstRunSetup";
import { HistoryPanel } from "./components/HistoryPanel";
import { SplitWorkspace } from "./components/SplitWorkspace";
import { TabBar } from "./components/TabBar";
import { APP_COMMANDS, DEV_PALETTE_COMMANDS, type AppCommandId } from "./core/commands";
import {
  clearExitedInfo,
  deriveExitedInfo,
  pruneExitedForSessions,
  type SessionExitedInfo,
} from "./core/sessionLifecycle";
import {
  applyCwdChange,
  clearCwd,
  getRestartCwd,
  pruneCwdForSessions,
  type SessionCwdMap,
} from "./core/sessionCwd";
import { collectExitedSessionIds } from "./core/sessionTabStatus";
import { commandToTerminalUiIntent } from "./core/terminalCommandRouting";
import { canRunAiRequest, isExecutableProvider } from "./core/providerUiState";
import type { TerminalUiRequest } from "./core/terminalUiRequest";
import { DEFAULT_KEYMAP, formatShortcut, matchShortcut } from "./core/keymap";
import { drainChunksUpToByteBudget, nextSequenceState, SEQUENCE_LARGE_JUMP } from "./core/ptyOutputCoalesce";
import { PLUGIN_REGISTRY } from "./core/plugins";
import { DEFAULT_RUNTIME_CAPABILITIES, type RuntimeCapabilities } from "./core/runtime";
import {
  historyQuery,
  historyRecoveryTake,
  historyReplay,
  onAiContext,
  onPtyCwdChanged,
  onPtyLifecycle,
  onPtyOutput,
  pluginExecute,
  pluginGrantCapability,
  profileGet,
  providerList,
  providerRoutingGet,
  runtimeDebugSnapshot,
  runtimeMetricsSnapshot,
  settingsSchemaDump,
  ptyClose,
  ptyListSessions,
  ptyResize,
  ptySpawn,
  ptyWrite,
  type HistoryEntry,
  type PtyLifecycleEvent,
  type PtySessionInfo,
  type RuntimeMetricsSnapshot,
  type SessionStatus,
  runtimeCapabilities,
  workspaceLayoutGet,
  workspaceLayoutSet,
} from "./core/terminal";
import {
  closePane,
  createWorkspaceState,
  reconcileWorkspace,
  removeSessionFromWorkspace,
  restoreWorkspaceFromSnapshot,
  setActivePane,
  setPaneSession,
  setSplitDirection,
  snapshotWorkspace,
  splitActivePane,
  workspaceLayoutFromSnapshot,
  type WorkspaceSnapshot,
  type WorkspaceState,
} from "./state/workspace";
import { useProviderAiState } from "./hooks/useProviderAiState";

const MAX_SESSION_BUFFER = 120_000;
/** Max UTF-16 units applied to xterm per animation frame per session (remainder stays queued). */
const MAX_PTY_FLUSH_BYTES_PER_FRAME = 48_000;
const RESIZE_THROTTLE_MS = 100;
const WORKSPACE_STORAGE_KEY = "mach-terminal.workspace.v1";
const WORKSPACE_PERSIST_DEBOUNCE_MS = 320;

const UPDATER_ENABLED = import.meta.env.VITE_ENABLE_UPDATER === "true";

function appendBoundedOutput(previous: string, nextChunk: string): string {
  const combined = `${previous}${nextChunk}`;
  if (combined.length <= MAX_SESSION_BUFFER) {
    return combined;
  }
  return combined.slice(combined.length - MAX_SESSION_BUFFER);
}

function App() {
  const [capabilities, setCapabilities] = useState<RuntimeCapabilities>(DEFAULT_RUNTIME_CAPABILITIES);
  const [runtimeError, setRuntimeError] = useState<string | null>(null);
  const [transientRuntimeError, setTransientRuntimeError] = useState<string | null>(null);
  const [runtimeMetrics, setRuntimeMetrics] = useState<RuntimeMetricsSnapshot | null>(null);
  const [sessions, setSessions] = useState<PtySessionInfo[]>([]);
  const [workspace, setWorkspace] = useState<WorkspaceState>(createWorkspaceState);
  const [sessionBuffers, setSessionBuffers] = useState<Record<string, string>>({});
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
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [historyEntries, setHistoryEntries] = useState<HistoryEntry[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [historyActionStatus, setHistoryActionStatus] = useState<string | null>(null);
  const [pluginResult, setPluginResult] = useState<string | null>(null);
  const [updateStatus, setUpdateStatus] = useState<string>(UPDATER_ENABLED ? "idle" : "disabled (build flag)");
  const [setupModalOpen, setSetupModalOpen] = useState(false);
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);
  const [diagnosticsJson, setDiagnosticsJson] = useState<string | null>(null);
  const [diagnosticsLoading, setDiagnosticsLoading] = useState(false);
  const [diagnosticsError, setDiagnosticsError] = useState<string | null>(null);
  const [diagnosticsCopyStatus, setDiagnosticsCopyStatus] = useState<string | null>(null);
  const [recoveryBanner, setRecoveryBanner] = useState<string | null>(null);
  const [terminalFontSize, setTerminalFontSize] = useState(13);
  const terminalUiSeqRef = useRef(0);
  const [terminalUiRequest, setTerminalUiRequest] = useState<TerminalUiRequest | null>(null);
  const pendingOutputRef = useRef<Record<string, string[]>>({});
  const rafFlushRef = useRef<number | null>(null);
  const lastSequenceRef = useRef<Record<string, number>>({});
  const resizeThrottleRef = useRef<Record<string, number>>({});
  const layoutPersistBootstrappedRef = useRef(false);

  const sessionsById = useMemo(
    () =>
      sessions.reduce<Record<string, PtySessionInfo>>((lookup, session) => {
        lookup[session.id] = session;
        return lookup;
      }, {}),
    [sessions],
  );

  const activeSessionId = useMemo(() => {
    const activePane = workspace.panes.find((pane) => pane.id === workspace.activePaneId);
    return activePane?.sessionId ?? null;
  }, [workspace]);

  const activeSession = activeSessionId ? sessionsById[activeSessionId] : undefined;

  const {
    providers,
    routing,
    routingDraft,
    providerEndpointDrafts,
    providerConfigStatus,
    aiPrompt,
    aiResponse,
    aiRequestInFlight,
    aiRequestStatus,
    lastAiContext,
    initializeProviderAiState,
    setRoutingDraft,
    updateProviderEndpointDraft,
    setAiPrompt,
    setLastAiContext,
    toggleProvider,
    saveProviderEndpoint,
    saveRoutingConfig,
    setAiOptIn,
    runAiPrompt,
    explainCommand,
    fixCommand,
  } = useProviderAiState({
    activeSession,
    onRuntimeError: (message) => setRuntimeError(message),
    onHistoryActionStatus: (status) => setHistoryActionStatus(status),
  });

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const v = window.localStorage.getItem(ONBOARDING_STORAGE_KEY);
    if (v !== "done" && v !== "skipped") {
      setSetupModalOpen(true);
    }
  }, []);

  useEffect(() => {
    const loadCapabilities = async () => {
      setHistoryLoading(true);
      setHistoryError(null);
      try {
        const [runtime, providerDescriptors, existingSessions, providerRouting, initialProfile] = await Promise.all([
          runtimeCapabilities() as Promise<RuntimeCapabilities>,
          providerList(),
          ptyListSessions(),
          providerRoutingGet(),
          profileGet(),
        ]);
        setCapabilities(runtime);
        initializeProviderAiState(providerDescriptors, providerRouting);
        setTerminalFontSize(initialProfile.font_size);
        setSessions(existingSessions);
        const existingSessionIds = existingSessions.map((session) => session.id);
        let storedWorkspace: string | null = null;
        const fromDisk = await workspaceLayoutGet();
        if (fromDisk) {
          storedWorkspace = JSON.stringify(fromDisk);
        } else if (typeof window !== "undefined") {
          const legacy = window.localStorage.getItem(WORKSPACE_STORAGE_KEY);
          if (legacy) {
            try {
              const layout = workspaceLayoutFromSnapshot(JSON.parse(legacy) as WorkspaceSnapshot);
              await workspaceLayoutSet(layout);
              window.localStorage.removeItem(WORKSPACE_STORAGE_KEY);
              storedWorkspace = JSON.stringify(layout);
            } catch {
              window.localStorage.removeItem(WORKSPACE_STORAGE_KEY);
            }
          }
        }
        if (existingSessions.length > 0) {
          setWorkspace((current) => {
            const restored = restoreWorkspaceFromSnapshot(storedWorkspace, existingSessionIds, current);
            const activePane = restored.panes.find((pane) => pane.id === restored.activePaneId);
            if (activePane?.sessionId) {
              return restored;
            }
            return setPaneSession(restored, restored.activePaneId, existingSessions[0].id);
          });
        } else {
          const profile = await profileGet();
          const created = await ptySpawn({ profile });
          setSessions([created]);
          setWorkspace((current) => {
            const restored = restoreWorkspaceFromSnapshot(storedWorkspace, [created.id], current);
            return setPaneSession(restored, restored.activePaneId, created.id);
          });
        }
        const initialHistory = await historyQuery({ limit: 100 });
        setHistoryEntries(initialHistory);
        const recoveryNotice = await historyRecoveryTake();
        if (recoveryNotice) {
          setRecoveryBanner(recoveryNotice);
        }
        const metrics = await runtimeMetricsSnapshot();
        setRuntimeMetrics(metrics);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to load runtime capabilities.";
        setRuntimeError(message);
        setHistoryError(message);
      } finally {
        layoutPersistBootstrappedRef.current = true;
        setHistoryLoading(false);
      }
    };

    void loadCapabilities();
  }, []);

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
      const layout = workspaceLayoutFromSnapshot(snapshotWorkspace(workspace));
      void workspaceLayoutSet(layout).catch((error) => {
        console.warn("failed to persist workspace layout", error);
      });
    }, WORKSPACE_PERSIST_DEBOUNCE_MS);
    return () => window.clearTimeout(handle);
  }, [workspace]);

  useEffect(() => {
    let outputUnlisten: (() => void) | undefined;
    let lifecycleUnlisten: (() => void) | undefined;
    let cwdUnlisten: (() => void) | undefined;
    let contextUnlisten: (() => void) | undefined;

    const bindEvents = async () => {
      const flushPendingOutput = () => {
        const updates: Record<string, string> = {};
        let hadRemainder = false;

        for (const [sessionId, chunks] of Object.entries(pendingOutputRef.current)) {
          if (chunks.length === 0) {
            delete pendingOutputRef.current[sessionId];
            continue;
          }
          const { merged, rest } = drainChunksUpToByteBudget(chunks, MAX_PTY_FLUSH_BYTES_PER_FRAME);
          if (merged.length > 0) {
            updates[sessionId] = merged;
          }
          if (rest.length > 0) {
            pendingOutputRef.current[sessionId] = rest;
            hadRemainder = true;
          } else {
            delete pendingOutputRef.current[sessionId];
          }
        }

        if (Object.keys(updates).length > 0) {
          setSessionBuffers((current) => {
            const next = { ...current };
            for (const [sessionId, merged] of Object.entries(updates)) {
              next[sessionId] = appendBoundedOutput(next[sessionId] ?? "", merged);
            }
            return next;
          });
        }

        if (hadRemainder) {
          rafFlushRef.current = window.requestAnimationFrame(flushPendingOutput);
        } else {
          rafFlushRef.current = null;
        }
      };

      outputUnlisten = await onPtyOutput((event) => {
        const previousSequence = lastSequenceRef.current[event.session_id];
        const seq = nextSequenceState(previousSequence, event.sequence);
        lastSequenceRef.current[event.session_id] = seq.next;
        if (seq.status === "gap") {
          setRuntimeError(
            `Output sequence anomaly for ${event.session_id}: previous=${String(previousSequence)}, got ${event.sequence} (rewind, duplicate, or jump >${SEQUENCE_LARGE_JUMP})`,
          );
        } else if (seq.status === "resync" && import.meta.env.DEV) {
          console.debug(
            "[pty-output] sequence resync",
            event.session_id,
            "incoming=",
            event.sequence,
            "newBaseline=",
            seq.next,
          );
        }

        if (!pendingOutputRef.current[event.session_id]) {
          pendingOutputRef.current[event.session_id] = [];
        }
        pendingOutputRef.current[event.session_id].push(event.data);

        if (rafFlushRef.current === null) {
          rafFlushRef.current = window.requestAnimationFrame(flushPendingOutput);
        }
      });

      lifecycleUnlisten = await onPtyLifecycle((event: PtyLifecycleEvent) => {
        const sid = event.session_id;
        if (event.status === "running") {
          delete lastSequenceRef.current[sid];
          delete pendingOutputRef.current[sid];
          setSessionExited((current) => clearExitedInfo(current, sid));
        }

        setSessionStatus((current) => {
          const next = { ...current, [sid]: event.status };
          return next;
        });
        setSessionMessages((current) => ({ ...current, [sid]: event.message }));

        const exitedInfo = deriveExitedInfo(event);
        if (exitedInfo) {
          // Drop in-flight output / sequence state so late bytes don't resurrect a dead session,
          // but keep sessions[], the pane mapping, and sessionBuffers so the overlay can render
          // on top of the final shell output. Explicit session.restart / session.close handles teardown.
          delete pendingOutputRef.current[sid];
          delete lastSequenceRef.current[sid];
          setSessionExited((current) => ({ ...current, [sid]: exitedInfo }));
        }
      });

      cwdUnlisten = await onPtyCwdChanged((event) => {
        setSessionCwd((current) => applyCwdChange(current, event));
      });

      contextUnlisten = await onAiContext((event) => {
        setLastAiContext(event);
      });
    };

    void bindEvents();

    return () => {
      if (rafFlushRef.current !== null) {
        window.cancelAnimationFrame(rafFlushRef.current);
      }
      outputUnlisten?.();
      lifecycleUnlisten?.();
      cwdUnlisten?.();
      contextUnlisten?.();
    };
  }, []);

  useEffect(() => {
    const aliveIds = sessions.map((session) => session.id);
    setSessionExited((current) => pruneExitedForSessions(current, aliveIds));
    setSessionCwd((current) => pruneCwdForSessions(current, aliveIds));
  }, [sessions]);

  /**
   * Spawn a shell into the currently-active pane. When `cwdOverride` is provided,
   * the user's profile `cwd` is replaced with it for this one spawn only
   * (profile storage stays untouched). Used by `restartSessionById` to land the
   * replacement shell where the old one left off per the live-cwd map.
   */
  const createSessionAt = useCallback(async (cwdOverride: string | null) => {
    try {
      const profile = await profileGet();
      setTerminalFontSize(profile.font_size);
      const spawnProfile =
        cwdOverride && cwdOverride.length > 0
          ? { ...profile, cwd: cwdOverride }
          : profile;
      const created = await ptySpawn({ profile: spawnProfile });
      setSessions((current) => {
        const next = current.some((session) => session.id === created.id) ? current : [...current, created];
        const nextSessionIds = next.map((session) => session.id);
        setWorkspace((currentWorkspace) => {
          const repaired = reconcileWorkspace(currentWorkspace, nextSessionIds);
          return setPaneSession(repaired, repaired.activePaneId, created.id);
        });
        return next;
      });
      setSessionStatus((current) => ({ ...current, [created.id]: "running" }));
    } catch (error) {
      setRuntimeError(error instanceof Error ? error.message : "Failed to create session.");
    }
  }, []);

  const createSession = useCallback(async () => {
    await createSessionAt(null);
  }, [createSessionAt]);

  const clearSessionFromUiState = useCallback((sessionId: string) => {
    setSessions((current) => {
      const nextSessions = current.filter((session) => session.id !== sessionId);
      const nextSessionIds = nextSessions.map((session) => session.id);
      setWorkspace((currentWorkspace) => removeSessionFromWorkspace(currentWorkspace, sessionId, nextSessionIds));
      return nextSessions;
    });
    setSessionBuffers((current) => {
      const next = { ...current };
      delete next[sessionId];
      return next;
    });
    setSessionStatus((current) => {
      const next = { ...current };
      delete next[sessionId];
      return next;
    });
    setSessionMessages((current) => {
      const next = { ...current };
      delete next[sessionId];
      return next;
    });
    setSessionExited((current) => clearExitedInfo(current, sessionId));
    setSessionCwd((current) => clearCwd(current, sessionId));
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

  const handleInput = useCallback(async (sessionId: string, data: string) => {
    try {
      await ptyWrite(sessionId, data);
    } catch (error) {
      setSessionStatus((current) => ({ ...current, [sessionId]: "error" }));
      setRuntimeError(error instanceof Error ? error.message : "Failed to send terminal input.");
    }
  }, []);

  const handleResize = useCallback(async (sessionId: string, cols: number, rows: number) => {
    const now = Date.now();
    const lastResize = resizeThrottleRef.current[sessionId] ?? 0;
    if (now - lastResize < RESIZE_THROTTLE_MS) {
      return;
    }
    resizeThrottleRef.current[sessionId] = now;
    try {
      await ptyResize(sessionId, cols, rows);
    } catch (error) {
      setRuntimeError(error instanceof Error ? error.message : "Failed to resize terminal session.");
    }
  }, []);

  const refreshHistory = useCallback(async () => {
    setHistoryLoading(true);
    setHistoryError(null);
    try {
      const entries = await historyQuery({
        session_id: activeSession?.id,
        limit: 150,
      });
      setHistoryEntries(entries);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to load command history.";
      setRuntimeError(message);
      setHistoryError(message);
    } finally {
      setHistoryLoading(false);
    }
  }, [activeSession?.id]);

  const refreshRuntimeMetrics = useCallback(async () => {
    try {
      const snapshot = await runtimeMetricsSnapshot();
      setRuntimeMetrics(snapshot);
    } catch (error) {
      setRuntimeError(error instanceof Error ? error.message : "Failed to refresh runtime metrics.");
    }
  }, []);

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
      await pluginGrantCapability("history-tools", "command-history.read");
      const result = await pluginExecute("history-tools", "command-history.read", "{\"scope\":\"active\"}");
      setPluginResult(`${result.accepted ? "allowed" : "denied"}: ${result.message}`);
    } catch (error) {
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
  }, [initializeProviderAiState]);

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

  const splitPane = useCallback(() => {
    setWorkspace((current) => splitActivePane(current, activeSession?.id ?? null, current.splitDirection));
  }, [activeSession?.id]);

  const splitPaneRow = useCallback(() => {
    setWorkspace((current) => {
      const withDirection = setSplitDirection(current, "row");
      return splitActivePane(withDirection, activeSession?.id ?? null, "row");
    });
  }, [activeSession?.id]);

  const splitPaneColumn = useCallback(() => {
    setWorkspace((current) => {
      const withDirection = setSplitDirection(current, "column");
      return splitActivePane(withDirection, activeSession?.id ?? null, "column");
    });
  }, [activeSession?.id]);

  const closeActivePane = useCallback(() => {
    setWorkspace((current) => closePane(current, current.activePaneId));
  }, []);

  const dispatchTerminalUiRequest = useCallback((kind: TerminalUiRequest["kind"]) => {
    terminalUiSeqRef.current += 1;
    setTerminalUiRequest({ seq: terminalUiSeqRef.current, kind });
  }, []);

  const restartSessionById = useCallback(
    async (sessionId: string) => {
      // Activate the pane that hosts `sessionId` up-front (synchronous functional
      // setState read) so `createSessionAt` lands in the same pane slot. We fall
      // back to the current active pane when no pane hosts the id.
      setWorkspace((current) => {
        const pane = current.panes.find((candidate) => candidate.sessionId === sessionId);
        return pane ? setActivePane(current, pane.id) : current;
      });
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
    async (commandId: AppCommandId) => {
      const terminalIntent = commandToTerminalUiIntent(commandId);
      if (terminalIntent) {
        dispatchTerminalUiRequest(terminalIntent);
        return;
      }
      switch (commandId) {
        case "session.new":
          await createSession();
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
          splitPane();
          break;
        case "pane.close":
          closeActivePane();
          break;
        case "palette.toggle":
          setPaletteOpen((current) => !current);
          break;
        case "history.refresh":
          await refreshHistory();
          await refreshRuntimeMetrics();
          break;
        case "ai.explainSelection":
          if (historyEntries.length > 0) {
            await explainCommand(historyEntries[0].command);
          }
          break;
        case "dev.diagnostics":
          setDiagnosticsOpen(true);
          break;
      }
    },
    [
      closeActivePane,
      closeActiveSession,
      closeAllExited,
      createSession,
      dispatchTerminalUiRequest,
      explainCommand,
      historyEntries,
      refreshHistory,
      refreshRuntimeMetrics,
      restartActiveSession,
      restartAllExited,
      splitPane,
    ],
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) {
        return;
      }
      const binding = DEFAULT_KEYMAP.find((candidate) => matchShortcut(event, candidate));
      if (!binding) {
        return;
      }
      event.preventDefault();
      void executeCommand(binding.command);
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [executeCommand]);

  const commandPaletteItems = useMemo(() => {
    const commands = import.meta.env.DEV ? [...APP_COMMANDS, ...DEV_PALETTE_COMMANDS] : APP_COMMANDS;
    return commands.map((command) => {
      const matchingBinding = DEFAULT_KEYMAP.find((binding) => binding.command === command.id);
      return {
        ...command,
        shortcut: matchingBinding ? formatShortcut(matchingBinding) : command.shortcut,
      };
    });
  }, []);

  const globalShortcutItems = useMemo(
    () => commandPaletteItems.filter((command) => DEFAULT_KEYMAP.some((binding) => binding.command === command.id)),
    [commandPaletteItems],
  );

  const terminalCommandItems = useMemo(
    () => commandPaletteItems.filter((command) => command.id.startsWith("terminal.")),
    [commandPaletteItems],
  );

  return (
    <main className="app-shell">
      <header className="app-header">
        <div>
          <p className="eyebrow">Mach Terminal</p>
          <h1>Fast terminal core, zero lock-in.</h1>
          <p className="subtext">
            Warp-level UX without the vendor handcuffs. Bring your own keys, local models, and plugins.
          </p>
        </div>
        <div className="app-header-actions">
          <button type="button" className="inline-btn" onClick={() => setSetupModalOpen(true)}>
            Settings
          </button>
          {import.meta.env.DEV ? (
            <button type="button" className="inline-btn ghost" onClick={() => setDiagnosticsOpen(true)}>
              Diagnostics
            </button>
          ) : null}
          <div className="runtime-pill">
            <span>PTY</span>
            <strong>{capabilities.pty_backend}</strong>
          </div>
        </div>
      </header>
      {transientRuntimeError ? <p className="runtime-toast">{transientRuntimeError}</p> : null}
      {recoveryBanner ? <p className="runtime-toast recovery-banner">{recoveryBanner}</p> : null}

      <section className="surface-grid">
        <section className="terminal-stack">
          <TabBar
            sessions={sessions}
            sessionStatus={sessionStatus}
            sessionExited={sessionExited}
            activeSessionId={activeSessionId}
            onSelect={(sessionId) => setWorkspace((current) => setPaneSession(current, current.activePaneId, sessionId))}
            onCreate={() => void createSession()}
            onClose={(sessionId) => void closeSession(sessionId)}
            onRestartSession={(sessionId) => void restartSessionById(sessionId)}
          />
          <SplitWorkspace
            workspace={workspace}
            sessionsById={sessionsById}
            sessionBuffers={sessionBuffers}
            sessionStatuses={sessionStatus}
            sessionMessages={sessionMessages}
            sessionExited={sessionExited}
            sessionCwd={sessionCwd}
            terminalFontSize={terminalFontSize}
            terminalUiRequest={terminalUiRequest}
            onInput={(sessionId, data) => void handleInput(sessionId, data)}
            onResize={(sessionId, cols, rows) => void handleResize(sessionId, cols, rows)}
            onFocusPane={(paneId) => setWorkspace((current) => setActivePane(current, paneId))}
            onRequestRestartSession={(paneId) => {
              const pane = workspace.panes.find((candidate) => candidate.id === paneId);
              const sid = pane?.sessionId ?? null;
              if (!sid) {
                return;
              }
              void restartSessionById(sid);
            }}
            onRequestCloseSession={(paneId) => {
              const pane = workspace.panes.find((candidate) => candidate.id === paneId);
              const sid = pane?.sessionId ?? null;
              setWorkspace((current) => setActivePane(current, paneId));
              if (!sid) {
                return;
              }
              void (async () => {
                await closeSession(sid);
                setSessionExited((current) => clearExitedInfo(current, sid));
              })();
            }}
          />
        </section>

        <aside className="info-panel">
          <section>
            <h2>Runtime Capabilities</h2>
            {runtimeError ? <p className="error-text">{runtimeError}</p> : null}
            <ul>
              <li>
                <span>Session persistence</span>
                <strong>{capabilities.session_persistence ? "enabled" : "disabled"}</strong>
              </li>
              <li>
                <span>Plugin host</span>
                <strong>{capabilities.plugin_host ? "enabled" : "disabled"}</strong>
              </li>
              <li>
                <span>Provider host</span>
                <strong>{capabilities.provider_host ? "enabled" : "disabled"}</strong>
              </li>
              <li>
                <span>Provider routing</span>
                <strong>{capabilities.provider_routing ? "enabled" : "disabled"}</strong>
              </li>
            </ul>
            {runtimeMetrics ? (
              <div className="metrics-grid">
                <p>chunks emitted: {runtimeMetrics.output_chunks_emitted}</p>
                <p>chunks dropped: {runtimeMetrics.output_chunks_dropped}</p>
                <p>emit failures: {runtimeMetrics.emit_failures}</p>
                <p>sequence anomalies: {runtimeMetrics.sequence_anomalies}</p>
              </div>
            ) : null}
          </section>

          <section>
            <h2>Providers (disabled by default)</h2>
            {providerConfigStatus ? <p className="muted-block">{providerConfigStatus}</p> : null}
            <ul>
              {providers.map((provider) => (
                <li key={provider.id}>
                  <span>
                    {provider.name}
                    <small>{provider.kind}</small>
                  </span>
                  <strong>{isExecutableProvider(provider.id) ? provider.status : "unavailable"}</strong>
                  <button
                    type="button"
                    onClick={() => void toggleProvider(provider.id, !provider.enabled)}
                    className="inline-btn"
                    disabled={!isExecutableProvider(provider.id) && !provider.enabled}
                  >
                    {provider.enabled ? "disable" : "enable"}
                  </button>
                  <input
                    value={providerEndpointDrafts[provider.id] ?? ""}
                    onChange={(event) => updateProviderEndpointDraft(provider.id, event.currentTarget.value)}
                    placeholder="Endpoint URL"
                    className="inline-input"
                    aria-label={`${provider.id} endpoint`}
                    disabled={!isExecutableProvider(provider.id)}
                  />
                  <button
                    type="button"
                    className="inline-btn ghost"
                    onClick={() => void saveProviderEndpoint(provider.id)}
                    disabled={!isExecutableProvider(provider.id)}
                  >
                    save endpoint
                  </button>
                </li>
              ))}
            </ul>
          </section>

          <section>
            <h2>Session Controls</h2>
            <p className="muted-block">
              active session: {activeSession?.id ?? "none"} ({activeSession ? sessionStatus[activeSession.id] ?? activeSession.status : "idle"})
            </p>
            <div className="inline-controls">
              <button type="button" className="inline-btn" onClick={() => void restartActiveSession()}>
                restart session
              </button>
              <button type="button" className="inline-btn" onClick={() => splitPane()}>
                split ({workspace.splitDirection})
              </button>
              <button type="button" className="inline-btn ghost" onClick={() => splitPaneColumn()}>
                split vertical
              </button>
              <button type="button" className="inline-btn ghost" onClick={() => splitPaneRow()}>
                split horizontal
              </button>
              <button type="button" className="inline-btn" onClick={() => closeActivePane()}>
                close pane
              </button>
              <button type="button" className="inline-btn" onClick={() => setPaletteOpen(true)}>
                command palette
              </button>
            </div>
          </section>

          <section>
            <h2>Updater</h2>
            <div className="inline-controls">
              <button type="button" className="inline-btn" onClick={() => void checkForUpdates()} disabled={!UPDATER_ENABLED}>
                check for updates
              </button>
              <p className="muted-block">
                status: {updateStatus}
                {!UPDATER_ENABLED ? (
                  <span>
                    {" "}
                    (updater runs only in release builds with <code>VITE_ENABLE_UPDATER=true</code>.)
                  </span>
                ) : null}
              </p>
            </div>
          </section>

          <section>
            <h2>AI Router (v0)</h2>
            <div className="stacked-controls">
              <label className="field-row">
                <span>Default provider</span>
                <select
                  value={routingDraft.default_provider}
                  onChange={(event) => setRoutingDraft((current) => ({ ...current, default_provider: event.currentTarget.value }))}
                >
                  {providers.map((provider) => (
                    <option key={provider.id} value={provider.id} disabled={!isExecutableProvider(provider.id)}>
                      {provider.name} ({provider.id}){!isExecutableProvider(provider.id) ? " - unavailable" : ""}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field-row">
                <span>Ollama model</span>
                <input
                  value={routingDraft.ollama_model}
                  onChange={(event) => setRoutingDraft((current) => ({ ...current, ollama_model: event.currentTarget.value }))}
                />
              </label>
              <button type="button" className="inline-btn ghost" onClick={() => void saveRoutingConfig()}>
                save routing config
              </button>
              <label className="toggle-row">
                <input
                  type="checkbox"
                  checked={routing.ai_feature_enabled}
                  onChange={(event) => void setAiOptIn(event.currentTarget.checked)}
                />
                AI opt-in required
              </label>
              <input value={aiPrompt} onChange={(event) => setAiPrompt(event.currentTarget.value)} />
              <button
                type="button"
                className="inline-btn"
                onClick={() => void runAiPrompt()}
                disabled={!canRunAiRequest(routing.ai_feature_enabled, aiRequestInFlight)}
              >
                {aiRequestInFlight ? "running..." : "run ai prompt"}
              </button>
              {!routing.ai_feature_enabled ? (
                <p className="muted-block">
                  AI requests are blocked until you enable AI opt-in. Provider endpoints and routing can still be configured.
                </p>
              ) : null}
              {aiRequestStatus ? <p className="muted-block">{aiRequestStatus}</p> : null}
              {aiResponse ? <p className="muted-block">{aiResponse}</p> : null}
              {lastAiContext ? (
                <p className="muted-block">
                  context: {lastAiContext.event_type} - {lastAiContext.payload}
                </p>
              ) : null}
            </div>
          </section>

          <HistoryPanel
            entries={historyEntries}
            loading={historyLoading}
            aiBusy={aiRequestInFlight}
            error={historyError}
            actionStatus={historyActionStatus}
            onReplay={(command) => void replayCommand(command)}
            onExplain={(command) => void explainCommand(command)}
            onFix={(command) => void fixCommand(command)}
          />

          <section>
            <h2>Keyboard Shortcuts</h2>
            <ul>
              {globalShortcutItems.map((command) => (
                <li key={command.id}>
                  <span>{command.label}</span>
                  <strong>{command.shortcut ?? "unbound"}</strong>
                </li>
              ))}
            </ul>
            <p className="muted-block">Terminal-focused commands (palette or terminal local keys):</p>
            <ul>
              {terminalCommandItems.map((command) => (
                <li key={command.id}>
                  <span>{command.label}</span>
                  <strong>{command.shortcut ?? "palette"}</strong>
                </li>
              ))}
            </ul>
          </section>

          <section>
            <h2>Plugin Contracts</h2>
            <ul>
              {PLUGIN_REGISTRY.map((plugin) => (
                <li key={plugin.id}>
                  <span>{plugin.name}</span>
                  <strong>{plugin.stage}</strong>
                </li>
              ))}
            </ul>
            <div className="inline-controls">
              <button type="button" className="inline-btn" onClick={() => void runPluginDemo()}>
                run plugin demo
              </button>
              {pluginResult ? <p className="muted-block">{pluginResult}</p> : null}
            </div>
          </section>
        </aside>
      </section>
      <CommandPalette
        open={paletteOpen}
        commands={commandPaletteItems}
        onClose={() => setPaletteOpen(false)}
        onRun={(commandId) => void executeCommand(commandId as AppCommandId)}
      />
      <FirstRunSetup open={setupModalOpen} onClose={() => setSetupModalOpen(false)} onSaved={handleSetupSaved} />

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
  );
}

export default App;
