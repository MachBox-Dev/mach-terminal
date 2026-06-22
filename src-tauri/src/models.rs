use serde::{Deserialize, Serialize};
use std::collections::HashMap;

pub const SETTINGS_SCHEMA_VERSION: u32 = 1;

pub const WORKSPACE_LAYOUT_SCHEMA_VERSION: u32 = 2;

fn default_workspace_layout_schema_version() -> u32 {
    WORKSPACE_LAYOUT_SCHEMA_VERSION
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspacePaneSnapshot {
    pub id: String,
    pub session_id: Option<String>,
}

/// A tab the frontend can respawn on the next launch. PTY processes die with the
/// backend, so we persist enough to recreate the tab. `session_id` is the id the
/// tab had when persisted and is the join key to `WorkspacePaneSnapshot::session_id`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RestorableSession {
    pub session_id: String,
    #[serde(default)]
    pub shell: String,
    #[serde(default)]
    pub cwd: Option<String>,
    #[serde(default)]
    pub name: Option<String>,
    /// Stable id for AI chat persistence across session respawns.
    #[serde(default)]
    pub chat_key: Option<String>,
    /// Last input posture: `operator` or `commander` (legacy `console`/`ai` accepted).
    #[serde(default)]
    pub input_mode: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SplitNodeSnapshot {
    pub kind: String,
    pub id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub session_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub direction: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ratio: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub first: Option<Box<SplitNodeSnapshot>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub second: Option<Box<SplitNodeSnapshot>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TabGroupSnapshot {
    pub id: String,
    pub primary_session_id: String,
    #[serde(default)]
    pub panes: Vec<WorkspacePaneSnapshot>,
    pub active_pane_id: String,
    #[serde(default)]
    pub split_direction: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub layout: Option<SplitNodeSnapshot>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub target_pane_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub broadcast_mode: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceLayout {
    #[serde(default = "default_workspace_layout_schema_version")]
    pub schema_version: u32,
    pub root_pane_id: String,
    pub panes: Vec<WorkspacePaneSnapshot>,
    pub active_pane_id: String,
    pub split_direction: String,
    /// Restorable tab descriptors. `#[serde(default)]` keeps layouts written by
    /// older builds (which lack this field) loadable.
    #[serde(default)]
    pub sessions: Vec<RestorableSession>,
    /// Tab groups (split sets). Absent on legacy layouts — migrated on the frontend.
    #[serde(default)]
    pub groups: Vec<TabGroupSnapshot>,
    #[serde(default)]
    pub active_group_id: Option<String>,
}

fn default_settings_schema_version() -> u32 {
    SETTINGS_SCHEMA_VERSION
}

fn default_openai_model() -> String {
    "gpt-4o-mini".to_string()
}

fn default_anthropic_model() -> String {
    "claude-3-5-haiku-latest".to_string()
}

fn default_custom_openai_model() -> String {
    "gpt-4o-mini".to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TerminalProfile {
    pub shell: Option<String>,
    /// Arguments passed to the shell executable on spawn (e.g. `["-d", "Ubuntu"]`
    /// for `wsl.exe`, `["-NoLogo"]` for pwsh). Empty = bare invocation. Lets a
    /// profile target a specific WSL distro / login shell without a wrapper exe.
    #[serde(default)]
    pub args: Vec<String>,
    pub cwd: Option<String>,
    pub env: HashMap<String, String>,
    pub font_size: u8,
    #[serde(default)]
    pub minimal_shell_prompt: bool,
    /// When true, show composer assist metrics in the UI (not only dev builds).
    #[serde(default)]
    pub show_composer_assist_metrics: bool,
}

impl Default for TerminalProfile {
    fn default() -> Self {
        Self {
            shell: None,
            args: Vec::new(),
            cwd: None,
            env: HashMap::new(),
            font_size: 13,
            minimal_shell_prompt: false,
            show_composer_assist_metrics: false,
        }
    }
}

/// A shell the host detected (or a sensible default), surfaced to the profile
/// picker so users select from real options instead of typing an exe name.
/// `available` is false for well-known shells that were not found on this system
/// (kept in the list so the UI can explain why they're disabled).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ShellCandidate {
    /// Stable identifier, e.g. `windows-powershell`, `pwsh`, `wsl:Ubuntu`, `posix:/bin/zsh`.
    pub id: String,
    /// Human-facing label, e.g. `Windows PowerShell`, `Ubuntu (WSL)`.
    pub label: String,
    /// Executable to spawn.
    pub shell: String,
    /// Arguments to spawn the shell with.
    pub args: Vec<String>,
    /// Coarse grouping for the UI: `native` | `wsl` | `posix`.
    pub kind: String,
    /// Whether the executable/distro was actually detected on this system.
    pub available: bool,
    /// True for the single recommended default on this platform.
    pub is_default: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProviderSettings {
    pub id: String,
    pub enabled: bool,
    pub endpoint: Option<String>,
    pub api_key_env: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProviderRoutingSettings {
    pub default_provider: String,
    pub ollama_model: String,
    #[serde(default = "default_openai_model")]
    pub openai_model: String,
    #[serde(default = "default_anthropic_model")]
    pub anthropic_model: String,
    #[serde(default = "default_custom_openai_model")]
    pub custom_openai_model: String,
    pub ai_feature_enabled: bool,
    #[serde(default)]
    pub system_prompt: String,
    #[serde(default = "default_ai_context_budget_chars")]
    pub ai_context_budget_chars: usize,
}

fn default_ai_context_budget_chars() -> usize {
    28_000
}

impl Default for ProviderRoutingSettings {
    fn default() -> Self {
        Self {
            default_provider: "ollama".to_string(),
            ollama_model: "llama3.2".to_string(),
            openai_model: "gpt-4o-mini".to_string(),
            anthropic_model: "claude-3-5-haiku-latest".to_string(),
            custom_openai_model: "gpt-4o-mini".to_string(),
            ai_feature_enabled: false,
            system_prompt: String::new(),
            ai_context_budget_chars: default_ai_context_budget_chars(),
        }
    }
}

/// Persisted preferences for Mach shell integration (OSC 7 hooks); optional fields default safely.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ShellIntegrationSettings {
    /// Non-default PowerShell profile path for hook install/remove (Windows-first).
    #[serde(default)]
    pub pwsh_profile_override: Option<String>,
    /// First-run onboarding: user saw or dismissed the one-click hook install CTA.
    #[serde(default)]
    pub onboarding_install_prompt_seen: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ShellIntegrationPatch {
    /// `Some(None)` clears the override; omit field for no change.
    #[serde(default)]
    pub pwsh_profile_override: Option<Option<String>>,
    #[serde(default)]
    pub onboarding_install_prompt_seen: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShellIntegrationBackupEntry {
    pub backup_id: String,
    pub file_name: String,
    pub created_at_ms: u64,
    pub size_bytes: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShellIntegrationBackupListResult {
    pub shell_kind: String,
    pub profile_path: String,
    pub entries: Vec<ShellIntegrationBackupEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShellIntegrationBackupRestoreResult {
    pub shell_kind: String,
    pub profile_path: String,
    pub restored_backup_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppSettings {
    #[serde(default = "default_settings_schema_version")]
    pub schema_version: u32,
    pub profile: TerminalProfile,
    pub providers: Vec<ProviderSettings>,
    pub provider_routing: ProviderRoutingSettings,
    #[serde(default)]
    pub shell_integration: ShellIntegrationSettings,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            schema_version: SETTINGS_SCHEMA_VERSION,
            profile: TerminalProfile::default(),
            providers: vec![
                ProviderSettings {
                    id: "openai".to_string(),
                    enabled: false,
                    endpoint: None,
                    api_key_env: Some("OPENAI_API_KEY".to_string()),
                },
                ProviderSettings {
                    id: "anthropic".to_string(),
                    enabled: false,
                    endpoint: None,
                    api_key_env: Some("ANTHROPIC_API_KEY".to_string()),
                },
                ProviderSettings {
                    id: "ollama".to_string(),
                    enabled: false,
                    endpoint: Some("http://127.0.0.1:11434".to_string()),
                    api_key_env: None,
                },
                ProviderSettings {
                    id: "custom-openai".to_string(),
                    enabled: false,
                    endpoint: None,
                    api_key_env: Some("CUSTOM_OPENAI_API_KEY".to_string()),
                },
            ],
            provider_routing: ProviderRoutingSettings::default(),
            shell_integration: ShellIntegrationSettings::default(),
        }
    }
}

#[derive(Debug, Clone, Deserialize)]
pub struct LegacyAppSettings {
    pub profile: TerminalProfile,
    pub providers: Vec<ProviderSettings>,
    pub provider_routing: ProviderRoutingSettings,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ProfilePatch {
    pub shell: Option<Option<String>>,
    /// `Some(vec)` replaces args wholesale; omit for no change.
    #[serde(default)]
    pub args: Option<Vec<String>>,
    pub cwd: Option<Option<String>>,
    pub font_size: Option<u8>,
    #[serde(default)]
    pub minimal_shell_prompt: Option<bool>,
    #[serde(default)]
    pub show_composer_assist_metrics: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ProviderRoutingPatch {
    pub default_provider: Option<String>,
    pub ollama_model: Option<String>,
    pub openai_model: Option<String>,
    pub anthropic_model: Option<String>,
    pub custom_openai_model: Option<String>,
    pub ai_feature_enabled: Option<bool>,
    pub system_prompt: Option<String>,
    pub ai_context_budget_chars: Option<usize>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SettingsSchemaDebug {
    pub settings_path: String,
    pub file_exists: bool,
    pub schema_version_in_file: Option<u32>,
    pub loaded_schema_version: u32,
    pub migrated_from_legacy: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PtySpawnRequest {
    pub profile: Option<TerminalProfile>,
    pub cols: Option<u16>,
    pub rows: Option<u16>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PtySessionInfo {
    pub id: String,
    pub shell: String,
    pub cwd: Option<String>,
    pub status: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PtyOutputEvent {
    pub session_id: String,
    pub data: String,
    pub sequence: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PtyCwdChangedEvent {
    pub session_id: String,
    pub cwd: String,
    pub timestamp_ms: u64,
}

/// OSC 133 shell integration markers (iTerm2 / WezTerm style command boundaries).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum PtyCommandMarkerPhase {
    PromptStart,
    CommandStart,
    OutputStart,
    OutputEnd,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PtyCommandMarkerEvent {
    pub session_id: String,
    pub phase: PtyCommandMarkerPhase,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub exit_code: Option<i32>,
    pub timestamp_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PtyLifecycleEvent {
    pub session_id: String,
    pub status: String,
    pub message: Option<String>,
    pub timestamp_ms: u64,
    /// Process exit code, populated only for the EOF-driven `stopped` transition.
    /// `None` on `running`, `closed`, and `error` emits. Absent on the wire for older
    /// producers thanks to `skip_serializing_if`, keeping the schema additive.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub exit_code: Option<i32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AiContextEvent {
    pub session_id: String,
    pub event_type: String,
    pub payload: String,
    pub sequence: u64,
    pub timestamp_ms: u64,
    pub source: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProviderDescriptor {
    pub id: String,
    pub name: String,
    pub kind: String,
    pub enabled: bool,
    pub endpoint: Option<String>,
    #[serde(default, rename = "envHint")]
    pub env_hint: Option<String>,
    pub status: String,
    #[serde(default, rename = "hasStoredKey")]
    pub has_stored_key: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderApiKeyStatus {
    pub provider_id: String,
    pub has_stored_key: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct AiPromptContext {
    #[serde(default)]
    pub cwd: Option<String>,
    #[serde(default)]
    pub shell: Option<String>,
    #[serde(default)]
    pub git_branch: Option<String>,
    #[serde(default)]
    pub command_text: Option<String>,
    #[serde(default)]
    pub output_excerpt: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiChatTurn {
    pub role: String,
    pub content: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiToolCall {
    pub id: String,
    pub name: String,
    pub arguments: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiProviderMessage {
    pub role: String,
    #[serde(default)]
    pub content: Option<String>,
    #[serde(default)]
    pub tool_call_id: Option<String>,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub tool_calls: Option<Vec<AiToolCall>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct AiExecuteRequest {
    pub session_id: String,
    pub prompt: String,
    pub provider_id: Option<String>,
    #[serde(default)]
    pub intent: Option<String>,
    #[serde(default)]
    pub context: Option<AiPromptContext>,
    /// Prior user/assistant turns (current `prompt` is the latest user message).
    #[serde(default)]
    pub history: Option<Vec<AiChatTurn>>,
    #[serde(default)]
    pub enable_tools: bool,
    #[serde(default)]
    pub use_provider_messages: bool,
    #[serde(default)]
    pub provider_messages: Option<Vec<AiProviderMessage>>,
    /// OpenAI-style tool definitions (passed through from the frontend).
    #[serde(default)]
    pub tools: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiExecuteResponse {
    pub provider_id: String,
    pub output: String,
    #[serde(default)]
    pub tool_calls: Option<Vec<AiToolCall>>,
    #[serde(default)]
    pub finish_reason: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HistoryEntry {
    pub id: u64,
    pub session_id: String,
    pub command: String,
    pub timestamp_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HistoryQueryRequest {
    pub query: Option<String>,
    pub session_id: Option<String>,
    pub limit: Option<usize>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct RuntimeMetricsSnapshot {
    pub output_chunks_emitted: u64,
    pub output_chunks_dropped: u64,
    pub output_bytes_emitted: u64,
    pub emit_failures: u64,
    pub sequence_anomalies: u64,
    pub write_failures: u64,
    pub resize_failures: u64,
    pub close_failures: u64,
    pub active_sessions: u64,
    pub max_chunk_size: usize,
}

/// Serializable snapshot of runtime capability flags (same shape as `runtime_capabilities`).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RuntimeCapabilitiesSnapshot {
    pub pty_backend: String,
    pub plugin_host: bool,
    pub provider_host: bool,
    pub session_persistence: bool,
    pub provider_routing: bool,
}

/// Aggregated read-only snapshot for local developer diagnostics (debug Tauri builds only).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RuntimeDebugSnapshot {
    pub capabilities: RuntimeCapabilitiesSnapshot,
    pub metrics: RuntimeMetricsSnapshot,
    pub sessions: Vec<PtySessionInfo>,
    pub history_recovery_pending: bool,
    pub settings_path: String,
    pub history_path: String,
    pub timestamp_ms: u64,
    pub debug_build: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginGrantRequest {
    pub plugin_id: String,
    pub capability: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginExecuteRequest {
    pub plugin_id: String,
    pub capability: String,
    pub payload: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginPolicyDecision {
    pub accepted: bool,
    pub reason_code: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PluginExecutionResult {
    pub plugin_id: String,
    pub capability: String,
    pub accepted: bool,
    pub message: String,
    #[serde(default)]
    pub reason_code: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub payload_bytes: Option<usize>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub decision: Option<PluginPolicyDecision>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct PluginMetricsSnapshot {
    pub grants_total: u64,
    pub execution_allowed_total: u64,
    pub execution_denied_total: u64,
    pub execution_error_total: u64,
    pub execution_total: u64,
    pub cumulative_execution_ms: u64,
    pub last_execution_ms: Option<u64>,
    pub granted_plugin_count: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginGrantSnapshot {
    pub plugin_id: String,
    pub capabilities: Vec<String>,
}
