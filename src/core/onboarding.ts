import type { ProviderRoutingSettings, ProviderSettings, TerminalProfile } from "./terminal";

export const QUICKSTART_ROUTING: ProviderRoutingSettings = {
  default_provider: "ollama",
  ollama_model: "llama3.2",
  ai_feature_enabled: false,
};

export function normalizeQuickStartProfile(profile: TerminalProfile): TerminalProfile {
  return {
    shell: profile.shell,
    cwd: profile.cwd,
    env: profile.env ?? {},
    font_size: profile.font_size,
  };
}

export function toQuickStartProviders(providers: ProviderSettings[]): ProviderSettings[] {
  return providers.map((provider) => ({ ...provider, enabled: false }));
}
