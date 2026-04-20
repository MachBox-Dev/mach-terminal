import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { check } from "@tauri-apps/plugin-updater";
import "./App.css";
import { AppSettingsModal } from "./components/AppSettingsModal";
import { CommandPalette } from "./components/CommandPalette";
import { FirstRunSetup, ONBOARDING_STORAGE_KEY } from "./components/FirstRunSetup";
import { SplitWorkspace } from "./components/SplitWorkspace";
import { CustomTitleBar } from "./components/CustomTitleBar";
import { TabBar } from "./components/TabBar";
import { AiInsightPanel } from "./components/AiInsightPanel";
import { OpsRail, type OpsRailFilter } from "./components/OpsRail";
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
import type { TerminalUiRequest } from "./core/terminalUiRequest";
import { DEFAULT_KEYMAP, formatShortcut, matchShortcut } from "./core/keymap";
import { drainChunksUpToByteBudget, nextSequenceState, SEQUENCE_LARGE_JUMP } from "./core/ptyOutputCoalesce";
import { DEFAULT_RUNTIME_CAPABILITIES, type RuntimeCapabilities } from "./core/runtime";
import {
  historyQuery,
  historyRecoveryTake,
  historyReplay,
  composerComplete,
  onAiContext,
  onPtyCwdChanged,
  onPtyCommandMarker,
  onPtyLifecycle,
  onPtyOutput,
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
  ptyListSessions,
  ptyResize,
  ptySpawn,
  ptyWrite,
  type HistoryEntry,
  type PtyCommandMarkerEvent,
  type PtyLifecycleEvent,
  type PtySessionInfo,
  type RuntimeMetricsSnapshot,
  type PluginMetricsSnapshot,
  type SessionStatus,
  runtimeCapabilities,
  workspaceLayoutGet,
  workspaceLayoutSet,
  trimAiContextExcerpt,
  type AiPromptContextPayload,
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
import { isExecutableProvider } from "./core/providerUiState";
import { useProviderAiState } from "./hooks/useProviderAiState";
import { isTauri } from "./core/tauriRuntime";
import {
  appendCommandSubmitted,
  removeSessionRuns,
  serializePinnedMap,
  toggleRunPin,
  type RunLedgerState,
  type RunRecord,
} from "./core/runLedger";

const MAX_SESSION_BUFFER = 120_000;
/** Max UTF-16 units applied to xterm per animation frame per session (remainder stays queued). */
const MAX_PTY_FLUSH_BYTES_PER_FRAME = 48_000;
const RESIZE_THROTTLE_MS = 100;
const WORKSPACE_STORAGE_KEY = "mach-terminal.workspace.v1";
const WORKSPACE_PERSIST_DEBOUNCE_MS = 320;
const OPS_RAIL_COLLAPSED_KEY = "mach-terminal.opsRail.collapsed";
const OPS_RAIL_PINS_KEY = "mach-terminal.opsRail.pins";

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
  const sessionBuffersRef = useRef(sessionBuffers);
  sessionBuffersRef.current = sessionBuffers;
  const composerDraftRef = useRef("");
  const [runLedger, setRunLedger] = useState<RunLedgerState>({});
  const [opsRailCollapsed, setOpsRailCollapsed] = useState(() =>
    typeof window !== "undefined" ? window.localStorage.getItem(OPS_RAIL_COLLAPSED_KEY) === "1" : false,
  );
  const [opsFilter, setOpsFilter] = useState<OpsRailFilter>("all");
  const [opsSelectedRunId, setOpsSelectedRunId] = useState<string | null>(null);
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
  const [pluginPolicyDecision, setPluginPolicyDecision] = useState<string | null>(null);
  const [pluginGrantSummary, setPluginGrantSummary] = useState<string | null>(null);
  const [pluginTelemetry, setPluginTelemetry] = useState<PluginMetricsSnapshot | null>(null);
  const [updateStatus, setUpdateStatus] = useState<string>(UPDATER_ENABLED ? "idle" : "disabled (build flag)");
  const [firstRunModalOpen, setFirstRunModalOpen] = useState(false);
  const [settingsModalOpen, setSettingsModalOpen] = useState(false);
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);
  const [diagnosticsJson, setDiagnosticsJson] = useState<string | null>(null);
  const [diagnosticsLoading, setDiagnosticsLoading] = useState(false);
  const [diagnosticsError, setDiagnosticsError] = useState<string | null>(null);
  const [diagnosticsCopyStatus, setDiagnosticsCopyStatus] = useState<string | null>(null);
  const [recoveryBanner, setRecoveryBanner] = useState<string | null>(null);
  const [aiInsightDismissed, setAiInsightDismissed] = useState(false);
  const [terminalFontSize, setTerminalFontSize] = useState(13);
  const [minimalShellPrompt, setMinimalShellPrompt] = useState(false);
  const [showComposerAssistMetrics, setShowComposerAssistMetrics] = useState(false);
  const [sessionOsc133Hints, setSessionOsc133Hints] = useState<Record<string, string>>({});
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

  const buildAiPromptContext = useCallback((): AiPromptContextPayload | undefined => {
    if (!activeSession) {
      return undefined;
    }
    const cwd = sessionCwd[activeSession.id] ?? activeSession.cwd ?? undefined;
    const rawBuffer = sessionBuffers[activeSession.id] ?? "";
    const output_excerpt = trimAiContextExcerpt(rawBuffer);
    return {
      cwd,
      shell: activeSession.shell ?? undefined,
      output_excerpt,
    };
  }, [activeSession, sessionBuffers, sessionCwd]);

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
    explainCommand,
    fixCommand,
  } = useProviderAiState({
    activeSession,
    onRuntimeError: (message) => setRuntimeError(message),
    onHistoryActionStatus: (status) => setHistoryActionStatus(status),
    buildAiPromptContext,
  });

  useEffect(() => {
    setAiInsightDismissed(false);
  }, [aiResponse]);

  useEffect(() => {
    if (aiRequestInFlight) {
      setAiInsightDismissed(false);
    }
  }, [aiRequestInFlight]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const v = window.localStorage.getItem(ONBOARDING_STORAGE_KEY);
    if (v !== "done" && v !== "skipped") {
      setFirstRunModalOpen(true);
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
        setMinimalShellPrompt(initialProfile.minimal_shell_prompt ?? false);
        setShowComposerAssistMetrics(initialProfile.show_composer_assist_metrics ?? false);
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
    let markerUnlisten: (() => void) | undefined;
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
        if (seq.status === "duplicate") {
          return;
        }
        if (seq.status === "gap") {
          setRuntimeError(
            `Output sequence anomaly for ${event.session_id}: previous=${String(previousSequence)}, got ${event.sequence} (rewind, or jump >${SEQUENCE_LARGE_JUMP})`,
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
      });

      contextUnlisten = await onAiContext((event) => {
        setLastAiContext(event);
        if (event.event_type !== "command_submitted") {
          return;
        }
        const sid = event.session_id;
        const bufLen = sessionBuffersRef.current[sid]?.length ?? 0;
        setRunLedger((ledger) =>
          appendCommandSubmitted(ledger, {
            sessionId: sid,
            commandText: event.payload,
            submittedAtMs: event.timestamp_ms,
            sequence: event.sequence,
            bufferLengthBefore: bufLen,
          }),
        );
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
      markerUnlisten?.();
      contextUnlisten?.();
    };
  }, []);

  useEffect(() => {
    const aliveIds = sessions.map((session) => session.id);
    setSessionExited((current) => pruneExitedForSessions(current, aliveIds));
    setSessionCwd((current) => pruneCwdForSessions(current, aliveIds));
    setSessionOsc133Hints((current) => {
      const next = { ...current };
      for (const id of Object.keys(next)) {
        if (!aliveIds.includes(id)) {
          delete next[id];
        }
      }
      return next;
    });
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
    setRunLedger((current) => removeSessionRuns(current, sessionId));
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
  }, [initializeProviderAiState]);

  const setMinimalShellPromptPreference = useCallback(async (enabled: boolean) => {
    try {
      const updated = await profilePatch({ minimal_shell_prompt: enabled });
      setMinimalShellPrompt(updated.minimal_shell_prompt ?? enabled);
    } catch (error) {
      setRuntimeError(error instanceof Error ? error.message : "Failed to update profile.");
    }
  }, []);

  const setShowComposerAssistMetricsPreference = useCallback(async (enabled: boolean) => {
    try {
      const updated = await profilePatch({ show_composer_assist_metrics: enabled });
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

  const dispatchTerminalUiRequest = useCallback((payload: Omit<TerminalUiRequest, "seq">) => {
    terminalUiSeqRef.current += 1;
    setTerminalUiRequest({ ...payload, seq: terminalUiSeqRef.current } as TerminalUiRequest);
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
        dispatchTerminalUiRequest({ kind: terminalIntent });
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
        case "ai.explainComposerDraft": {
          const draft = composerDraftRef.current.trim();
          if (draft) {
            await explainCommand(draft);
          }
          break;
        }
        case "ai.fixComposerDraft": {
          const draft = composerDraftRef.current.trim();
          if (draft) {
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
      closeActivePane,
      closeActiveSession,
      closeAllExited,
      createSession,
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

  const aiAssistEnabled = useMemo(
    () => routing.ai_feature_enabled && isExecutableProvider(routing.default_provider),
    [routing.ai_feature_enabled, routing.default_provider],
  );

  const aiInsightSlot = useMemo(() => {
    if (aiInsightDismissed || (!aiResponse && !aiRequestInFlight)) {
      return null;
    }
    return (
      <AiInsightPanel
        text={aiResponse}
        inFlight={aiRequestInFlight}
        statusLine={aiRequestStatus}
        onDismiss={() => setAiInsightDismissed(true)}
        onOpenSettings={() => setSettingsModalOpen(true)}
      />
    );
  }, [aiInsightDismissed, aiRequestInFlight, aiRequestStatus, aiResponse]);

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

  return (
    <div className="app-frame">
      <CustomTitleBar
        onOpenSettings={() => setSettingsModalOpen(true)}
        onOpenDiagnostics={() => setDiagnosticsOpen(true)}
        showDiagnostics={import.meta.env.DEV}
      />
      <main className="app-shell">
        {transientRuntimeError ? <p className="runtime-toast">{transientRuntimeError}</p> : null}
        {recoveryBanner ? <p className="runtime-toast recovery-banner">{recoveryBanner}</p> : null}
        {runtimeError ? (
          <div className="runtime-error-strip" role="status">
            <span>{runtimeError}</span>
            <button type="button" className="inline-btn ghost" onClick={() => setSettingsModalOpen(true)}>
              Open settings
            </button>
          </div>
        ) : null}

        <section className="terminal-surface">
          <div className={`terminal-workspace-split${opsRailCollapsed ? " ops-rail-window-collapsed" : ""}`}>
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
            showComposerAssistMetrics={showComposerAssistMetrics}
            sessionOsc133Hints={sessionOsc133Hints}
            aiInsightSlot={aiInsightSlot}
            aiAssistEnabled={aiAssistEnabled}
            onComposerDraftChange={(paneId, draft) => {
              if (paneId === workspace.activePaneId) {
                composerDraftRef.current = draft;
              }
            }}
            onAiExplainComposer={() => {
              const draft = composerDraftRef.current.trim();
              if (draft) {
                void explainCommand(draft);
              }
            }}
            onAiFixComposer={() => {
              const draft = composerDraftRef.current.trim();
              if (draft) {
                void fixCommand(draft);
              }
            }}
            historyEntries={historyEntries}
            onRequestComposerCompletion={requestComposerCompletion}
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
          <OpsRail
            collapsed={opsRailCollapsed}
            onToggleCollapsed={() => setOpsRailCollapsed((current) => !current)}
            filter={opsFilter}
            onFilterChange={setOpsFilter}
            entries={filteredRunsForOps}
            scrollBuffer={activeSessionId ? sessionBuffers[activeSessionId] ?? "" : ""}
            selectedRunId={opsSelectedRunId}
            onSelectRun={setOpsSelectedRunId}
            onTogglePin={handleOpsTogglePin}
            onJump={handleJumpRun}
            aiAssistEnabled={aiAssistEnabled}
            aiBusy={aiRequestInFlight}
            onExplainEntry={(command) => void explainCommand(command)}
            onFixEntry={(command) => void fixCommand(command)}
          />
          </div>
        </section>

        <AppSettingsModal
          open={settingsModalOpen}
          onClose={() => setSettingsModalOpen(false)}
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
          workspaceSplitDirection={workspace.splitDirection}
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
          runAiPrompt={runAiPrompt}
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
          minimalShellPrompt={minimalShellPrompt}
          onMinimalShellPromptChange={setMinimalShellPromptPreference}
          showComposerAssistMetrics={showComposerAssistMetrics}
          onShowComposerAssistMetricsChange={setShowComposerAssistMetricsPreference}
        />
        <CommandPalette
          open={paletteOpen}
          commands={commandPaletteItems}
          onClose={() => setPaletteOpen(false)}
          onRun={(commandId) => void executeCommand(commandId as AppCommandId)}
        />
        <FirstRunSetup open={firstRunModalOpen} onClose={() => setFirstRunModalOpen(false)} onSaved={handleSetupSaved} />

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
    </div>
  );
}

export default App;
