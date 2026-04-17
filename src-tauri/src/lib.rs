pub mod models;
pub mod history_store;
pub mod osc7;
mod plugin_host;
mod provider_host;
pub mod session_manager;
pub mod settings;
mod terminal_core;
pub mod workspace_store;
mod telemetry;

use crate::models::{
    AiExecuteRequest, AiExecuteResponse, HistoryEntry, HistoryQueryRequest, ProfilePatch, ProviderDescriptor,
    ProviderRoutingPatch, ProviderRoutingSettings, ProviderSettings, PtySessionInfo, PtySpawnRequest,
    RuntimeCapabilitiesSnapshot, RuntimeDebugSnapshot, SettingsSchemaDebug, RuntimeMetricsSnapshot, TerminalProfile,
    WorkspaceLayout,
};
use crate::plugin_host::{PluginExecutionResult, PluginHost};
use crate::session_manager::SessionManager;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager, RunEvent, State};
use tracing::{error, info, instrument};

struct AiRuntime {
    client: reqwest::Client,
}

#[tauri::command]
#[instrument]
fn runtime_capabilities() -> terminal_core::RuntimeCapabilities {
    terminal_core::capabilities()
}

#[tauri::command]
#[instrument(skip(app))]
fn profile_get(app: AppHandle) -> Result<TerminalProfile, String> {
    settings::get_profile(&app)
}

#[tauri::command]
#[instrument(skip(app, profile))]
fn profile_set(app: AppHandle, profile: TerminalProfile) -> Result<TerminalProfile, String> {
    settings::set_profile(&app, profile)
}

#[tauri::command]
#[instrument(skip(app, patch))]
fn profile_patch(app: AppHandle, patch: ProfilePatch) -> Result<TerminalProfile, String> {
    settings::patch_profile(&app, patch)
}

#[tauri::command]
#[instrument(skip(app))]
fn provider_settings_get(app: AppHandle) -> Result<Vec<ProviderSettings>, String> {
    settings::get_provider_settings(&app)
}

#[tauri::command]
#[instrument(skip(app, providers))]
fn provider_settings_set(app: AppHandle, providers: Vec<ProviderSettings>) -> Result<Vec<ProviderSettings>, String> {
    settings::set_provider_settings(&app, providers)
}

#[tauri::command]
#[instrument(skip(app))]
fn provider_set_enabled(app: AppHandle, provider_id: String, enabled: bool) -> Result<Vec<ProviderSettings>, String> {
    settings::set_provider_enabled(&app, &provider_id, enabled)
}

#[tauri::command]
#[instrument(skip(app, endpoint))]
fn provider_endpoint_set(
    app: AppHandle,
    provider_id: String,
    endpoint: Option<String>,
) -> Result<Vec<ProviderSettings>, String> {
    settings::set_provider_endpoint(&app, &provider_id, endpoint)
}

#[tauri::command]
#[instrument(skip(app))]
fn provider_routing_get(app: AppHandle) -> Result<ProviderRoutingSettings, String> {
    settings::get_provider_routing(&app)
}

#[tauri::command]
#[instrument(skip(app, provider_routing))]
fn provider_routing_set(
    app: AppHandle,
    provider_routing: ProviderRoutingSettings,
) -> Result<ProviderRoutingSettings, String> {
    settings::set_provider_routing(&app, provider_routing)
}

#[tauri::command]
#[instrument(skip(app, patch))]
fn provider_routing_patch(app: AppHandle, patch: ProviderRoutingPatch) -> Result<ProviderRoutingSettings, String> {
    settings::patch_provider_routing(&app, patch)
}

#[tauri::command]
#[instrument(skip(app))]
fn settings_schema_dump(app: AppHandle) -> Result<SettingsSchemaDebug, String> {
    if !cfg!(debug_assertions) {
        return Err("settings_schema_dump is only available in debug builds".to_string());
    }
    settings::settings_schema_dump(&app)
}

#[tauri::command]
#[instrument(skip(app))]
fn workspace_layout_get(app: AppHandle) -> Result<Option<WorkspaceLayout>, String> {
    workspace_store::load_workspace_layout(&app)
}

#[tauri::command]
#[instrument(skip(app, layout))]
fn workspace_layout_set(app: AppHandle, layout: WorkspaceLayout) -> Result<(), String> {
    workspace_store::save_workspace_layout(&app, &layout)
}

#[tauri::command]
#[instrument(skip(app))]
fn provider_list(app: AppHandle) -> Result<Vec<ProviderDescriptor>, String> {
    let settings = settings::load_settings(&app)?;
    Ok(provider_host::provider_descriptors(&settings.providers))
}

#[tauri::command]
#[instrument(skip(app, manager, request))]
fn pty_spawn(
    app: AppHandle,
    manager: State<'_, SessionManager>,
    request: PtySpawnRequest,
) -> Result<PtySessionInfo, String> {
    let default_profile = settings::get_profile(&app)?;
    manager.spawn_session(&app, request, default_profile)
}

#[tauri::command]
#[instrument(skip(app, manager, data))]
fn pty_write(
    app: AppHandle,
    manager: State<'_, SessionManager>,
    session_id: String,
    data: String,
) -> Result<(), String> {
    manager.write_input(&app, &session_id, &data)
}

#[tauri::command]
#[instrument(skip(manager))]
fn pty_resize(
    manager: State<'_, SessionManager>,
    session_id: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    manager.resize_session(&session_id, cols, rows)
}

#[tauri::command]
#[instrument(skip(app, manager))]
fn pty_close(app: AppHandle, manager: State<'_, SessionManager>, session_id: String) -> Result<(), String> {
    manager.close_session(&app, &session_id)
}

#[tauri::command]
#[instrument(skip(manager))]
fn pty_list_sessions(manager: State<'_, SessionManager>) -> Result<Vec<PtySessionInfo>, String> {
    manager.list_sessions()
}

#[tauri::command]
#[instrument(skip(app, manager, request))]
fn history_query(
    app: AppHandle,
    manager: State<'_, SessionManager>,
    request: HistoryQueryRequest,
) -> Result<Vec<HistoryEntry>, String> {
    manager.history_query(&app, request)
}

#[tauri::command]
#[instrument(skip(manager))]
fn history_recovery_take(manager: State<'_, SessionManager>) -> Option<String> {
    manager.take_history_recovery_notice()
}

#[tauri::command]
#[instrument(skip(app, manager, command))]
fn history_replay(
    app: AppHandle,
    manager: State<'_, SessionManager>,
    session_id: String,
    command: String,
) -> Result<(), String> {
    manager.history_replay(&app, &session_id, &command)
}

#[tauri::command]
#[instrument(skip(manager))]
fn runtime_metrics_snapshot(manager: State<'_, SessionManager>) -> Result<RuntimeMetricsSnapshot, String> {
    manager.metrics_snapshot()
}

fn diagnostics_timestamp_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0)
}

fn snapshot_capabilities_owned() -> RuntimeCapabilitiesSnapshot {
    let caps = terminal_core::capabilities();
    RuntimeCapabilitiesSnapshot {
        pty_backend: caps.pty_backend.to_string(),
        plugin_host: caps.plugin_host,
        provider_host: caps.provider_host,
        session_persistence: caps.session_persistence,
        provider_routing: caps.provider_routing,
    }
}

#[tauri::command]
#[instrument(skip(app, manager))]
fn runtime_debug_snapshot(
    app: AppHandle,
    manager: State<'_, SessionManager>,
) -> Result<RuntimeDebugSnapshot, String> {
    if !cfg!(debug_assertions) {
        return Err("runtime_debug_snapshot is only available in debug builds".to_string());
    }
    let metrics = manager.metrics_snapshot()?;
    let sessions = manager.list_sessions()?;
    let history_recovery_pending = manager.history_recovery_pending();
    let settings_path = settings::resolve_settings_json_path(&app)?.display().to_string();
    let history_path = history_store::resolve_history_json_path(&app)?.display().to_string();
    Ok(RuntimeDebugSnapshot {
        capabilities: snapshot_capabilities_owned(),
        metrics,
        sessions,
        history_recovery_pending,
        settings_path,
        history_path,
        timestamp_ms: diagnostics_timestamp_ms(),
        debug_build: true,
    })
}

#[tauri::command]
#[instrument(skip(host))]
fn plugin_grant_capability(
    host: State<'_, PluginHost>,
    plugin_id: String,
    capability: String,
) -> Result<(), String> {
    host.grant_capability(&plugin_id, &capability)
}

#[tauri::command]
#[instrument(skip(host, payload))]
fn plugin_execute(
    host: State<'_, PluginHost>,
    plugin_id: String,
    capability: String,
    payload: String,
) -> Result<PluginExecutionResult, String> {
    host.execute(&plugin_id, &capability, &payload)
}

#[tauri::command]
#[instrument(skip(app, runtime, request))]
async fn ai_execute(
    app: AppHandle,
    runtime: State<'_, AiRuntime>,
    request: AiExecuteRequest,
) -> Result<AiExecuteResponse, String> {
    let settings = settings::load_settings(&app)?;
    provider_host::execute_ai_request(&runtime.client, &settings, &request).await
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    if let Err(error) = telemetry::init() {
        eprintln!("failed to initialize telemetry: {error}");
    } else {
        info!("telemetry initialized");
    }

    let runtime_client = match provider_host::default_runtime_client() {
        Ok(client) => client,
        Err(error) => {
            error!("failed to build runtime provider client with tuned settings: {error}");
            reqwest::Client::new()
        }
    };

    let app = tauri::Builder::default()
        .manage(SessionManager::default())
        .manage(PluginHost::default())
        .manage(AiRuntime { client: runtime_client })
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            runtime_capabilities,
            profile_get,
            profile_set,
            profile_patch,
            provider_settings_get,
            provider_settings_set,
            provider_set_enabled,
            provider_endpoint_set,
            provider_routing_get,
            provider_routing_set,
            provider_routing_patch,
            settings_schema_dump,
            workspace_layout_get,
            workspace_layout_set,
            provider_list,
            pty_spawn,
            pty_write,
            pty_resize,
            pty_close,
            pty_list_sessions,
            history_query,
            history_recovery_take,
            history_replay,
            runtime_metrics_snapshot,
            runtime_debug_snapshot,
            plugin_grant_capability,
            plugin_execute,
            ai_execute
        ])
        .build(tauri::generate_context!());

    match app {
        Ok(app) => app.run(|app, event| {
            if matches!(event, RunEvent::ExitRequested { .. } | RunEvent::Exit) {
                if let Some(manager) = app.try_state::<SessionManager>() {
                    if let Err(error) = manager.close_all() {
                        error!("failed to close sessions on exit: {error}");
                    }
                }
                telemetry::shutdown();
            }
        }),
        Err(error) => {
            error!("failed to build tauri app: {error}");
            telemetry::shutdown();
        }
    }
}
