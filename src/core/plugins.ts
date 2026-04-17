export type PluginStage = "alpha" | "planned";

export interface PluginDescriptor {
  id: string;
  name: string;
  stage: PluginStage;
  capabilities: readonly string[];
}

export const PLUGIN_REGISTRY: PluginDescriptor[] = [
  {
    id: "history-tools",
    name: "History Tools",
    stage: "alpha",
    capabilities: ["command-history.read", "command-history.search"],
  },
  {
    id: "session-restore",
    name: "Session Restore",
    stage: "alpha",
    capabilities: ["sessions.read", "sessions.write"],
  },
  {
    id: "provider-router",
    name: "Provider Router",
    stage: "planned",
    capabilities: ["provider-host.read", "provider-host.route"],
  },
];
