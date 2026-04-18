use serde::{Deserialize, Serialize};
use std::collections::HashMap;

pub const SETTINGS_SCHEMA_VERSION: u32 = 1;

pub const WORKSPACE_LAYOUT_SCHEMA_VERSION: u32 = 1;

fn default_workspace_layout_schema_version() -> u32 {
    WORKSPACE_LAYOUT_SCHEMA_VERSION
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspacePaneSnapshot {
    pub id: String,
    pub session_id: Option<String>,
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
}

fn default_settings_schema_version() -> u32 {
    SETTINGS_SCHEMA_VERSION
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TerminalProfile {
    pub shell: Option<String>,
    pub cwd: Option<String>,
    pub env: HashMap<String, String>,
    pub font_size: u8,
    #[serde(default)]
    pub minimal_shell_prompt: bool,
}

impl Default for TerminalProfile {
    fn default() -> Self {
        Self {
            shell: None,
            cwd: None,
            env: HashMap::new(),
            font_size: 13,
            minimal_shell_prompt: false,
        }
    }
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
    pub ai_feature_enabled: bool,
}

impl Default for ProviderRoutingSettings {
    fn default() -> Self {
        Self {
            default_provider: "ollama".to_string(),
            ollama_model: "llama3.2".to_string(),
            ai_feature_enabled: false,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppSettings {
    #[serde(default = "default_settings_schema_version")]
    pub schema_version: u32,
    pub profile: TerminalProfile,
    pub providers: Vec<ProviderSettings>,
    pub provider_routing: ProviderRoutingSettings,
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
    pub cwd: Option<Option<String>>,
    pub font_size: Option<u8>,
    #[serde(default)]
    pub minimal_shell_prompt: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ProviderRoutingPatch {
    pub default_provider: Option<String>,
    pub ollama_model: Option<String>,
    pub ai_feature_enabled: Option<bool>,
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
    pub status: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AiExecuteRequest {
    pub session_id: String,
    pub prompt: String,
    pub provider_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AiExecuteResponse {
    pub provider_id: String,
    pub output: String,
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
