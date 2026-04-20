import type { ProviderRoutingSettings, ProviderSettings, TerminalProfile } from "./terminal";

export const QUICKSTART_ROUTING: ProviderRoutingSettings = {
  default_provider: "ollama",
  ollama_model: "llama3.2",
  openai_model: "gpt-4o-mini",
  anthropic_model: "claude-3-5-haiku-latest",
  custom_openai_model: "gpt-4o-mini",
  ai_feature_enabled: false,
};

export function normalizeQuickStartProfile(profile: TerminalProfile): TerminalProfile {
  return {
    shell: profile.shell,
    cwd: profile.cwd,
    env: profile.env ?? {},
    font_size: profile.font_size,
    minimal_shell_prompt: profile.minimal_shell_prompt ?? false,
    show_composer_assist_metrics: profile.show_composer_assist_metrics ?? false,
  };
}

export function toQuickStartProviders(providers: ProviderSettings[]): ProviderSettings[] {
  return providers.map((provider) => ({ ...provider, enabled: false }));
}
