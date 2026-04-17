use crate::models::{
    AppSettings, LegacyAppSettings, ProfilePatch, ProviderRoutingPatch, ProviderRoutingSettings, ProviderSettings,
    SettingsSchemaDebug, TerminalProfile, SETTINGS_SCHEMA_VERSION,
};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Mutex, OnceLock};
use std::thread;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager};

fn settings_path(app: &AppHandle) -> Result<PathBuf, String> {
    let base_dir = app
        .path()
        .app_config_dir()
        .map_err(|error| format!("failed to resolve app config dir: {error}"))?;

    fs::create_dir_all(&base_dir).map_err(|error| format!("failed to create config dir: {error}"))?;
    Ok(base_dir.join("settings.json"))
}

pub fn resolve_settings_json_path(app: &AppHandle) -> Result<PathBuf, String> {
    settings_path(app)
}

fn settings_write_lock() -> &'static Mutex<()> {
    static SETTINGS_WRITE_LOCK: OnceLock<Mutex<()>> = OnceLock::new();
    SETTINGS_WRITE_LOCK.get_or_init(|| Mutex::new(()))
}

fn backup_corrupt_settings(path: &Path, raw: &str) -> Result<PathBuf, String> {
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|value| value.as_millis())
        .unwrap_or(0);
    let backup_path = path.with_extension(format!("corrupt-{timestamp}.json"));
    fs::write(&backup_path, raw).map_err(|error| format!("failed to write corrupt settings backup: {error}"))?;
    Ok(backup_path)
}

fn next_temp_suffix() -> u64 {
    static TEMP_COUNTER: AtomicU64 = AtomicU64::new(0);
    TEMP_COUNTER.fetch_add(1, Ordering::Relaxed)
}

fn migrate_settings(mut settings: AppSettings) -> Result<(AppSettings, bool), String> {
    let mut migrated = false;
    if settings.schema_version == 0 {
        settings.schema_version = SETTINGS_SCHEMA_VERSION;
        migrated = true;
    }
    if settings.schema_version > SETTINGS_SCHEMA_VERSION {
        return Err(format!(
            "settings schema version {} is newer than supported {}",
            settings.schema_version, SETTINGS_SCHEMA_VERSION
        ));
    }
    Ok((settings, migrated))
}

pub fn settings_schema_dump_from_path(path: &Path) -> Result<SettingsSchemaDebug, String> {
    let mut file_exists = false;
    let mut schema_version_in_file = None;

    if let Ok(raw) = fs::read_to_string(path) {
        file_exists = true;
        if let Ok(value) = serde_json::from_str::<serde_json::Value>(&raw) {
            schema_version_in_file = value
                .get("schema_version")
                .and_then(|version| version.as_u64())
                .map(|version| version as u32);
        }
    }

    let loaded = load_settings_from_path(path)?;
    Ok(SettingsSchemaDebug {
        settings_path: path.display().to_string(),
        file_exists,
        schema_version_in_file,
        loaded_schema_version: loaded.schema_version,
        migrated_from_legacy: file_exists && schema_version_in_file.is_none(),
    })
}

pub fn settings_schema_dump(app: &AppHandle) -> Result<SettingsSchemaDebug, String> {
    let path = settings_path(app)?;
    settings_schema_dump_from_path(&path)
}

pub fn apply_profile_patch(profile: &mut TerminalProfile, patch: &ProfilePatch) {
    if let Some(shell) = patch.shell.clone() {
        profile.shell = shell;
    }
    if let Some(cwd) = patch.cwd.clone() {
        profile.cwd = cwd;
    }
    if let Some(font_size) = patch.font_size {
        profile.font_size = font_size;
    }
}

pub fn apply_provider_endpoint_patch(providers: &mut [ProviderSettings], provider_id: &str, endpoint: Option<String>) {
    for provider in providers {
        if provider.id == provider_id {
            provider.endpoint = endpoint.clone();
        }
    }
}

pub fn apply_provider_routing_patch(routing: &mut ProviderRoutingSettings, patch: &ProviderRoutingPatch) {
    if let Some(default_provider) = patch.default_provider.clone() {
        routing.default_provider = default_provider;
    }
    if let Some(ollama_model) = patch.ollama_model.clone() {
        routing.ollama_model = ollama_model;
    }
    if let Some(ai_feature_enabled) = patch.ai_feature_enabled {
        routing.ai_feature_enabled = ai_feature_enabled;
    }
}

pub fn load_settings_from_path(path: &Path) -> Result<AppSettings, String> {
    match fs::read_to_string(path) {
        Ok(raw) => {
            let json: serde_json::Value = match serde_json::from_str(&raw) {
                Ok(value) => value,
                Err(error) => {
                    let backup = backup_corrupt_settings(path, &raw)?;
                    return Err(format!(
                        "settings file is invalid JSON ({error}); backup created at {}",
                        backup.display()
                    ));
                }
            };

            let has_schema_version = json.get("schema_version").is_some();
            let (settings, migrated) = if has_schema_version {
                let parsed: AppSettings = serde_json::from_value(json).map_err(|error| {
                    format!("settings file is invalid structure ({error}); expected versioned app settings")
                })?;
                migrate_settings(parsed)?
            } else {
                let legacy: LegacyAppSettings = serde_json::from_value(json).map_err(|error| {
                    format!("settings file is invalid structure ({error}); expected legacy app settings")
                })?;
                (
                    AppSettings {
                        schema_version: SETTINGS_SCHEMA_VERSION,
                        profile: legacy.profile,
                        providers: legacy.providers,
                        provider_routing: legacy.provider_routing,
                    },
                    true,
                )
            };

            if migrated {
                save_settings_to_path(path, &settings)?;
            }
            Ok(settings)
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(AppSettings::default()),
        Err(error) => Err(format!("failed to read settings file: {error}")),
    }
}

pub fn load_settings(app: &AppHandle) -> Result<AppSettings, String> {
    let _guard = settings_write_lock()
        .lock()
        .map_err(|error| format!("failed to lock settings state: {error}"))?;
    let path = settings_path(app)?;
    load_settings_from_path(&path)
}

pub fn save_settings_to_path(path: &Path, settings: &AppSettings) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| format!("failed to create settings directory: {error}"))?;
    }
    let mut normalized = settings.clone();
    normalized.schema_version = SETTINGS_SCHEMA_VERSION;
    let payload = serde_json::to_string_pretty(&normalized).map_err(|error| format!("failed to encode settings: {error}"))?;
    let max_attempts = 6;
    let retry_delay = std::time::Duration::from_millis(15);

    for attempt in 0..max_attempts {
        let temp_suffix = next_temp_suffix();
        let temp_path = path.with_extension(format!("tmp-{temp_suffix}"));
        let backup_path = path.with_extension("bak");

        let attempt_result: Result<(), std::io::Error> = (|| {
            fs::write(&temp_path, &payload)?;
            if path.exists() {
                if backup_path.exists() {
                    let _ = fs::remove_file(&backup_path);
                }
                fs::rename(path, &backup_path)?;
            }
            match fs::rename(&temp_path, path) {
                Ok(()) => {
                    if backup_path.exists() {
                        let _ = fs::remove_file(&backup_path);
                    }
                    Ok(())
                }
                Err(error) => {
                    if backup_path.exists() {
                        let _ = fs::rename(&backup_path, path);
                    }
                    let _ = fs::remove_file(&temp_path);
                    Err(error)
                }
            }
        })();

        match attempt_result {
            Ok(()) => return Ok(()),
            Err(error) => {
                if attempt + 1 >= max_attempts || error.kind() != std::io::ErrorKind::PermissionDenied {
                    return Err(format!("failed to write settings atomically: {error}"));
                }
                thread::sleep(retry_delay);
            }
        }
    }

    Err("failed to write settings atomically after retries".to_string())
}

pub fn save_settings(app: &AppHandle, settings: &AppSettings) -> Result<(), String> {
    let _guard = settings_write_lock()
        .lock()
        .map_err(|error| format!("failed to lock settings state: {error}"))?;
    let path = settings_path(app)?;
    save_settings_to_path(&path, settings)
}

fn update_settings<T>(
    app: &AppHandle,
    updater: impl FnOnce(&mut AppSettings) -> Result<T, String>,
) -> Result<T, String> {
    let _guard = settings_write_lock()
        .lock()
        .map_err(|error| format!("failed to lock settings state: {error}"))?;
    let path = settings_path(app)?;
    let mut settings = load_settings_from_path(&path)?;
    let result = updater(&mut settings)?;
    save_settings_to_path(&path, &settings)?;
    Ok(result)
}

pub fn get_profile(app: &AppHandle) -> Result<TerminalProfile, String> {
    Ok(load_settings(app)?.profile)
}

pub fn set_profile(app: &AppHandle, profile: TerminalProfile) -> Result<TerminalProfile, String> {
    update_settings(app, |settings| {
        settings.profile = profile.clone();
        Ok(profile)
    })
}

pub fn patch_profile(app: &AppHandle, patch: ProfilePatch) -> Result<TerminalProfile, String> {
    update_settings(app, |settings| {
        apply_profile_patch(&mut settings.profile, &patch);
        Ok(settings.profile.clone())
    })
}

pub fn get_provider_settings(app: &AppHandle) -> Result<Vec<ProviderSettings>, String> {
    Ok(load_settings(app)?.providers)
}

pub fn set_provider_settings(
    app: &AppHandle,
    providers: Vec<ProviderSettings>,
) -> Result<Vec<ProviderSettings>, String> {
    update_settings(app, |settings| {
        settings.providers = providers.clone();
        Ok(providers)
    })
}

pub fn set_provider_enabled(app: &AppHandle, provider_id: &str, enabled: bool) -> Result<Vec<ProviderSettings>, String> {
    update_settings(app, |settings| {
        for provider in &mut settings.providers {
            if provider.id == provider_id {
                provider.enabled = enabled;
            }
        }
        Ok(settings.providers.clone())
    })
}

pub fn set_provider_endpoint(
    app: &AppHandle,
    provider_id: &str,
    endpoint: Option<String>,
) -> Result<Vec<ProviderSettings>, String> {
    update_settings(app, |settings| {
        apply_provider_endpoint_patch(&mut settings.providers, provider_id, endpoint.clone());
        Ok(settings.providers.clone())
    })
}

pub fn get_provider_routing(app: &AppHandle) -> Result<ProviderRoutingSettings, String> {
    Ok(load_settings(app)?.provider_routing)
}

pub fn set_provider_routing(
    app: &AppHandle,
    provider_routing: ProviderRoutingSettings,
) -> Result<ProviderRoutingSettings, String> {
    update_settings(app, |settings| {
        settings.provider_routing = provider_routing.clone();
        Ok(provider_routing)
    })
}

pub fn patch_provider_routing(
    app: &AppHandle,
    patch: ProviderRoutingPatch,
) -> Result<ProviderRoutingSettings, String> {
    update_settings(app, |settings| {
        apply_provider_routing_patch(&mut settings.provider_routing, &patch);
        Ok(settings.provider_routing.clone())
    })
}
