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

const pluginCapabilityIndex = new Map<string, Set<string>>(
  PLUGIN_REGISTRY.map((plugin) => [plugin.id, new Set(plugin.capabilities)]),
);

export function isKnownPluginId(pluginId: string): boolean {
  return pluginCapabilityIndex.has(pluginId);
}

export function isPluginCapabilityDeclared(pluginId: string, capability: string): boolean {
  return pluginCapabilityIndex.get(pluginId)?.has(capability) ?? false;
}
