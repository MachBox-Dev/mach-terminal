import { describe, expect, it } from "vitest";
import { normalizeQuickStartProfile, QUICKSTART_ROUTING, toQuickStartProviders } from "./onboarding";

describe("onboarding quick-start helpers", () => {
  it("uses AI-off routing defaults for quick start", () => {
    expect(QUICKSTART_ROUTING).toEqual({
      default_provider: "ollama",
      ollama_model: "llama3.2",
      ai_feature_enabled: false,
    });
  });

  it("forces all providers disabled for quick start", () => {
    const providers = [
      { id: "ollama", enabled: true, endpoint: "http://127.0.0.1:11434" },
      { id: "openai", enabled: true, endpoint: "https://api.openai.com" },
    ];
    const normalized = toQuickStartProviders(providers);
    expect(normalized.every((provider) => provider.enabled === false)).toBe(true);
  });

  it("preserves profile defaults while normalizing env object", () => {
    const profile = {
      shell: "pwsh",
      cwd: "C:/Users/demo",
      env: {},
      font_size: 14,
    };
    expect(normalizeQuickStartProfile(profile)).toEqual(profile);
  });
});
