import type { Dispatch, SetStateAction } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { PLUGIN_REGISTRY } from "../core/plugins";
import {
  aiOptInRequiredStatus,
  buildProviderCards,
  canRunAiRequest,
  isAiAssistReady,
  isExecutableProvider,
  providerOptionSuffix,
  type RoutingModelKey,
} from "../core/providerUiState";
import { uiSurfaceFindLabel, uiSurfaceFollowLabel, type UiSurfaceState } from "../core/uiSurfaceState";
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
import {
  MACH_MINIMAL_PROMPT_BASH,
  MACH_MINIMAL_PROMPT_PWSH,
  MACH_MINIMAL_PROMPT_ZSH,
} from "../core/machShellSnippets";
import { HistoryPanel } from "./HistoryPanel";
import { ShellIntegrationSection } from "./ShellIntegrationSection";
import { StatusStripSettingsSection } from "./StatusStripSettingsSection";
import { TerminalProfileSection } from "./TerminalProfileSection";
import type { TerminalProfile } from "../core/terminal";

type SettingsSection = { id: string; label: string; devOnly?: boolean };

const SETTINGS_SECTIONS: SettingsSection[] = [
  { id: "settings-section-runtime", label: "Runtime" },
  { id: "settings-section-terminal-profile", label: "Terminal profile" },
  { id: "settings-section-ai-providers", label: "AI providers" },
  { id: "settings-section-status-strip", label: "Status strip" },
  { id: "settings-section-shell-integration", label: "Shell integration" },
  { id: "settings-section-session", label: "Session & layout" },
  { id: "settings-section-updater", label: "Updater" },
  { id: "settings-section-history", label: "History" },
  { id: "settings-section-shortcuts", label: "Shortcuts" },
  { id: "settings-section-plugins", label: "Plugins", devOnly: true },
];

export type SettingsCommandItem = {
  id: string;
  label: string;
  shortcut?: string;
};

export type AppSettingsModalProps = {
  open: boolean;
  /** When set, this section is selected when the modal opens. */
  initialSectionId?: string;
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
  onToggleFollowOutput: () => void | Promise<void>;
  onOpenTerminalFind: () => void | Promise<void>;
  onFindNextMatch: () => void | Promise<void>;
  onFindPreviousMatch: () => void | Promise<void>;
  uiSurfaceState: UiSurfaceState | null;
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
    system_prompt: string;
    ai_context_budget_chars: number;
  };
  setRoutingDraft: Dispatch<
    SetStateAction<{
      default_provider: string;
      ollama_model: string;
      openai_model: string;
      anthropic_model: string;
      custom_openai_model: string;
      system_prompt: string;
      ai_context_budget_chars: number;
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
  /** When true, new sessions set `MACH_TERMINAL_MINIMAL_PROMPT=1` (thin shell prompt in scrollback; pair with rc snippets). */
  minimalShellPrompt: boolean;
  onMinimalShellPromptChange: (enabled: boolean) => void | Promise<void>;
  /** When true, AI prompts are echoed as `# AI: …` shell comments on the session tape. */
  echoAiPromptToTape: boolean;
  onEchoAiPromptToTapeChange: (enabled: boolean) => void;
  /** When true, eligible AI providers may call read-only ops-rail tools. */
  enableAiTools: boolean;
  onEnableAiToolsChange: (enabled: boolean) => void;
  /** Show composer completion assist metrics outside dev builds. */
  showComposerAssistMetrics: boolean;
  onShowComposerAssistMetricsChange: (enabled: boolean) => void | Promise<void>;
  /** Called after the terminal profile is saved so the app can refresh live state (font size, etc.). */
  onProfileSaved?: (profile: TerminalProfile) => void | Promise<void>;
};

export function buildHistoryPanelHandlers(
  onReplayCommand: AppSettingsModalProps["onReplayCommand"],
  onExplainCommand: AppSettingsModalProps["onExplainCommand"],
  onFixCommand: AppSettingsModalProps["onFixCommand"],
) {
  return {
    onReplay: (command: string) => void onReplayCommand(command),
    onExplain: (command: string) => void onExplainCommand(command),
    onFix: (command: string) => void onFixCommand(command),
  };
}

export function AppSettingsModal(props: AppSettingsModalProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [activeSectionId, setActiveSectionId] = useState(
    () => SETTINGS_SECTIONS[0]?.id ?? "settings-section-runtime",
  );

  useEffect(() => {
    if (!props.open) {
      return;
    }
    const requested = props.initialSectionId;
    const valid = requested && SETTINGS_SECTIONS.some((section) => section.id === requested);
    const target = valid ? requested : SETTINGS_SECTIONS[0]?.id;
    if (target) {
      setActiveSectionId(target);
    }
  }, [props.open, props.initialSectionId]);

  // Tab-style switch: show only the active section and reset scroll to its top.
  // No more scrolling past every other section to reach the one you want.
  const selectSection = useCallback((id: string) => {
    setActiveSectionId(id);
    scrollRef.current?.scrollTo({ top: 0 });
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
    onToggleFollowOutput,
    onOpenTerminalFind,
    onFindNextMatch,
    onFindPreviousMatch,
    uiSurfaceState,
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
    minimalShellPrompt,
    onMinimalShellPromptChange,
    showComposerAssistMetrics,
    onShowComposerAssistMetricsChange,
    onProfileSaved,
  } = props;
  const historyHandlers = buildHistoryPanelHandlers(onReplayCommand, onExplainCommand, onFixCommand);
  const showDevTools = import.meta.env.DEV;
  const visibleSections = SETTINGS_SECTIONS.filter((section) => showDevTools || !section.devOnly);
  const paneHidden = (id: string) => activeSectionId !== id;
  const providerCards = buildProviderCards(providers, routingDraft.default_provider);
  const aiAssistEnabled = isAiAssistReady(routing.ai_feature_enabled, routing.default_provider, providers);

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
          <nav className="settings-modal-nav" aria-label="Settings sections" role="tablist" aria-orientation="vertical">
            <p className="settings-modal-nav-title">Sections</p>
            {visibleSections.map((section) => (
              <button
                key={section.id}
                type="button"
                role="tab"
                className={activeSectionId === section.id ? "active" : ""}
                aria-selected={activeSectionId === section.id}
                onClick={() => selectSection(section.id)}
              >
                {section.label}
              </button>
            ))}
          </nav>

          <div className="settings-modal-scroll" ref={scrollRef}>
            <div className="info-panel settings-modal-panel">
            <section id="settings-section-runtime" hidden={paneHidden("settings-section-runtime")}>
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

            <div className="settings-pane" hidden={paneHidden("settings-section-terminal-profile")}>
              <TerminalProfileSection modalOpen={props.open} onProfileSaved={onProfileSaved} />
            </div>

            <section id="settings-section-ai-providers" hidden={paneHidden("settings-section-ai-providers")}>
              <h2>AI providers</h2>
              <p className="muted-block">
                Bring your own key. AI is optional, off by default, and never required for the terminal — configure a
                provider, choose a default, then opt in.
              </p>
              {providerConfigStatus ? <p className="muted-block">{providerConfigStatus}</p> : null}

              <div className="ai-routing-bar">
                <label className="toggle-row ai-routing-optin">
                  <input
                    type="checkbox"
                    checked={routing.ai_feature_enabled}
                    onChange={(event) => void setAiOptIn(event.currentTarget.checked)}
                  />
                  Enable AI features
                </label>
                <label className="field-row ai-routing-default">
                  <span>Default provider</span>
                  <select
                    value={routingDraft.default_provider}
                    onChange={(event) =>
                      setRoutingDraft((current) => ({ ...current, default_provider: event.target.value }))
                    }
                  >
                    {providers.map((provider) => (
                      <option key={provider.id} value={provider.id} disabled={!isExecutableProvider(provider.id)}>
                        {provider.name}
                        {providerOptionSuffix(isExecutableProvider(provider.id))}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <label className="toggle-row ai-behavior-echo">
                <input
                  type="checkbox"
                  checked={props.echoAiPromptToTape}
                  onChange={(event) => props.onEchoAiPromptToTapeChange(event.currentTarget.checked)}
                />
                Echo AI prompts to session tape
                <small className="muted-block">Writes <code># AI: …</code> when you send a prompt (replies stay in the AI panel; on by default).</small>
              </label>

              <label className="toggle-row ai-behavior-tools">
                <input
                  type="checkbox"
                  checked={props.enableAiTools}
                  onChange={(event) => props.onEnableAiToolsChange(event.currentTarget.checked)}
                />
                Enable AI command-log tools
                <small className="muted-block">
                  Lets configured AI providers look up recent command runs and output from the ops rail (read-only).
                </small>
              </label>

              <label className="field-row ai-persona-prompt">
                <span>System prompt / persona</span>
                <textarea
                  className="inline-input ai-persona-textarea"
                  rows={4}
                  value={routingDraft.system_prompt}
                  placeholder="Optional instructions for every AI request (e.g. concise ops assistant, prefer ripgrep over grep)…"
                  onChange={(event) =>
                    setRoutingDraft((current) => ({ ...current, system_prompt: event.currentTarget.value }))
                  }
                />
              </label>
              <label className="field-row ai-context-budget">
                <span>Context budget (characters)</span>
                <input
                  type="number"
                  className="inline-input"
                  min={4000}
                  max={120000}
                  step={1000}
                  value={routingDraft.ai_context_budget_chars}
                  onChange={(event) =>
                    setRoutingDraft((current) => ({
                      ...current,
                      ai_context_budget_chars: Number.parseInt(event.currentTarget.value, 10) || current.ai_context_budget_chars,
                    }))
                  }
                />
                <small className="muted-block">Caps history + scrollback sent per request (default 28,000).</small>
              </label>
              <div className="ai-persona-actions">
                <button type="button" className="inline-btn" onClick={() => void saveRoutingConfig()}>
                  Save AI behavior
                </button>
              </div>

              <ul className="provider-block-list">
                {providerCards.map((card) => {
                  const modelKey: RoutingModelKey | null = card.modelKey;
                  return (
                    <li key={card.id}>
                      <div className="provider-block-head">
                        <span>
                          {card.name}
                          <small>
                            {card.kind}
                            {card.isDefault ? " · default" : ""}
                          </small>
                        </span>
                        <strong>{card.statusLabel}</strong>
                        <button
                          type="button"
                          onClick={() => void toggleProvider(card.id, !card.enabled)}
                          className="inline-btn"
                          disabled={!card.executable && !card.enabled}
                        >
                          {card.enabled ? "Disable" : "Enable"}
                        </button>
                      </div>
                      <div className="provider-block-endpoint">
                        <input
                          value={providerEndpointDrafts[card.id] ?? ""}
                          onChange={(event) => updateProviderEndpointDraft(card.id, event.currentTarget.value)}
                          placeholder="Endpoint URL"
                          className="inline-input"
                          aria-label={`${card.id} endpoint`}
                          disabled={!card.executable}
                        />
                        <button
                          type="button"
                          className="inline-btn ghost"
                          onClick={() => void saveProviderEndpoint(card.id)}
                          disabled={!card.executable}
                        >
                          Save endpoint
                        </button>
                      </div>
                      <div className="provider-block-endpoint">
                        <input
                          type="password"
                          value={providerApiKeyDrafts[card.id] ?? ""}
                          onChange={(event) => updateProviderApiKeyDraft(card.id, event.currentTarget.value)}
                          placeholder={card.authLabel.startsWith("Key stored") ? "Key stored (enter to replace)" : "API key"}
                          className="inline-input"
                          aria-label={`${card.id} api key`}
                          disabled={!card.executable}
                        />
                        <button
                          type="button"
                          className="inline-btn ghost"
                          onClick={() => void saveProviderApiKey(card.id)}
                          disabled={!card.executable}
                        >
                          Save key
                        </button>
                        <button
                          type="button"
                          className="inline-btn ghost"
                          onClick={() => void clearProviderApiKey(card.id)}
                          disabled={!card.executable}
                        >
                          Clear key
                        </button>
                      </div>
                      {modelKey ? (
                        <div className="provider-block-endpoint provider-block-model">
                          <span className="provider-block-model-label">Model</span>
                          <input
                            value={routingDraft[modelKey]}
                            onChange={(event) => {
                              const value = event.currentTarget.value;
                              setRoutingDraft((current) => ({ ...current, [modelKey]: value }));
                            }}
                            placeholder="Model id"
                            className="inline-input"
                            aria-label={`${card.id} model`}
                            disabled={!card.executable}
                          />
                        </div>
                      ) : null}
                      <p className="muted-block">{card.authLabel}</p>
                    </li>
                  );
                })}
              </ul>

              <div className="inline-controls">
                <button type="button" className="inline-btn" onClick={() => void saveRoutingConfig()}>
                  Save models &amp; default
                </button>
              </div>

              <h3 className="settings-subsection-title">Test prompt</h3>
              <div className="stacked-controls">
                <input
                  value={aiPrompt}
                  onChange={(event) => setAiPrompt(event.currentTarget.value)}
                  aria-label="AI test prompt"
                />
                <button
                  type="button"
                  className="inline-btn"
                  onClick={() => void runAiPrompt()}
                  disabled={!canRunAiRequest(routing.ai_feature_enabled, aiRequestInFlight)}
                >
                  {aiRequestInFlight ? "Running…" : "Run AI prompt"}
                </button>
                {!routing.ai_feature_enabled ? (
                  <p className="muted-block">
                    {aiOptInRequiredStatus()} Provider endpoints, keys, and models can still be configured.
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

            <div className="settings-pane" hidden={paneHidden("settings-section-status-strip")}>
              <StatusStripSettingsSection modalOpen={props.open} sectionId="settings-section-status-strip" />
            </div>

            <div className="settings-pane" hidden={paneHidden("settings-section-shell-integration")}>
              <ShellIntegrationSection modalOpen={props.open} />
            </div>

            <section id="settings-section-session" hidden={paneHidden("settings-section-session")}>
              <h2>Session &amp; layout</h2>
              <p className="muted-block">
                active session: {activeSession?.id ?? "none"} (
                {activeSession ? sessionStatus[activeSession.id] ?? activeSession.status : "idle"})
              </p>
              <div className="inline-controls">
                <button type="button" className="inline-btn" onClick={() => void restartActiveSession()}>
                  Restart session
                </button>
                <button type="button" className="inline-btn" onClick={() => splitPane()}>
                  Split ({workspaceSplitDirection})
                </button>
                <button type="button" className="inline-btn ghost" onClick={() => splitPaneColumn()}>
                  Split vertical
                </button>
                <button type="button" className="inline-btn ghost" onClick={() => splitPaneRow()}>
                  Split horizontal
                </button>
                <button type="button" className="inline-btn" onClick={() => closeActivePane()}>
                  Close pane
                </button>
                <button
                  type="button"
                  className="inline-btn"
                  onClick={() => {
                    onOpenCommandPalette();
                    onClose();
                  }}
                >
                  Command palette
                </button>
              </div>
              <h3 className="settings-subsection-title">Composer input</h3>
              <p className="muted-block">
                Commands are typed in the composer below the terminal. To thin out the shell&apos;s own prompt in
                scrollback, enable this (sets <code>MACH_TERMINAL_MINIMAL_PROMPT</code> for new sessions) and paste the
                matching snippet into your shell profile.
              </p>
              <label className="toggle-row">
                <input
                  type="checkbox"
                  checked={minimalShellPrompt}
                  onChange={(event) => void onMinimalShellPromptChange(event.currentTarget.checked)}
                />
                Minimal shell prompt (recommended with composer input)
              </label>
              {showDevTools ? (
                <label className="toggle-row">
                  <input
                    type="checkbox"
                    checked={showComposerAssistMetrics}
                    onChange={(event) => void onShowComposerAssistMetricsChange(event.currentTarget.checked)}
                  />
                  Show composer assist metrics (request/accept counts and latency)
                </label>
              ) : null}
              <div className="minimal-prompt-snippet-block mach-osc7-block">
                <div className="minimal-prompt-snippet-row">
                  <span className="minimal-prompt-snippet-label">PowerShell</span>
                  <button
                    type="button"
                    className="inline-btn ghost"
                    onClick={() => void navigator.clipboard.writeText(MACH_MINIMAL_PROMPT_PWSH)}
                  >
                    Copy snippet
                  </button>
                </div>
                <pre className="minimal-prompt-snippet">{MACH_MINIMAL_PROMPT_PWSH}</pre>
                <div className="minimal-prompt-snippet-row">
                  <span className="minimal-prompt-snippet-label">Bash</span>
                  <button
                    type="button"
                    className="inline-btn ghost"
                    onClick={() => void navigator.clipboard.writeText(MACH_MINIMAL_PROMPT_BASH)}
                  >
                    Copy snippet
                  </button>
                </div>
                <pre className="minimal-prompt-snippet">{MACH_MINIMAL_PROMPT_BASH}</pre>
                <div className="minimal-prompt-snippet-row">
                  <span className="minimal-prompt-snippet-label">zsh</span>
                  <button
                    type="button"
                    className="inline-btn ghost"
                    onClick={() => void navigator.clipboard.writeText(MACH_MINIMAL_PROMPT_ZSH)}
                  >
                    Copy snippet
                  </button>
                </div>
                <pre className="minimal-prompt-snippet">{MACH_MINIMAL_PROMPT_ZSH}</pre>
              </div>
              {showDevTools ? (
                <>
                  <h3 className="settings-subsection-title">Terminal interaction state</h3>
                  <p className="muted-block">
                    Mirror of the focused pane&apos;s find/follow-output state, shared with palette commands and the
                    status strip.
                  </p>
                  {uiSurfaceState ? (
                    <p className="muted-block">
                      {uiSurfaceFollowLabel(uiSurfaceState.followOutput)} · {uiSurfaceFindLabel(uiSurfaceState)}
                    </p>
                  ) : (
                    <p className="muted-block">No active session.</p>
                  )}
                  <div className="inline-controls">
                    <button type="button" className="inline-btn ghost" onClick={() => void onToggleFollowOutput()}>
                      Toggle follow output
                    </button>
                    <button type="button" className="inline-btn ghost" onClick={() => void onOpenTerminalFind()}>
                      Open find
                    </button>
                    <button type="button" className="inline-btn ghost" onClick={() => void onFindPreviousMatch()}>
                      Find previous
                    </button>
                    <button type="button" className="inline-btn ghost" onClick={() => void onFindNextMatch()}>
                      Find next
                    </button>
                  </div>
                </>
              ) : null}
            </section>

            <section id="settings-section-updater" hidden={paneHidden("settings-section-updater")}>
              <h2>Updater</h2>
              <div className="inline-controls">
                <button type="button" className="inline-btn" onClick={() => void checkForUpdates()} disabled={!updaterEnabled}>
                  Check for updates
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

            <div className="settings-pane" hidden={paneHidden("settings-section-history")}>
              <HistoryPanel
                sectionId="settings-section-history"
                entries={historyEntries}
                loading={historyLoading}
                aiBusy={aiRequestInFlight}
                aiAssistEnabled={aiAssistEnabled}
                error={historyError}
                actionStatus={historyActionStatus}
                onReplay={historyHandlers.onReplay}
                onExplain={historyHandlers.onExplain}
                onFix={historyHandlers.onFix}
              />
            </div>

            <section id="settings-section-shortcuts" hidden={paneHidden("settings-section-shortcuts")}>
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

            {showDevTools ? (
            <section id="settings-section-plugins" hidden={paneHidden("settings-section-plugins")}>
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
                  Run plugin demo
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
            ) : null}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
