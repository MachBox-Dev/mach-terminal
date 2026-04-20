#![cfg(feature = "invoke-smoke")]

use mach_terminal_lib::models::{AppSettings, ShellIntegrationSettings};
use mach_terminal_lib::settings::resolve_settings_json_path;
use serde_json::{json, Value};
use std::ffi::OsString;
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::webview::InvokeRequest;

static INVOKE_SHELL_STATUS_TEST_LOCK: Mutex<()> = Mutex::new(());

struct SettingsFileGuard {
    path: PathBuf,
    original_bytes: Option<Vec<u8>>,
}

impl SettingsFileGuard {
    fn new(path: PathBuf) -> Self {
        let original_bytes = fs::read(&path).ok();
        Self { path, original_bytes }
    }

    fn write(&self, settings: &AppSettings) {
        if let Some(parent) = self.path.parent() {
            fs::create_dir_all(parent).expect("create settings parent");
        }
        let bytes = serde_json::to_vec_pretty(settings).expect("serialize settings fixture");
        fs::write(&self.path, bytes).expect("write settings fixture");
    }
}

impl Drop for SettingsFileGuard {
    fn drop(&mut self) {
        match &self.original_bytes {
            Some(original) => {
                let _ = fs::write(&self.path, original);
            }
            None => {
                let _ = fs::remove_file(&self.path);
            }
        }
    }
}

struct EnvVarGuard {
    key: &'static str,
    previous: Option<OsString>,
}

impl EnvVarGuard {
    fn set_empty(key: &'static str) -> Self {
        let previous = std::env::var_os(key);
        // SAFETY: tests in this file are serialized by INVOKE_SHELL_STATUS_TEST_LOCK.
        unsafe { std::env::set_var(key, "") };
        Self { key, previous }
    }
}

impl Drop for EnvVarGuard {
    fn drop(&mut self) {
        match &self.previous {
            Some(value) => {
                // SAFETY: tests in this file are serialized by INVOKE_SHELL_STATUS_TEST_LOCK.
                unsafe { std::env::set_var(self.key, value) };
            }
            None => {
                // SAFETY: tests in this file are serialized by INVOKE_SHELL_STATUS_TEST_LOCK.
                unsafe { std::env::remove_var(self.key) };
            }
        }
    }
}

#[tauri::command]
fn shell_integration_status_transport(
    app: tauri::AppHandle<tauri::test::MockRuntime>,
) -> Result<Value, String> {
    let status = mach_terminal_lib::shell_integration::shell_integration_status(app)?;
    serde_json::to_value(status).map_err(|error| error.to_string())
}

fn build_test_app() -> tauri::App<tauri::test::MockRuntime> {
    tauri::test::mock_builder()
        .invoke_handler(tauri::generate_handler![shell_integration_status_transport])
        .build(tauri::test::mock_context(tauri::test::noop_assets()))
        .expect("build mock tauri app")
}

fn seed_settings(
    app: &tauri::AppHandle<tauri::test::MockRuntime>,
    shell_integration: ShellIntegrationSettings,
) -> SettingsFileGuard {
    let settings_path = resolve_settings_json_path(app).expect("resolve settings path");
    let guard = SettingsFileGuard::new(settings_path);
    let mut settings = AppSettings::default();
    settings.shell_integration = shell_integration;
    guard.write(&settings);
    guard
}

fn invoke_shell_integration_status(app: &tauri::App<tauri::test::MockRuntime>) -> Value {
    let webview = tauri::WebviewWindowBuilder::new(app, "main", Default::default())
        .build()
        .expect("build mock webview");
    let response = tauri::test::get_ipc_response(
        &webview,
        InvokeRequest {
            cmd: "shell_integration_status_transport".into(),
            callback: tauri::ipc::CallbackFn(0),
            error: tauri::ipc::CallbackFn(1),
            url: "http://tauri.localhost".parse().expect("invoke url"),
            body: tauri::ipc::InvokeBody::Json(json!({})),
            headers: Default::default(),
            invoke_key: tauri::test::INVOKE_KEY.to_string(),
        },
    )
    .expect("invoke shell status");
    response.deserialize().expect("deserialize invoke payload")
}

fn shell_row<'a>(status: &'a Value, shell_kind: &str) -> &'a Value {
    status
        .get("shells")
        .and_then(Value::as_array)
        .expect("shell rows")
        .iter()
        .find(|row| row.get("shellKind").and_then(Value::as_str) == Some(shell_kind))
        .expect("shell row by kind")
}

#[test]
#[ignore = "non-blocking invoke smoke; run manually when local runtime supports mock webview entrypoints"]
fn invoke_shell_status_reports_canonical_row_order_and_capabilities() {
    let _lock = INVOKE_SHELL_STATUS_TEST_LOCK.lock().expect("lock");
    let app = build_test_app();
    let app_handle = app.handle().clone();
    let _settings_guard = seed_settings(&app_handle, ShellIntegrationSettings::default());
    let _path_guard = EnvVarGuard::set_empty("PATH");

    let status = invoke_shell_integration_status(&app);
    let rows = status
        .get("shells")
        .and_then(Value::as_array)
        .expect("shells array");
    let kinds: Vec<&str> = rows
        .iter()
        .map(|row| row.get("shellKind").and_then(Value::as_str).expect("shell kind"))
        .collect();
    assert_eq!(kinds, vec!["pwsh", "bash", "zsh"]);

    let pwsh = shell_row(&status, "pwsh");
    assert_eq!(
        pwsh.get("capabilities")
            .and_then(|capabilities| capabilities.get("supportsBackupRestore"))
            .and_then(Value::as_bool),
        Some(true)
    );
    assert_eq!(
        pwsh.get("capabilities")
            .and_then(|capabilities| capabilities.get("supportsProfileOverride"))
            .and_then(Value::as_bool),
        Some(true)
    );
}

#[test]
#[ignore = "non-blocking invoke smoke; run manually when local runtime supports mock webview entrypoints"]
fn invoke_shell_status_surfaces_invalid_override_row_contract() {
    let _lock = INVOKE_SHELL_STATUS_TEST_LOCK.lock().expect("lock");
    let app = build_test_app();
    let app_handle = app.handle().clone();
    let _settings_guard = seed_settings(
        &app_handle,
        ShellIntegrationSettings {
            pwsh_profile_override: Some("C:\\Users\\mike\\Documents\\profile.txt".to_string()),
            onboarding_install_prompt_seen: false,
        },
    );

    let status = invoke_shell_integration_status(&app);
    let pwsh = shell_row(&status, "pwsh");
    assert_eq!(pwsh.get("profileResolved").and_then(Value::as_bool), Some(false));
    assert_eq!(pwsh.get("health").and_then(Value::as_str), Some("error"));
    assert_eq!(pwsh.get("profilePathSource").and_then(Value::as_str), Some("override"));
    assert!(pwsh.get("backupCount").is_some_and(Value::is_null));
    assert!(
        pwsh.get("error")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .contains("must end with .ps1")
    );
}

#[test]
#[ignore = "non-blocking invoke smoke; run manually when local runtime supports mock webview entrypoints"]
fn invoke_shell_status_preserves_null_wire_shape_for_unresolved_auto() {
    let _lock = INVOKE_SHELL_STATUS_TEST_LOCK.lock().expect("lock");
    let _path_guard = EnvVarGuard::set_empty("PATH");
    let app = build_test_app();
    let app_handle = app.handle().clone();
    let _settings_guard = seed_settings(&app_handle, ShellIntegrationSettings::default());

    let status = invoke_shell_integration_status(&app);
    let pwsh = shell_row(&status, "pwsh");
    assert_eq!(pwsh.get("profileResolved").and_then(Value::as_bool), Some(false));
    assert_eq!(pwsh.get("health").and_then(Value::as_str), Some("error"));
    assert!(pwsh.get("profilePath").is_some_and(Value::is_null));
    assert!(pwsh.get("backupCount").is_some_and(Value::is_null));
    assert!(pwsh.get("profilePathSource").is_some_and(Value::is_null));
    assert!(pwsh.get("error").is_some_and(Value::is_string));
}
