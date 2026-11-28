import { useCallback, useEffect, useMemo, useState } from "react";
import { messageFromUnknownError } from "../core/errors";
import { isTauri } from "../core/tauriRuntime";
import {
  mcpClientDiscoverTools,
  mcpClientServersSet,
  mcpServerSetEnabled,
  mcpServerStatus,
  mcpSettingsGet,
  type McpClientServerConfig,
  type McpClientToolDescriptor,
  type McpServerStatus,
} from "../core/terminal";

export interface McpSettingsSectionProps {
  modalOpen: boolean;
  enableMcpClientTools: boolean;
  onEnableMcpClientToolsChange: (enabled: boolean) => void;
}

export function buildNativeMcpConfigSnippet(binaryPath: string): string {
  return JSON.stringify(
    {
      mcpServers: {
        "mach-terminal": {
          command: binaryPath,
          args: [],
        },
      },
    },
    null,
    2,
  );
}

export function buildWslMcpConfigSnippet(binaryPath: string): string {
  return JSON.stringify(
    {
      mcpServers: {
        "mach-terminal": {
          command: "cmd.exe",
          args: ["/C", binaryPath],
        },
      },
    },
    null,
    2,
  );
}

export function McpSettingsSection({
  modalOpen,
  enableMcpClientTools,
  onEnableMcpClientToolsChange,
}: McpSettingsSectionProps) {
  const [serverStatus, setServerStatus] = useState<McpServerStatus>({
    enabled: false,
    binaryPath: null,
    configDir: "",
  });
  const [clientServers, setClientServers] = useState<McpClientServerConfig[]>([]);
  const [discoveredTools, setDiscoveredTools] = useState<McpClientToolDescriptor[]>([]);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [newServerId, setNewServerId] = useState("");
  const [newServerName, setNewServerName] = useState("");
  const [newServerCommand, setNewServerCommand] = useState("");
  const [newServerArgs, setNewServerArgs] = useState("");

  const loadMcpState = useCallback(async () => {
    if (!isTauri()) {
      return;
    }
    try {
      const [status, settings] = await Promise.all([mcpServerStatus(), mcpSettingsGet()]);
      setServerStatus(status);
      setClientServers(settings.clientServers ?? []);
      setErrorMessage(null);
    } catch (error) {
      setErrorMessage(messageFromUnknownError(error, "Failed to load MCP settings."));
    }
  }, []);

  useEffect(() => {
    if (!modalOpen) {
      return;
    }
    void loadMcpState();
  }, [modalOpen, loadMcpState]);

  const handleToggleServer = useCallback(async (enabled: boolean) => {
    setBusy(true);
    setErrorMessage(null);
    try {
      const updated = await mcpServerSetEnabled(enabled);
      setServerStatus(updated);
      setStatusMessage(
        enabled
          ? "Mach Terminal MCP stdio server enabled."
          : "Mach Terminal MCP stdio server disabled.",
      );
    } catch (error) {
      setErrorMessage(messageFromUnknownError(error, "Failed to update MCP server setting."));
    } finally {
      setBusy(false);
    }
  }, []);

  const persistClientServers = useCallback(
    async (nextServers: McpClientServerConfig[], notice: string) => {
      setBusy(true);
      setErrorMessage(null);
      try {
        const updated = await mcpClientServersSet(nextServers);
        setClientServers(updated.clientServers ?? nextServers);
        setStatusMessage(notice);
      } catch (error) {
        setErrorMessage(messageFromUnknownError(error, "Failed to save MCP client servers."));
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  const handleAddServer = useCallback(async () => {
    const id = newServerId.trim();
    const name = newServerName.trim() || id;
    const command = newServerCommand.trim();
    if (!id || !command) {
      setErrorMessage("Server ID and command are required.");
      return;
    }
    const args = newServerArgs
      .split(/\s+/)
      .map((token) => token.trim())
      .filter((token) => token.length > 0);
    const next: McpClientServerConfig[] = [
      ...clientServers,
      {
        id,
        name,
        command,
        args,
        enabled: true,
      },
    ];
    await persistClientServers(next, `Added MCP client server "${name}".`);
    setNewServerId("");
    setNewServerName("");
    setNewServerCommand("");
    setNewServerArgs("");
  }, [clientServers, newServerArgs, newServerCommand, newServerId, newServerName, persistClientServers]);

  const handleAddPreset = useCallback(
    async (preset: { id: string; name: string; command: string }) => {
      if (clientServers.some((s) => s.id === preset.id)) {
        setStatusMessage(`Preset "${preset.name}" is already in the list.`);
        return;
      }
      const next: McpClientServerConfig[] = [
        ...clientServers,
        {
          id: preset.id,
          name: preset.name,
          command: preset.command,
          args: [],
          enabled: true,
        },
      ];
      await persistClientServers(next, `Added preset "${preset.name}".`);
    },
    [clientServers, persistClientServers],
  );

  const handleToggleClientServer = useCallback(
    async (serverId: string, enabled: boolean) => {
      const next = clientServers.map((s) => (s.id === serverId ? { ...s, enabled } : s));
      await persistClientServers(next, `Updated MCP server "${serverId}".`);
    },
    [clientServers, persistClientServers],
  );

  const handleRemoveClientServer = useCallback(
    async (serverId: string) => {
      const next = clientServers.filter((s) => s.id !== serverId);
      await persistClientServers(next, `Removed MCP server "${serverId}".`);
    },
    [clientServers, persistClientServers],
  );

  const handleDiscoverTools = useCallback(async (serverId?: string) => {
    setBusy(true);
    setErrorMessage(null);
    try {
      const tools = await mcpClientDiscoverTools(serverId ?? null);
      setDiscoveredTools(tools);
      setStatusMessage(
        tools.length === 0
          ? "Connected, but 0 tools were returned (verify target MCP server is enabled)."
          : `Discovered ${tools.length} MCP tool(s).`,
      );
    } catch (error) {
      setErrorMessage(messageFromUnknownError(error, "Failed to discover tools from MCP server."));
    } finally {
      setBusy(false);
    }
  }, []);

  const nativeSnippet = useMemo(
    () => (serverStatus.binaryPath ? buildNativeMcpConfigSnippet(serverStatus.binaryPath) : null),
    [serverStatus.binaryPath],
  );

  return (
    <section id="settings-section-mcp">
      <h2>AI Agent (MCP)</h2>
      <p className="muted-block">
        Mach Terminal supports Model Context Protocol (MCP) in both directions: expose terminal history, tabs, and
        composer/AI-note handoffs via the built-in <code>mach-terminal-mcp</code> stdio server sidecar, and connect
        external MCP servers (like Mach Triage and Mach Armory) into the AI chat tool loop.
      </p>

      {statusMessage ? <p className="muted-block">{statusMessage}</p> : null}
      {errorMessage ? <p className="error-text">{errorMessage}</p> : null}

      <h3 className="settings-subsection-title">Built-in MCP Server (mach-terminal-mcp)</h3>
      <label className="toggle-row">
        <input
          type="checkbox"
          checked={serverStatus.enabled}
          disabled={busy}
          onChange={(event) => void handleToggleServer(event.currentTarget.checked)}
        />
        Enable Mach Terminal MCP stdio server
        <small className="muted-block">
          Allows external AI agents (Claude Desktop, Cursor, Antigravity) to query command history, workspace sessions,
          shell presets, and stage commands or AI notes via <code>machterm://</code> deep links. Off by default.
        </small>
      </label>

      {serverStatus.binaryPath ? (
        <div className="minimal-prompt-snippet-block mach-osc7-block">
          <div className="minimal-prompt-snippet-row">
            <span className="minimal-prompt-snippet-label">Cursor / Claude Desktop mcpServers JSON</span>
            <button
              type="button"
              className="inline-btn ghost"
              onClick={() => {
                if (nativeSnippet) {
                  void navigator.clipboard.writeText(nativeSnippet);
                  setStatusMessage("Copied MCP config snippet to clipboard.");
                }
              }}
            >
              Copy config
            </button>
          </div>
          <pre className="minimal-prompt-snippet">{nativeSnippet}</pre>
        </div>
      ) : (
        <p className="muted-block">
          Sidecar binary path: build with <code>npm run build:mcp</code> (or a release build) so{" "}
          <code>mach-terminal-mcp</code> is available alongside the app.
        </p>
      )}

      <h3 className="settings-subsection-title">MCP Client Bridge (External Tools for AI Panel)</h3>
      <label className="toggle-row">
        <input
          type="checkbox"
          checked={enableMcpClientTools}
          onChange={(event) => onEnableMcpClientToolsChange(event.currentTarget.checked)}
        />
        Enable external MCP tools in AI chat
        <small className="muted-block">
          When enabled, AI chat requests discover and invoke tools from enabled MCP stdio servers below.
        </small>
      </label>

      <div className="inline-controls">
        <button
          type="button"
          className="inline-btn ghost"
          disabled={busy}
          onClick={() =>
            void handleAddPreset({
              id: "mach-triage",
              name: "Mach Triage",
              command: "mach-triage-mcp",
            })
          }
        >
          + Add Mach Triage preset
        </button>
        <button
          type="button"
          className="inline-btn ghost"
          disabled={busy}
          onClick={() =>
            void handleAddPreset({
              id: "mach-armory",
              name: "Mach Armory",
              command: "mach-armory-mcp",
            })
          }
        >
          + Add Mach Armory preset
        </button>
        <button
          type="button"
          className="inline-btn"
          disabled={busy || clientServers.length === 0}
          onClick={() => void handleDiscoverTools()}
        >
          Discover tools from enabled servers
        </button>
      </div>

      {clientServers.length > 0 ? (
        <ul>
          {clientServers.map((server) => (
            <li key={server.id}>
              <div>
                <strong>{server.name}</strong> (<code>{server.id}</code>) —{" "}
                <code>
                  {server.command} {server.args.join(" ")}
                </code>
              </div>
              <div className="inline-controls">
                <label className="toggle-row">
                  <input
                    type="checkbox"
                    checked={server.enabled}
                    disabled={busy}
                    onChange={(event) =>
                      void handleToggleClientServer(server.id, event.currentTarget.checked)
                    }
                  />
                  Enabled
                </label>
                <button
                  type="button"
                  className="inline-btn ghost"
                  disabled={busy}
                  onClick={() => void handleDiscoverTools(server.id)}
                >
                  Test &amp; list tools
                </button>
                <button
                  type="button"
                  className="inline-btn ghost"
                  disabled={busy}
                  onClick={() => void handleRemoveClientServer(server.id)}
                >
                  Remove
                </button>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted-block">No external MCP servers configured yet.</p>
      )}

      <div className="stacked-controls">
        <label className="field-row">
          <span>Server ID</span>
          <input
            className="inline-input"
            placeholder="e.g. mach-triage"
            value={newServerId}
            onChange={(event) => setNewServerId(event.currentTarget.value)}
          />
        </label>
        <label className="field-row">
          <span>Display name</span>
          <input
            className="inline-input"
            placeholder="e.g. Mach Triage"
            value={newServerName}
            onChange={(event) => setNewServerName(event.currentTarget.value)}
          />
        </label>
        <label className="field-row">
          <span>Executable / command</span>
          <input
            className="inline-input"
            placeholder="e.g. C:\path\to\mach-triage-mcp.exe"
            value={newServerCommand}
            onChange={(event) => setNewServerCommand(event.currentTarget.value)}
          />
        </label>
        <label className="field-row">
          <span>Arguments (optional)</span>
          <input
            className="inline-input"
            placeholder="e.g. --db-path C:\path\to\mach-triage.db"
            value={newServerArgs}
            onChange={(event) => setNewServerArgs(event.currentTarget.value)}
          />
        </label>
        <div>
          <button type="button" className="inline-btn" disabled={busy} onClick={() => void handleAddServer()}>
            Add MCP server
          </button>
        </div>
      </div>

      {discoveredTools.length > 0 ? (
        <>
          <h3 className="settings-subsection-title">Discovered MCP Tools ({discoveredTools.length})</h3>
          <ul>
            {discoveredTools.map((tool) => (
              <li key={tool.qualifiedName}>
                <span>
                  <strong>{tool.serverName}</strong>: <code>{tool.toolName}</code> — {tool.description}
                </span>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </section>
  );
}
