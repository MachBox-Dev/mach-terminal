import type { Dispatch, SetStateAction } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { PLUGIN_REGISTRY } from "../core/plugins";
import { canRunAiRequest, isExecutableProvider } from "../core/providerUiState";
import type { ProviderDescriptor } from "../core/providers";
import type { RuntimeCapabilities } from "../core/runtime";
import type {
  AiContextEvent,
  HistoryEntry,
  ProviderRoutingSettings,
  PtySessionInfo,
  RuntimeMetricsSnapshot,
  SessionStatus,
  PluginMetricsSnapshot,
} from "../core/terminal";
import { HistoryPanel } from "./HistoryPanel";
import { ShellIntegrationSection } from "./ShellIntegrationSection";
import { StatusStripSettingsSection } from "./StatusStripSettingsSection";

const SETTINGS_SECTIONS: { id: string; label: string }[] = [
  { id: "settings-section-runtime", label: "Runtime" },
  { id: "settings-section-providers", label: "Providers" },
  { id: "settings-section-status-strip", label: "Status strip" },
  { id: "settings-section-shell-integration", label: "Shell integration" },
  { id: "settings-section-session", label: "Session & layout" },
  { id: "settings-section-updater", label: "Updater" },
  { id: "settings-section-ai", label: "AI router" },
  { id: "settings-section-history", label: "History" },
  { id: "settings-section-shortcuts", label: "Shortcuts" },
  { id: "settings-section-plugins", label: "Plugins" },
];

export type SettingsCommandItem = {
  id: string;
  label: string;
  shortcut?: string;
};

export type AppSettingsModalProps = {
  open: boolean;
  onClose: () => void;
  onOpenProfile: () => void;
  onRefreshMetrics: () => void | Promise<void>;
  capabilities: RuntimeCapabilities;
  runtimeError: string | null;
  runtimeMetrics: RuntimeMetricsSnapshot | null;
  providers: ProviderDescriptor[];
  providerConfigStatus: string | null;
  providerEndpointDrafts: Record<string, string>;
  providerApiKeyDrafts: Record<string, string>;
  updateProviderEndpointDraft: (id: string, value: string) => void;
  updateProviderApiKeyDraft: (id: string, value: string) => void;
  toggleProvider: (id: string, enabled: boolean) => void | Promise<void>;
  saveProviderEndpoint: (id: string) => void | Promise<void>;
  saveProviderApiKey: (id: string) => void | Promise<void>;
  clearProviderApiKey: (id: string) => void | Promise<void>;
  activeSession: PtySessionInfo | undefined;
  sessionStatus: Record<string, SessionStatus>;
  restartActiveSession: () => void | Promise<void>;
  splitPane: () => void;
  splitPaneColumn: () => void;
  splitPaneRow: () => void;
  closeActivePane: () => void;
  onOpenCommandPalette: () => void;
  workspaceSplitDirection: string;
  checkForUpdates: () => void | Promise<void>;
  updateStatus: string;
  updaterEnabled: boolean;
  routing: ProviderRoutingSettings;
  routingDraft: {
    default_provider: string;
    ollama_model: string;
    openai_model: string;
    anthropic_model: string;
    custom_openai_model: string;
  };
  setRoutingDraft: Dispatch<
    SetStateAction<{
      default_provider: string;
      ollama_model: string;
      openai_model: string;
      anthropic_model: string;
      custom_openai_model: string;
    }>
  >;
  saveRoutingConfig: () => void | Promise<void>;
  setAiOptIn: (enabled: boolean) => void | Promise<void>;
  aiPrompt: string;
  setAiPrompt: (value: string) => void;
  runAiPrompt: () => void | Promise<void>;
  aiRequestInFlight: boolean;
  aiRequestStatus: string | null;
  aiResponse: string | null;
  lastAiContext: AiContextEvent | null;
  historyEntries: HistoryEntry[];
  historyLoading: boolean;
  historyError: string | null;
  historyActionStatus: string | null;
  onReplayCommand: (command: string) => void | Promise<void>;
  onExplainCommand: (command: string) => void | Promise<void>;
  onFixCommand: (command: string) => void | Promise<void>;
  globalShortcutItems: SettingsCommandItem[];
  terminalCommandItems: SettingsCommandItem[];
  pluginResult: string | null;
  pluginPolicyDecision: string | null;
  pluginGrantSummary: string | null;
  pluginTelemetry: PluginMetricsSnapshot | null;
  runPluginDemo: () => void | Promise<void>;
};

export function AppSettingsModal(props: AppSettingsModalProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [activeSectionId, setActiveSectionId] = useState(
    () => SETTINGS_SECTIONS[0]?.id ?? "settings-section-runtime",
  );

  useEffect(() => {
    if (!props.open) {
      return;
    }
    const first = SETTINGS_SECTIONS[0]?.id;
    if (first) {
      setActiveSectionId(first);
    }
  }, [props.open]);

  const scrollToSection = useCallback((id: string) => {
    setActiveSectionId(id);
    queueMicrotask(() => {
      document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }, []);

  if (!props.open) {
    return null;
  }

  const {
    onClose,
    onOpenProfile,
    onRefreshMetrics,
    capabilities,
    runtimeError,
    runtimeMetrics,
    providers,
    providerConfigStatus,
    providerEndpointDrafts,
    providerApiKeyDrafts,
    updateProviderEndpointDraft,
    updateProviderApiKeyDraft,
    toggleProvider,
    saveProviderEndpoint,
    saveProviderApiKey,
    clearProviderApiKey,
    activeSession,
    sessionStatus,
    restartActiveSession,
    splitPane,
    splitPaneColumn,
    splitPaneRow,
    closeActivePane,
    onOpenCommandPalette,
    workspaceSplitDirection,
    checkForUpdates,
    updateStatus,
    updaterEnabled,
    routing,
    routingDraft,
    setRoutingDraft,
    saveRoutingConfig,
    setAiOptIn,
    aiPrompt,
    setAiPrompt,
    runAiPrompt,
    aiRequestInFlight,
    aiRequestStatus,
    aiResponse,
    lastAiContext,
    historyEntries,
    historyLoading,
    historyError,
    historyActionStatus,
    onReplayCommand,
    onExplainCommand,
    onFixCommand,
    globalShortcutItems,
    terminalCommandItems,
    pluginResult,
    pluginPolicyDecision,
    pluginGrantSummary,
    pluginTelemetry,
    runPluginDemo,
  } = props;

  return (
    <div
      className="modal-overlay settings-modal-overlay"
      role="presentation"
      onClick={() => {
        onClose();
      }}
    >
      <div
        className="modal-card settings-modal-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-modal-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="settings-modal-toolbar">
          <h2 id="settings-modal-title">Settings</h2>
          <div className="settings-modal-toolbar-actions">
            <button type="button" className="inline-btn ghost" onClick={() => void onRefreshMetrics()}>
              Refresh metrics
            </button>
            <button
              type="button"
              className="inline-btn"
              onClick={() => {
                onOpenProfile();
              }}
            >
              Shell, font &amp; profile
            </button>
            <button type="button" className="inline-btn ghost" onClick={onClose}>
              Close
            </button>
          </div>
        </div>

        <div className="settings-modal-body">
          <nav className="settings-modal-nav" aria-label="Settings sections">
            <p className="settings-modal-nav-title">Jump to</p>
            {SETTINGS_SECTIONS.map((section) => (
              <button
                key={section.id}
                type="button"
                className={activeSectionId === section.id ? "active" : ""}
                aria-current={activeSectionId === section.id ? "location" : undefined}
                onClick={() => scrollToSection(section.id)}
              >
                {section.label}
              </button>
            ))}
          </nav>

          <div className="settings-modal-scroll" ref={scrollRef}>
            <div className="info-panel settings-modal-panel">
            <section id="settings-section-runtime">
              <h2>Runtime</h2>
              {runtimeError ? <p className="error-text">{runtimeError}</p> : null}
              <ul>
                <li>
                  <span>Session persistence</span>
                  <strong>{capabilities.session_persistence ? "enabled" : "disabled"}</strong>
                </li>
                <li>
                  <span>Plugin host</span>
                  <strong>{capabilities.plugin_host ? "enabled" : "disabled"}</strong>
                </li>
                <li>
                  <span>Provider host</span>
                  <strong>{capabilities.provider_host ? "enabled" : "disabled"}</strong>
                </li>
                <li>
                  <span>Provider routing</span>
                  <strong>{capabilities.provider_routing ? "enabled" : "disabled"}</strong>
                </li>
                <li>
                  <span>PTY backend</span>
                  <strong>{capabilities.pty_backend}</strong>
                </li>
              </ul>
              {runtimeMetrics ? (
                <div className="metrics-grid">
                  <p>chunks emitted: {runtimeMetrics.output_chunks_emitted}</p>
                  <p>chunks dropped: {runtimeMetrics.output_chunks_dropped}</p>
                  <p>emit failures: {runtimeMetrics.emit_failures}</p>
                  <p>sequence anomalies: {runtimeMetrics.sequence_anomalies}</p>
                  <p className="metrics-hint">
                    Counts are from the native PTY host. The UI ignores duplicate sequence numbers so output is not
                    applied twice; rewinds or huge jumps still surface as anomalies above.
                  </p>
                </div>
              ) : null}
            </section>

            <section id="settings-section-providers">
              <h2>Providers</h2>
              {providerConfigStatus ? <p className="muted-block">{providerConfigStatus}</p> : null}
              <ul className="provider-block-list">
                {providers.map((provider) => (
                  <li key={provider.id}>
                    <div className="provider-block-head">
                      <span>
                        {provider.name}
                        <small>{provider.kind}</small>
                      </span>
                      <strong>{isExecutableProvider(provider.id) ? provider.status : "unavailable"}</strong>
                      <button
                        type="button"
                        onClick={() => void toggleProvider(provider.id, !provider.enabled)}
                        className="inline-btn"
                        disabled={!isExecutableProvider(provider.id) && !provider.enabled}
                      >
                        {provider.enabled ? "disable" : "enable"}
                      </button>
                    </div>
                    <div className="provider-block-endpoint">
                      <input
                        value={providerEndpointDrafts[provider.id] ?? ""}
                        onChange={(event) => updateProviderEndpointDraft(provider.id, event.currentTarget.value)}
                        placeholder="Endpoint URL"
                        className="inline-input"
                        aria-label={`${provider.id} endpoint`}
                        disabled={!isExecutableProvider(provider.id)}
                      />
                      <button
                        type="button"
                        className="inline-btn ghost"
                        onClick={() => void saveProviderEndpoint(provider.id)}
                        disabled={!isExecutableProvider(provider.id)}
                      >
                        save endpoint
                      </button>
                    </div>
                    <div className="provider-block-endpoint">
                      <input
                        type="password"
                        value={providerApiKeyDrafts[provider.id] ?? ""}
                        onChange={(event) => updateProviderApiKeyDraft(provider.id, event.currentTarget.value)}
                        placeholder={provider.hasStoredKey ? "API key stored (enter to replace)" : "API key"}
                        className="inline-input"
                        aria-label={`${provider.id} api key`}
                        disabled={!isExecutableProvider(provider.id)}
                      />
                      <button
                        type="button"
                        className="inline-btn ghost"
                        onClick={() => void saveProviderApiKey(provider.id)}
                        disabled={!isExecutableProvider(provider.id)}
                      >
                        save key
                      </button>
                      <button
                        type="button"
                        className="inline-btn ghost"
                        onClick={() => void clearProviderApiKey(provider.id)}
                        disabled={!isExecutableProvider(provider.id)}
                      >
                        clear key
                      </button>
                    </div>
                    <p className="muted-block">
                      auth: {provider.hasStoredKey ? "stored in secure keychain" : "no stored key"}{" "}
                      {provider.envHint ? `(env fallback: ${provider.envHint})` : ""}
                    </p>
                  </li>
                ))}
              </ul>
            </section>

            <StatusStripSettingsSection modalOpen={props.open} sectionId="settings-section-status-strip" />

            <ShellIntegrationSection modalOpen={props.open} />

            <section id="settings-section-session">
              <h2>Session &amp; layout</h2>
              <p className="muted-block">
                active session: {activeSession?.id ?? "none"} (
                {activeSession ? sessionStatus[activeSession.id] ?? activeSession.status : "idle"})
              </p>
              <div className="inline-controls">
                <button type="button" className="inline-btn" onClick={() => void restartActiveSession()}>
                  restart session
                </button>
                <button type="button" className="inline-btn" onClick={() => splitPane()}>
                  split ({workspaceSplitDirection})
                </button>
                <button type="button" className="inline-btn ghost" onClick={() => splitPaneColumn()}>
                  split vertical
                </button>
                <button type="button" className="inline-btn ghost" onClick={() => splitPaneRow()}>
                  split horizontal
                </button>
                <button type="button" className="inline-btn" onClick={() => closeActivePane()}>
                  close pane
                </button>
                <button
                  type="button"
                  className="inline-btn"
                  onClick={() => {
                    onOpenCommandPalette();
                    onClose();
                  }}
                >
                  command palette
                </button>
              </div>
            </section>

            <section id="settings-section-updater">
              <h2>Updater</h2>
              <div className="inline-controls">
                <button type="button" className="inline-btn" onClick={() => void checkForUpdates()} disabled={!updaterEnabled}>
                  check for updates
                </button>
                <p className="muted-block">
                  status: {updateStatus}
                  {!updaterEnabled ? (
                    <span>
                      {" "}
                      (updater runs only in release builds with <code>VITE_ENABLE_UPDATER=true</code>.)
                    </span>
                  ) : null}
                </p>
              </div>
            </section>

            <section id="settings-section-ai">
              <h2>AI Router (v0)</h2>
              <div className="stacked-controls">
                <label className="field-row">
                  <span>Default provider</span>
                  <select
                    value={routingDraft.default_provider}
                    onChange={(event) => setRoutingDraft((current) => ({ ...current, default_provider: event.target.value }))}
                  >
                    {providers.map((provider) => (
                      <option key={provider.id} value={provider.id} disabled={!isExecutableProvider(provider.id)}>
                        {provider.name} ({provider.id}){!isExecutableProvider(provider.id) ? " - unavailable" : ""}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field-row">
                  <span>Ollama model</span>
                  <input
                    value={routingDraft.ollama_model}
                    onChange={(event) => setRoutingDraft((current) => ({ ...current, ollama_model: event.target.value }))}
                  />
                </label>
                <label className="field-row">
                  <span>OpenAI model</span>
                  <input
                    value={routingDraft.openai_model}
                    onChange={(event) => setRoutingDraft((current) => ({ ...current, openai_model: event.target.value }))}
                  />
                </label>
                <label className="field-row">
                  <span>Anthropic model</span>
                  <input
                    value={routingDraft.anthropic_model}
                    onChange={(event) =>
                      setRoutingDraft((current) => ({ ...current, anthropic_model: event.target.value }))
                    }
                  />
                </label>
                <label className="field-row">
                  <span>Custom OpenAI model</span>
                  <input
                    value={routingDraft.custom_openai_model}
                    onChange={(event) =>
                      setRoutingDraft((current) => ({ ...current, custom_openai_model: event.target.value }))
                    }
                  />
                </label>
                <button type="button" className="inline-btn ghost" onClick={() => void saveRoutingConfig()}>
                  save routing config
                </button>
                <label className="toggle-row">
                  <input
                    type="checkbox"
                    checked={routing.ai_feature_enabled}
                    onChange={(event) => void setAiOptIn(event.currentTarget.checked)}
                  />
                  AI opt-in required
                </label>
                <input value={aiPrompt} onChange={(event) => setAiPrompt(event.currentTarget.value)} />
                <button
                  type="button"
                  className="inline-btn"
                  onClick={() => void runAiPrompt()}
                  disabled={!canRunAiRequest(routing.ai_feature_enabled, aiRequestInFlight)}
                >
                  {aiRequestInFlight ? "running..." : "run ai prompt"}
                </button>
                {!routing.ai_feature_enabled ? (
                  <p className="muted-block">
                    AI requests are blocked until you enable AI opt-in. Provider endpoints and routing can still be configured.
                  </p>
                ) : null}
                {aiRequestStatus ? <p className="muted-block">{aiRequestStatus}</p> : null}
                {aiResponse ? <p className="muted-block">{aiResponse}</p> : null}
                {lastAiContext ? (
                  <p className="muted-block">
                    context: {lastAiContext.event_type} - {lastAiContext.payload}
                  </p>
                ) : null}
              </div>
            </section>

            <HistoryPanel
              sectionId="settings-section-history"
              entries={historyEntries}
              loading={historyLoading}
              aiBusy={aiRequestInFlight}
              error={historyError}
              actionStatus={historyActionStatus}
              onReplay={(command) => void onReplayCommand(command)}
              onExplain={(command) => void onExplainCommand(command)}
              onFix={(command) => void onFixCommand(command)}
            />

            <section id="settings-section-shortcuts">
              <h2>Keyboard shortcuts</h2>
              <ul>
                {globalShortcutItems.map((command) => (
                  <li key={command.id}>
                    <span>{command.label}</span>
                    <strong>{command.shortcut ?? "unbound"}</strong>
                  </li>
                ))}
              </ul>
              <p className="muted-block">Terminal-focused commands (palette or terminal local keys):</p>
              <ul>
                {terminalCommandItems.map((command) => (
                  <li key={command.id}>
                    <span>{command.label}</span>
                    <strong>{command.shortcut ?? "palette"}</strong>
                  </li>
                ))}
              </ul>
            </section>

            <section id="settings-section-plugins">
              <h2>Plugin contracts</h2>
              <ul>
                {PLUGIN_REGISTRY.map((plugin) => (
                  <li key={plugin.id}>
                    <span>{plugin.name}</span>
                    <strong>{plugin.stage}</strong>
                  </li>
                ))}
              </ul>
              <div className="inline-controls">
                <button type="button" className="inline-btn" onClick={() => void runPluginDemo()}>
                  run plugin demo
                </button>
                {pluginResult ? <p className="muted-block">{pluginResult}</p> : null}
                {pluginPolicyDecision ? <p className="muted-block">{pluginPolicyDecision}</p> : null}
                {pluginGrantSummary ? <p className="muted-block">{pluginGrantSummary}</p> : null}
                {pluginTelemetry ? (
                  <p className="muted-block">
                    telemetry: grants={pluginTelemetry.grantsTotal}, allowed={pluginTelemetry.executionAllowedTotal},
                    denied={pluginTelemetry.executionDeniedTotal}, total={pluginTelemetry.executionTotal}, last=
                    {pluginTelemetry.lastExecutionMs ?? 0}ms
                  </p>
                ) : null}
              </div>
            </section>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
