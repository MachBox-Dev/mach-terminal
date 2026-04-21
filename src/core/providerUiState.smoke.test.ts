import { describe, expect, it } from "vitest";
import {
  aiErrorStatusMessage,
  canRunAiRequest,
  isExecutableProvider,
  providerToggleStatus,
} from "./providerUiState";

describe("Provider UI smoke contracts", () => {
  it("keeps AI opt-in/request-in-flight gate stable", () => {
    expect(canRunAiRequest(true, false)).toBe(true);
    expect(canRunAiRequest(false, false)).toBe(false);
    expect(canRunAiRequest(true, true)).toBe(false);
  });

  it("preserves runtime executable-provider allowlist contract", () => {
    expect(isExecutableProvider("openai")).toBe(true);
    expect(isExecutableProvider("anthropic")).toBe(true);
    expect(isExecutableProvider("ollama")).toBe(true);
    expect(isExecutableProvider("custom-openai")).toBe(true);
    expect(isExecutableProvider("mock-provider")).toBe(false);
  });

  it("keeps provider toggle status wording stable", () => {
    expect(providerToggleStatus("openai", true)).toBe("Enabled provider openai.");
    expect(providerToggleStatus("openai", false)).toBe("Disabled provider openai.");
  });

  it("maps backend endpoint/auth failures to stable user-facing statuses", () => {
    expect(aiErrorStatusMessage("Provider endpoint is unreachable. timeout")).toBe("Provider endpoint is unreachable.");
    expect(aiErrorStatusMessage("Provider endpoint is invalid. missing host")).toBe("Provider endpoint URL is invalid.");
    expect(aiErrorStatusMessage("Provider `openai` is missing credentials.")).toBe("Provider credentials are missing.");
  });
});
