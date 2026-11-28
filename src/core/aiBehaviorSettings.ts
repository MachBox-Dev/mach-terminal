export type AiBehaviorSettings = {
  /** When true, AI prompts are echoed on the session tape as `# AI: …` lines. */
  echoAiPromptToTape: boolean;
  /** When true, configured AI providers may call read-only ops-rail tools (command log lookup). */
  enableAiTools: boolean;
  /** When true, configured AI providers may also call tools from enabled external MCP servers. */
  enableMcpClientTools: boolean;
};

export const AI_BEHAVIOR_STORAGE_KEY = "mach-terminal.aiBehavior.v1";

export const DEFAULT_AI_BEHAVIOR_SETTINGS: AiBehaviorSettings = {
  echoAiPromptToTape: true,
  enableAiTools: true,
  enableMcpClientTools: true,
};

export function loadAiBehaviorSettings(): AiBehaviorSettings {
  if (typeof window === "undefined") {
    return DEFAULT_AI_BEHAVIOR_SETTINGS;
  }
  try {
    const raw = window.localStorage.getItem(AI_BEHAVIOR_STORAGE_KEY);
    if (!raw) {
      return DEFAULT_AI_BEHAVIOR_SETTINGS;
    }
    const parsed = JSON.parse(raw) as Partial<AiBehaviorSettings>;
    return { ...DEFAULT_AI_BEHAVIOR_SETTINGS, ...parsed };
  } catch {
    return DEFAULT_AI_BEHAVIOR_SETTINGS;
  }
}

export function saveAiBehaviorSettings(settings: AiBehaviorSettings): void {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.localStorage.setItem(AI_BEHAVIOR_STORAGE_KEY, JSON.stringify(settings));
    window.dispatchEvent(new CustomEvent("mach-terminal-ai-behavior-settings"));
  } catch {
    /* ignore */
  }
}
