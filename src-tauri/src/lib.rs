pub mod models;
pub mod composer_completion;
pub mod history_store;
pub mod input_sanitize;
pub mod osc7;
pub mod shell_integration;
pub mod shell_context;
mod plugin_host;
pub mod provider_host;
pub mod provider_secrets;
pub mod session_manager;
pub mod settings;
mod terminal_core;
pub mod workspace_store;
mod telemetry;

use crate::models::{
    AiExecuteRequest, AiExecuteResponse, HistoryEntry, HistoryQueryRequest, ProfilePatch, ProviderApiKeyStatus,
    ProviderDescriptor, ProviderRoutingPatch, ProviderRoutingSettings, ProviderSettings, PtySessionInfo,
    PtySpawnRequest, RuntimeCapabilitiesSnapshot, RuntimeDebugSnapshot, RuntimeMetricsSnapshot, SettingsSchemaDebug,
    ShellIntegrationPatch, ShellIntegrationSettings, TerminalProfile, WorkspaceLayout, PluginExecutionResult,
    PluginExecuteRequest, PluginGrantRequest, PluginGrantSnapshot, PluginMetricsSnapshot, PluginPolicyDecision,
};
use crate::composer_completion::{ComposerCompletionRequest, ComposerCompletionResponse};
use crate::plugin_host::PluginHost;
use crate::session_manager::SessionManager;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager, RunEvent, State};
use tracing::{error, info, instrument, warn};

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
fn shell_integration_settings_get(app: AppHandle) -> Result<ShellIntegrationSettings, String> {
    settings::get_shell_integration_settings(&app)
}

#[tauri::command]
#[instrument(skip(app, patch))]
fn shell_integration_settings_patch(
    app: AppHandle,
    patch: ShellIntegrationPatch,
) -> Result<ShellIntegrationSettings, String> {
    settings::patch_shell_integration_settings(&app, patch)
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

fn assert_provider_configured(app: &AppHandle, provider_id: &str) -> Result<(), String> {
    let configured = settings::get_provider_settings(app)?
        .iter()
        .any(|provider| provider.id == provider_id);
    if configured {
        Ok(())
    } else {
        Err(format!("provider `{provider_id}` is not configured"))
    }
}

#[tauri::command]
#[instrument(skip(app, api_key))]
fn provider_api_key_set(app: AppHandle, provider_id: String, api_key: String) -> Result<(), String> {
    assert_provider_configured(&app, &provider_id)?;
    provider_secrets::set_provider_api_key(&provider_id, &api_key).map_err(|error| error.to_string())
}

#[tauri::command]
#[instrument(skip(app))]
fn provider_api_key_clear(app: AppHandle, provider_id: String) -> Result<(), String> {
    assert_provider_configured(&app, &provider_id)?;
    provider_secrets::clear_provider_api_key(&provider_id).map_err(|error| error.to_string())
}

#[tauri::command]
#[instrument(skip(app))]
fn provider_api_key_status(app: AppHandle, provider_id: String) -> Result<ProviderApiKeyStatus, String> {
    assert_provider_configured(&app, &provider_id)?;
    let has_stored_key = provider_secrets::has_provider_api_key(&provider_id).map_err(|error| error.to_string())?;
    Ok(ProviderApiKeyStatus {
        provider_id,
        has_stored_key,
    })
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
    let mut descriptors = provider_host::provider_descriptors(&settings.providers);
    for descriptor in &mut descriptors {
        descriptor.has_stored_key = match provider_secrets::has_provider_api_key(&descriptor.id) {
            Ok(has_key) => has_key,
            Err(error) => {
                warn!(
                    provider_id = descriptor.id.as_str(),
                    error = %error,
                    "failed to read provider key status; returning false"
                );
                false
            }
        };
    }
    Ok(descriptors)
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
#[instrument(skip(manager, request))]
fn composer_complete(
    manager: State<'_, SessionManager>,
    request: ComposerCompletionRequest,
) -> Result<ComposerCompletionResponse, String> {
    composer_completion::complete(request, Some(&manager))
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
    request: PluginGrantRequest,
) -> Result<PluginPolicyDecision, String> {
    host.grant_capability_request(&request)
}

#[tauri::command]
#[instrument(skip(host, request))]
fn plugin_execute(
    host: State<'_, PluginHost>,
    request: PluginExecuteRequest,
) -> Result<PluginExecutionResult, String> {
    host.execute(&request.plugin_id, &request.capability, &request.payload)
}

#[tauri::command]
#[instrument(skip(host))]
fn plugin_metrics_snapshot(host: State<'_, PluginHost>) -> Result<PluginMetricsSnapshot, String> {
    host.metrics_snapshot()
}

#[tauri::command]
#[instrument(skip(host))]
fn plugin_grants_snapshot(host: State<'_, PluginHost>) -> Result<Vec<PluginGrantSnapshot>, String> {
    host.grants_snapshot()
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
            provider_api_key_set,
            provider_api_key_clear,
            provider_api_key_status,
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
            composer_complete,
            runtime_metrics_snapshot,
            runtime_debug_snapshot,
            plugin_grant_capability,
            plugin_execute,
            plugin_metrics_snapshot,
            plugin_grants_snapshot,
            ai_execute,
            shell_context::shell_context_snapshot,
            shell_integration_settings_get,
            shell_integration_settings_patch,
            shell_integration::shell_integration_materialize_scripts,
            shell_integration::shell_integration_status,
            shell_integration::shell_integration_install,
            shell_integration::shell_integration_remove,
            shell_integration::shell_integration_backups_list,
            shell_integration::shell_integration_backup_restore,
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
