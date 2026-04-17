import { describe, expect, it } from "vitest";
import {
  aiErrorStatusMessage,
  canRunAiRequest,
  classifyAiError,
  isExecutableProvider,
  providerToggleStatus,
} from "./providerUiState";

describe("provider ui state helpers", () => {
  it("gates AI request execution by opt-in and in-flight status", () => {
    expect(canRunAiRequest(true, false)).toBe(true);
    expect(canRunAiRequest(false, false)).toBe(false);
    expect(canRunAiRequest(true, true)).toBe(false);
  });

  it("formats provider toggle status for enable/disable transitions", () => {
    expect(providerToggleStatus("ollama", true)).toBe("Enabled provider ollama.");
    expect(providerToggleStatus("openai", false)).toBe("Disabled provider openai.");
  });

  it("marks only runtime-supported providers as executable", () => {
    expect(isExecutableProvider("ollama")).toBe(true);
    expect(isExecutableProvider("openai")).toBe(false);
    expect(isExecutableProvider("anthropic")).toBe(false);
    expect(isExecutableProvider("custom-openai")).toBe(false);
  });

  it("classifies backend AI errors into stable frontend categories", () => {
    expect(classifyAiError("AI routing is disabled. Enable AI opt-in in provider routing settings before sending AI requests."))
      .toBe("routing_disabled");
    expect(classifyAiError("Provider `ollama` is disabled. Enable it in settings before sending AI requests."))
      .toBe("provider_disabled");
    expect(classifyAiError("Provider endpoint is unreachable. connection refused"))
      .toBe("endpoint_unreachable");
    expect(classifyAiError("Provider endpoint is invalid. missing host"))
      .toBe("invalid_endpoint");
    expect(classifyAiError("Provider returned an error response. 500"))
      .toBe("upstream_error");
    expect(classifyAiError("Provider response could not be decoded. EOF"))
      .toBe("decode_error");
  });

  it("maps backend errors to user-facing status text", () => {
    expect(aiErrorStatusMessage("Provider endpoint is unreachable. timeout")).toBe("Provider endpoint is unreachable.");
    expect(aiErrorStatusMessage("something totally unexpected")).toBe("AI request failed.");
  });
});
