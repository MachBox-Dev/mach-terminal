import { useEffect } from "react";
import type { Dispatch, SetStateAction } from "react";
import { prefetchShellCandidates, loadShellCandidates } from "../core/shellCandidatesCache";
import { fetchShellPresets } from "../core/shellPresets";
import {
  restoreSessionMetadataFromTabs,
  spawnProfileForRestorableTab,
} from "../core/sessionRestore";
import type { SessionInputMode } from "../core/inputMode";
import type { ShellPreset } from "../core/shellPresets";
import type { ShellCandidate } from "../core/terminal";
import type { ProviderDescriptor } from "../core/providers";
import type { RuntimeCapabilities } from "../core/runtime";
import type {
  PtySessionInfo,
  RuntimeMetricsSnapshot,
  SessionStatus,
  TerminalProfile,
  HistoryEntry,
  ProviderRoutingSettings,
} from "../core/terminal";
import {
  ensurePtyOutputSubscribed,
  historyQuery,
  historyRecoveryTake,
  profileGet,
  providerList,
  providerRoutingGet,
  ptyClose,
  ptyListSessions,
  ptySpawn,
  runtimeCapabilities,
  runtimeMetricsSnapshot,
  workspaceLayoutGet,
} from "../core/terminal";
import {
  activeGroupLayout,
  bootstrapWorkspaceFromSessions,
  remapLayoutToSnapshot,
  restoreWorkspaceFromSnapshot,
  setPaneSession,
  type WorkspaceState,
} from "../state/workspace";

const WORKSPACE_STORAGE_KEY = "mach-terminal.workspace.v1";
const HISTORY_UI_LIMIT = 3000;

export interface SessionBootCallbacks {
  setHistoryLoading: Dispatch<SetStateAction<boolean>>;
  setHistoryError: Dispatch<SetStateAction<string | null>>;
  setCapabilities: Dispatch<SetStateAction<RuntimeCapabilities>>;
  initializeProviderAiState: (
    descriptors: ProviderDescriptor[],
    routing: ProviderRoutingSettings,
  ) => void;
  setTerminalFontSize: Dispatch<SetStateAction<number>>;
  setMinimalShellPrompt: Dispatch<SetStateAction<boolean>>;
  setShowComposerAssistMetrics: Dispatch<SetStateAction<boolean>>;
  setCachedProfile: (profile: TerminalProfile) => void;
  setSessions: Dispatch<SetStateAction<PtySessionInfo[]>>;
  setSessionStatus: Dispatch<SetStateAction<Record<string, SessionStatus>>>;
  setSessionNames: Dispatch<SetStateAction<Record<string, string>>>;
  setSessionInputModes: Dispatch<SetStateAction<Record<string, SessionInputMode>>>;
  setSessionSpawnArgs: Dispatch<SetStateAction<Record<string, string[]>>>;
  setWorkspace: Dispatch<SetStateAction<WorkspaceState>>;
  bootstrapSessionChat: (sessionIds: string[], chatKeys: Record<string, string>) => void;
  setHistoryEntries: Dispatch<SetStateAction<HistoryEntry[]>>;
  setRecoveryBanner: Dispatch<SetStateAction<string | null>>;
  setRuntimeMetrics: Dispatch<SetStateAction<RuntimeMetricsSnapshot | null>>;
  setRuntimeError: Dispatch<SetStateAction<string | null>>;
  setDetectedShells: Dispatch<SetStateAction<ShellCandidate[]>>;
  setShellPresets: Dispatch<SetStateAction<ShellPreset[]>>;
  onBootstrapped: () => void;
  recordSpawnArgs: (sessionId: string, profile: TerminalProfile) => void;
}

export async function runSessionBoot(callbacks: SessionBootCallbacks): Promise<void> {
  callbacks.setHistoryLoading(true);
  callbacks.setHistoryError(null);
  try {
    await ensurePtyOutputSubscribed();
    const [runtime, providerDescriptors, existingSessions, providerRouting, initialProfile] = await Promise.all([
      runtimeCapabilities() as Promise<RuntimeCapabilities>,
      providerList(),
      ptyListSessions(),
      providerRoutingGet(),
      profileGet(),
    ]);
    callbacks.setCapabilities(runtime);
    callbacks.initializeProviderAiState(providerDescriptors, providerRouting);
    callbacks.setTerminalFontSize(initialProfile.font_size);
    callbacks.setMinimalShellPrompt(initialProfile.minimal_shell_prompt ?? false);
    callbacks.setShowComposerAssistMetrics(initialProfile.show_composer_assist_metrics ?? false);
    callbacks.setCachedProfile(initialProfile);

    let storedWorkspace: string | null = null;
    const fromDisk = await workspaceLayoutGet();
    if (fromDisk) {
      storedWorkspace = JSON.stringify(fromDisk);
    } else if (typeof window !== "undefined") {
      window.localStorage.removeItem(WORKSPACE_STORAGE_KEY);
    }

    let sessionsForBoot = existingSessions;
    if (!storedWorkspace && existingSessions.length > 1) {
      for (const extra of existingSessions.slice(1)) {
        try {
          await ptyClose(extra.id);
        } catch {
          // Session may already be gone on the backend.
        }
      }
      sessionsForBoot = [existingSessions[0]];
    }

    callbacks.setSessions(sessionsForBoot);
    const existingSessionIds = sessionsForBoot.map((session) => session.id);
    const persistedTabs = fromDisk?.sessions ?? [];

    if (existingSessions.length > 0) {
      const { names, modes, chatKeys } = restoreSessionMetadataFromTabs(persistedTabs, (id) =>
        existingSessionIds.includes(id) ? id : null,
      );
      callbacks.bootstrapSessionChat(existingSessionIds, chatKeys);
      if (Object.keys(names).length > 0) {
        callbacks.setSessionNames(names);
      }
      if (Object.keys(modes).length > 0) {
        callbacks.setSessionInputModes(modes);
      }
      const restoredArgs: Record<string, string[]> = {};
      for (const tab of persistedTabs) {
        const liveId = existingSessionIds.includes(tab.sessionId) ? tab.sessionId : null;
        if (liveId && tab.args && tab.args.length > 0) {
          restoredArgs[liveId] = [...tab.args];
        }
      }
      if (Object.keys(restoredArgs).length > 0) {
        callbacks.setSessionSpawnArgs(restoredArgs);
      }
      callbacks.setWorkspace((current) => {
        if (!storedWorkspace && existingSessionIds.length > 0) {
          const booted = bootstrapWorkspaceFromSessions(existingSessionIds);
          const layout = activeGroupLayout(booted);
          const activePane = layout.panes.find((pane) => pane.id === layout.activePaneId);
          if (activePane?.sessionId) {
            return booted;
          }
          return setPaneSession(booted, layout.activePaneId, sessionsForBoot[0].id);
        }
        const restored = restoreWorkspaceFromSnapshot(storedWorkspace, existingSessionIds, current);
        const layout = activeGroupLayout(restored);
        const activePane = layout.panes.find((pane) => pane.id === layout.activePaneId);
        if (activePane?.sessionId) {
          return restored;
        }
        return setPaneSession(restored, layout.activePaneId, sessionsForBoot[0].id);
      });
    } else if (persistedTabs.length > 0) {
      const restoredInfos: PtySessionInfo[] = [];
      const idMap: Record<string, string> = {};
      for (const tab of persistedTabs) {
        try {
          const profile = spawnProfileForRestorableTab(tab, initialProfile);
          const created = await ptySpawn({ profile });
          restoredInfos.push(created);
          idMap[tab.sessionId] = created.id;
          callbacks.recordSpawnArgs(created.id, profile);
        } catch (error) {
          console.warn("failed to restore session", tab.sessionId, error);
        }
      }
      if (restoredInfos.length > 0) {
        const restoredIds = restoredInfos.map((info) => info.id);
        const { names, modes, chatKeys } = restoreSessionMetadataFromTabs(persistedTabs, (id) => idMap[id] ?? null);
        callbacks.setSessions(restoredInfos);
        callbacks.setSessionStatus(
          restoredInfos.reduce<Record<string, SessionStatus>>((acc, info) => {
            acc[info.id] = "running";
            return acc;
          }, {}),
        );
        callbacks.bootstrapSessionChat(restoredIds, chatKeys);
        if (Object.keys(names).length > 0) {
          callbacks.setSessionNames(names);
        }
        if (Object.keys(modes).length > 0) {
          callbacks.setSessionInputModes(modes);
        }
        const remappedSnapshot = JSON.stringify(remapLayoutToSnapshot(fromDisk!, idMap));
        callbacks.setWorkspace((current) => {
          const restored = restoreWorkspaceFromSnapshot(remappedSnapshot, restoredIds, current);
          const layout = activeGroupLayout(restored);
          const activePane = layout.panes.find((pane) => pane.id === layout.activePaneId);
          if (activePane?.sessionId) {
            return restored;
          }
          return setPaneSession(restored, layout.activePaneId, restoredInfos[0].id);
        });
      } else {
        const created = await ptySpawn({ profile: initialProfile });
        callbacks.recordSpawnArgs(created.id, initialProfile);
        callbacks.setSessions([created]);
        callbacks.bootstrapSessionChat([created.id], {});
        callbacks.setWorkspace((current) => {
          const restored = restoreWorkspaceFromSnapshot(storedWorkspace, [created.id], current);
          const layout = activeGroupLayout(restored);
          return setPaneSession(restored, layout.activePaneId, created.id);
        });
      }
    } else {
      const created = await ptySpawn({ profile: initialProfile });
      callbacks.recordSpawnArgs(created.id, initialProfile);
      callbacks.setSessions([created]);
      callbacks.bootstrapSessionChat([created.id], {});
      callbacks.setWorkspace((current) => {
        const restored = restoreWorkspaceFromSnapshot(storedWorkspace, [created.id], current);
        const layout = activeGroupLayout(restored);
        return setPaneSession(restored, layout.activePaneId, created.id);
      });
    }

    const initialHistory = await historyQuery({ limit: HISTORY_UI_LIMIT });
    callbacks.setHistoryEntries(initialHistory);
    const recoveryNotice = await historyRecoveryTake();
    if (recoveryNotice) {
      callbacks.setRecoveryBanner(recoveryNotice);
    }
    const metrics = await runtimeMetricsSnapshot();
    callbacks.setRuntimeMetrics(metrics);
    prefetchShellCandidates();
    void loadShellCandidates().then(callbacks.setDetectedShells);
    void fetchShellPresets().then(callbacks.setShellPresets);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load runtime capabilities.";
    callbacks.setRuntimeError(message);
    callbacks.setHistoryError(message);
  } finally {
    callbacks.onBootstrapped();
    callbacks.setHistoryLoading(false);
  }
}

export function useSessionBoot(callbacksRef: { current: SessionBootCallbacks }): void {
  useEffect(() => {
    void runSessionBoot(callbacksRef.current);
    // Boot runs once on mount; App keeps callbacksRef.current fresh each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
