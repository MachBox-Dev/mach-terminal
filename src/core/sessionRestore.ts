import { parseSessionInputMode, type SessionInputMode } from "./inputMode";
import type { TerminalProfile } from "./terminal";
import { createChatPersistenceKey } from "./aiChatPersistence";
import type { RestorableSession } from "../state/workspace";

export function spawnProfileForRestorableTab(
  tab: RestorableSession,
  defaultProfile: TerminalProfile,
): TerminalProfile {
  const profile: TerminalProfile = { ...defaultProfile, env: { ...defaultProfile.env } };
  const shell = tab.shell?.trim();
  if (shell) {
    profile.shell = shell;
  }
  if (tab.args && tab.args.length > 0) {
    profile.args = [...tab.args];
  }
  const cwd = tab.cwd?.trim();
  if (cwd) {
    profile.cwd = cwd;
  }
  return profile;
}

/**
 * Reattach tab metadata (name, input mode, chat key) from persisted descriptors onto
 * live session ids. `resolveLiveId` returns the live id for a persist-time session id.
 */
export function restoreSessionMetadataFromTabs(
  tabs: readonly RestorableSession[],
  resolveLiveId: (persistedSessionId: string) => string | null,
): {
  names: Record<string, string>;
  modes: Record<string, SessionInputMode>;
  chatKeys: Record<string, string>;
} {
  const names: Record<string, string> = {};
  const modes: Record<string, SessionInputMode> = {};
  const chatKeys: Record<string, string> = {};

  for (const tab of tabs) {
    const liveId = resolveLiveId(tab.sessionId);
    if (!liveId) {
      continue;
    }
    if (tab.name?.trim()) {
      names[liveId] = tab.name.trim();
    }
    if (tab.inputMode) {
      modes[liveId] = parseSessionInputMode(tab.inputMode);
    }
    const persistedKey = tab.chatKey?.trim();
    chatKeys[liveId] = persistedKey && persistedKey.length > 0 ? persistedKey : createChatPersistenceKey();
  }

  return { names, modes, chatKeys };
}

/** Every live session needs a chat key so AI history can persist across reloads. */
export function ensureChatKeysForSessionIds(
  sessionIds: readonly string[],
  chatKeys: Record<string, string>,
): Record<string, string> {
  const next = { ...chatKeys };
  for (const sessionId of sessionIds) {
    if (!next[sessionId]) {
      next[sessionId] = createChatPersistenceKey();
    }
  }
  return next;
}

export function resolveChatKeyForSession(
  sessionChatKeys: Record<string, string>,
  sessionId: string,
  preferredKey?: string,
): { chatKey: string; nextKeys: Record<string, string> } {
  const existing = sessionChatKeys[sessionId];
  if (existing) {
    return { chatKey: existing, nextKeys: sessionChatKeys };
  }
  const chatKey = preferredKey?.trim() || createChatPersistenceKey();
  return { chatKey, nextKeys: { ...sessionChatKeys, [sessionId]: chatKey } };
}
