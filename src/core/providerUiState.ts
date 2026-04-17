export type AiErrorCategory =
  | "routing_disabled"
  | "provider_disabled"
  | "endpoint_unreachable"
  | "invalid_endpoint"
  | "upstream_error"
  | "decode_error"
  | "generic";

const EXECUTABLE_PROVIDER_IDS = new Set(["ollama"]);

export function canRunAiRequest(aiOptInEnabled: boolean, requestInFlight: boolean): boolean {
  return aiOptInEnabled && !requestInFlight;
}

export function isExecutableProvider(providerId: string): boolean {
  return EXECUTABLE_PROVIDER_IDS.has(providerId);
}

export function providerToggleStatus(providerId: string, enabled: boolean): string {
  return `${enabled ? "Enabled" : "Disabled"} provider ${providerId}.`;
}

export function classifyAiError(message: string): AiErrorCategory {
  const lowered = message.toLowerCase();
  if (lowered.includes("routing is disabled")) {
    return "routing_disabled";
  }
  if (lowered.includes("is disabled")) {
    return "provider_disabled";
  }
  if (lowered.includes("unreachable")) {
    return "endpoint_unreachable";
  }
  if (lowered.includes("endpoint is invalid")) {
    return "invalid_endpoint";
  }
  if (lowered.includes("error response")) {
    return "upstream_error";
  }
  if (lowered.includes("could not be decoded")) {
    return "decode_error";
  }
  return "generic";
}

export function aiErrorStatusMessage(message: string): string {
  const category = classifyAiError(message);
  switch (category) {
    case "routing_disabled":
      return "AI is disabled in routing settings.";
    case "provider_disabled":
      return "Selected provider is disabled.";
    case "endpoint_unreachable":
      return "Provider endpoint is unreachable.";
    case "invalid_endpoint":
      return "Provider endpoint URL is invalid.";
    case "upstream_error":
      return "Provider returned an error response.";
    case "decode_error":
      return "Provider response format was invalid.";
    default:
      return "AI request failed.";
  }
}
