export type ProviderStatus = "disabled" | "available";

export interface ProviderDescriptor {
  id: string;
  name: string;
  status: ProviderStatus;
  kind: "cloud" | "local" | "custom";
  enabled: boolean;
  endpoint?: string;
  envHint?: string;
}

export interface ProviderSettings {
  id: string;
  enabled: boolean;
  endpoint?: string;
  api_key_env?: string;
}

export const PROVIDER_REGISTRY: ProviderDescriptor[] = [
  {
    id: "openai",
    name: "OpenAI",
    status: "disabled",
    enabled: false,
    kind: "cloud",
    envHint: "OPENAI_API_KEY",
  },
  {
    id: "anthropic",
    name: "Anthropic",
    status: "disabled",
    enabled: false,
    kind: "cloud",
    envHint: "ANTHROPIC_API_KEY",
  },
  { id: "ollama", name: "Ollama (localhost)", status: "disabled", enabled: false, kind: "local" },
  {
    id: "custom-openai",
    name: "Custom OpenAI-compatible",
    status: "disabled",
    enabled: false,
    kind: "custom",
  },
];
