import type { AiChatMessage, AiChatState } from "./aiChatState";

export const AI_CHAT_STORAGE_KEY = "mach-terminal.aiChat.v1";

export type PersistedAiChatStore = Record<string, AiChatMessage[]>;

export function createChatPersistenceKey(): string {
  return `chat-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function loadPersistedAiChats(): PersistedAiChatStore {
  if (typeof window === "undefined") {
    return {};
  }
  try {
    const raw = window.localStorage.getItem(AI_CHAT_STORAGE_KEY);
    if (!raw) {
      return {};
    }
    const parsed = JSON.parse(raw) as PersistedAiChatStore;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export function savePersistedAiChats(store: PersistedAiChatStore): void {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.localStorage.setItem(AI_CHAT_STORAGE_KEY, JSON.stringify(store));
  } catch {
    /* ignore quota errors */
  }
}

/** Map live session ids → stable chat keys for layout persistence. */
export function chatKeysFromSessions(
  sessionIds: readonly string[],
  keysBySessionId: Record<string, string | undefined>,
): Record<string, string> {
  const next: Record<string, string> = {};
  for (const sessionId of sessionIds) {
    const key = keysBySessionId[sessionId];
    if (key) {
      next[sessionId] = key;
    }
  }
  return next;
}

export function hydrateAiChatStateFromStore(
  sessionChatKeys: Record<string, string>,
  store: PersistedAiChatStore = loadPersistedAiChats(),
): AiChatState {
  const state: AiChatState = {};
  for (const [sessionId, chatKey] of Object.entries(sessionChatKeys)) {
    const messages = store[chatKey];
    if (messages && messages.length > 0) {
      state[sessionId] = messages;
    }
  }
  return state;
}

export function persistAiChatsForSessions(
  aiChatState: AiChatState,
  sessionChatKeys: Record<string, string>,
  store: PersistedAiChatStore = loadPersistedAiChats(),
): PersistedAiChatStore {
  const next: PersistedAiChatStore = { ...store };
  for (const [sessionId, chatKey] of Object.entries(sessionChatKeys)) {
    const messages = aiChatState[sessionId];
    if (messages && messages.length > 0) {
      next[chatKey] = messages;
    } else {
      delete next[chatKey];
    }
  }
  savePersistedAiChats(next);
  return next;
}

export function prunePersistedAiChats(
  aliveChatKeys: ReadonlySet<string>,
  store: PersistedAiChatStore = loadPersistedAiChats(),
): PersistedAiChatStore {
  let changed = false;
  const next: PersistedAiChatStore = {};
  for (const [key, messages] of Object.entries(store)) {
    if (aliveChatKeys.has(key)) {
      next[key] = messages;
    } else {
      changed = true;
    }
  }
  if (changed) {
    savePersistedAiChats(next);
  }
  return next;
}
