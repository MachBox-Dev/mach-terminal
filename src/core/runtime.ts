export interface RuntimeCapabilities {
  pty_backend: string;
  plugin_host: boolean;
  plugin_policy?: boolean;
  plugin_telemetry?: boolean;
  provider_host: boolean;
  session_persistence: boolean;
  provider_routing: boolean;
}

export const DEFAULT_RUNTIME_CAPABILITIES: RuntimeCapabilities = {
  pty_backend: "portable-pty",
  plugin_host: true,
  plugin_policy: true,
  plugin_telemetry: true,
  provider_host: true,
  session_persistence: true,
  provider_routing: true,
};
