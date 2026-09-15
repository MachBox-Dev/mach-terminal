use crate::models::{
    AppSettings, LegacyAppSettings, ProfilePatch, ProviderRoutingPatch, ProviderRoutingSettings, ProviderSettings,
    SettingsSchemaDebug, ShellIntegrationPatch, ShellIntegrationSettings, ShellPreset, TerminalProfile,
    SETTINGS_SCHEMA_VERSION,
};
use reqwest::Url;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Mutex, OnceLock};
use std::thread;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager, Runtime};

const KNOWN_PROVIDER_IDS: [&str; 4] = ["openai", "anthropic", "ollama", "custom-openai"];

fn provider_exists(providers: &[ProviderSettings], provider_id: &str) -> bool {
    providers.iter().any(|provider| provider.id == provider_id)
}

fn validate_provider_id(provider_id: &str) -> Result<(), String> {
    if KNOWN_PROVIDER_IDS.contains(&provider_id) {
        Ok(())
    } else {
        Err(format!("unknown provider `{provider_id}`"))
    }
}

fn validate_provider_endpoint(endpoint: &str) -> Result<(), String> {
    let parsed = Url::parse(endpoint).map_err(|error| format!("endpoint must be a valid URL ({error})"))?;
    match parsed.scheme() {
        "http" | "https" => Ok(()),
        other => Err(format!("endpoint scheme `{other}` is unsupported; use http or https")),
    }
}

fn normalize_provider_endpoint_input(endpoint: Option<String>) -> Result<Option<String>, String> {
    match endpoint {
        Some(value) => {
            let trimmed = value.trim();
            if trimmed.is_empty() {
                return Ok(None);
            }
            validate_provider_endpoint(trimmed)?;
            Ok(Some(trimmed.to_string()))
        }
        None => Ok(None),
    }
}

fn validate_provider_routing(
    providers: &[ProviderSettings],
    routing: &ProviderRoutingSettings,
) -> Result<(), String> {
    if routing.default_provider.trim().is_empty() {
        return Err("provider routing default_provider cannot be empty".to_string());
    }
    if !provider_exists(providers, routing.default_provider.as_str()) {
        return Err(format!(
            "provider routing default_provider `{}` is not configured",
            routing.default_provider
        ));
    }
    if routing.ollama_model.trim().is_empty() {
        return Err("provider routing ollama_model cannot be empty".to_string());
    }
    if routing.openai_model.trim().is_empty() {
        return Err("provider routing openai_model cannot be empty".to_string());
    }
    if routing.anthropic_model.trim().is_empty() {
        return Err("provider routing anthropic_model cannot be empty".to_string());
    }
    if routing.custom_openai_model.trim().is_empty() {
        return Err("provider routing custom_openai_model cannot be empty".to_string());
    }
    Ok(())
}

fn settings_path<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    let base_dir = app
        .path()
        .app_config_dir()
        .map_err(|error| format!("failed to resolve app config dir: {error}"))?;

    fs::create_dir_all(&base_dir).map_err(|error| format!("failed to create config dir: {error}"))?;
    Ok(base_dir.join("settings.json"))
}

pub fn resolve_settings_json_path<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
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

pub fn settings_schema_dump<R: Runtime>(app: &AppHandle<R>) -> Result<SettingsSchemaDebug, String> {
    let path = settings_path(app)?;
    settings_schema_dump_from_path(&path)
}

pub fn apply_profile_patch(profile: &mut TerminalProfile, patch: &ProfilePatch) {
    if let Some(shell) = patch.shell.clone() {
        profile.shell = shell;
    }
    if let Some(args) = patch.args.clone() {
        profile.args = args;
    }
    if let Some(cwd) = patch.cwd.clone() {
        profile.cwd = cwd;
    }
    if let Some(font_size) = patch.font_size {
        profile.font_size = font_size;
    }
    if let Some(minimal_shell_prompt) = patch.minimal_shell_prompt {
        profile.minimal_shell_prompt = minimal_shell_prompt;
    }
    if let Some(show_composer_assist_metrics) = patch.show_composer_assist_metrics {
        profile.show_composer_assist_metrics = show_composer_assist_metrics;
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
    if let Some(openai_model) = patch.openai_model.clone() {
        routing.openai_model = openai_model;
    }
    if let Some(anthropic_model) = patch.anthropic_model.clone() {
        routing.anthropic_model = anthropic_model;
    }
    if let Some(custom_openai_model) = patch.custom_openai_model.clone() {
        routing.custom_openai_model = custom_openai_model;
    }
    if let Some(ai_feature_enabled) = patch.ai_feature_enabled {
        routing.ai_feature_enabled = ai_feature_enabled;
    }
    if let Some(system_prompt) = patch.system_prompt.clone() {
        routing.system_prompt = system_prompt;
    }
    if let Some(ai_context_budget_chars) = patch.ai_context_budget_chars {
        routing.ai_context_budget_chars = ai_context_budget_chars.clamp(4_000, 120_000);
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
                        shell_integration: ShellIntegrationSettings::default(),
                        shell_presets: Vec::new(),
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

pub fn load_settings<R: Runtime>(app: &AppHandle<R>) -> Result<AppSettings, String> {
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
                // Concurrent writers can race on `rename` (TOCTOU on `path.exists`, or Windows
                // replace semantics). `NotFound` is treated as retryable like `PermissionDenied`.
                let retryable = matches!(
                    error.kind(),
                    std::io::ErrorKind::PermissionDenied | std::io::ErrorKind::NotFound
                );
                if attempt + 1 >= max_attempts || !retryable {
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

pub fn get_profile<R: Runtime>(app: &AppHandle<R>) -> Result<TerminalProfile, String> {
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

pub fn get_shell_integration_settings(app: &AppHandle) -> Result<ShellIntegrationSettings, String> {
    Ok(load_settings(app)?.shell_integration)
}

pub fn patch_shell_integration_settings(
    app: &AppHandle,
    patch: ShellIntegrationPatch,
) -> Result<ShellIntegrationSettings, String> {
    update_settings(app, |settings| {
        if let Some(pwsh_profile_override) = patch.pwsh_profile_override.clone() {
            settings.shell_integration.pwsh_profile_override = pwsh_profile_override;
        }
        if let Some(seen) = patch.onboarding_install_prompt_seen {
            settings.shell_integration.onboarding_install_prompt_seen = seen;
        }
        Ok(settings.shell_integration.clone())
    })
}

fn validate_shell_presets(presets: &[ShellPreset]) -> Result<(), String> {
    for preset in presets {
        if preset.id.trim().is_empty() {
            return Err("shell preset id is required".to_string());
        }
        if preset.name.trim().is_empty() {
            return Err("shell preset name is required".to_string());
        }
        if preset.shell.trim().is_empty() {
            return Err("shell preset shell is required".to_string());
        }
    }
    if let Some(duplicate) = presets
        .iter()
        .map(|preset| preset.id.as_str())
        .find(|preset_id| presets.iter().filter(|preset| preset.id.as_str() == *preset_id).count() > 1)
    {
        return Err(format!("duplicate shell preset id `{duplicate}`"));
    }
    Ok(())
}

pub fn get_shell_presets(app: &AppHandle) -> Result<Vec<ShellPreset>, String> {
    Ok(load_settings(app)?.shell_presets)
}

pub fn set_shell_presets(app: &AppHandle, presets: Vec<ShellPreset>) -> Result<Vec<ShellPreset>, String> {
    validate_shell_presets(&presets)?;
    update_settings(app, |settings| {
        settings.shell_presets = presets.clone();
        Ok(presets)
    })
}

pub fn get_provider_settings(app: &AppHandle) -> Result<Vec<ProviderSettings>, String> {
    Ok(load_settings(app)?.providers)
}

pub fn set_provider_settings(
    app: &AppHandle,
    providers: Vec<ProviderSettings>,
) -> Result<Vec<ProviderSettings>, String> {
    for provider in &providers {
        validate_provider_id(provider.id.as_str())?;
        if let Some(endpoint) = provider.endpoint.as_deref() {
            validate_provider_endpoint(endpoint)?;
        }
    }
    if let Some(duplicate) = providers.iter().map(|provider| provider.id.as_str()).find(|provider_id| {
        providers
            .iter()
            .filter(|provider| provider.id.as_str() == *provider_id)
            .count()
            > 1
    }) {
        return Err(format!("duplicate provider id `{duplicate}` in provider settings"));
    }
    update_settings(app, |settings| {
        settings.providers = providers.clone();
        validate_provider_routing(&settings.providers, &settings.provider_routing)?;
        Ok(providers)
    })
}

pub fn set_provider_enabled(app: &AppHandle, provider_id: &str, enabled: bool) -> Result<Vec<ProviderSettings>, String> {
    validate_provider_id(provider_id)?;
    update_settings(app, |settings| {
        let mut updated = false;
        for provider in &mut settings.providers {
            if provider.id == provider_id {
                provider.enabled = enabled;
                updated = true;
            }
        }
        if !updated {
            return Err(format!("provider `{provider_id}` is not configured"));
        }
        Ok(settings.providers.clone())
    })
}

pub fn set_provider_endpoint(
    app: &AppHandle,
    provider_id: &str,
    endpoint: Option<String>,
) -> Result<Vec<ProviderSettings>, String> {
    validate_provider_id(provider_id)?;
    let normalized_endpoint = normalize_provider_endpoint_input(endpoint)?;
    update_settings(app, |settings| {
        if !provider_exists(&settings.providers, provider_id) {
            return Err(format!("provider `{provider_id}` is not configured"));
        }
        apply_provider_endpoint_patch(&mut settings.providers, provider_id, normalized_endpoint.clone());
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
    let normalized_routing = ProviderRoutingSettings {
        default_provider: provider_routing.default_provider.trim().to_string(),
        ollama_model: provider_routing.ollama_model.trim().to_string(),
        openai_model: provider_routing.openai_model.trim().to_string(),
        anthropic_model: provider_routing.anthropic_model.trim().to_string(),
        custom_openai_model: provider_routing.custom_openai_model.trim().to_string(),
        ai_feature_enabled: provider_routing.ai_feature_enabled,
        system_prompt: provider_routing.system_prompt.trim().to_string(),
        ai_context_budget_chars: provider_routing.ai_context_budget_chars.clamp(4_000, 120_000),
    };
    update_settings(app, |settings| {
        validate_provider_routing(&settings.providers, &normalized_routing)?;
        settings.provider_routing = normalized_routing.clone();
        Ok(normalized_routing)
    })
}

pub fn patch_provider_routing(
    app: &AppHandle,
    patch: ProviderRoutingPatch,
) -> Result<ProviderRoutingSettings, String> {
    update_settings(app, |settings| {
        apply_provider_routing_patch(&mut settings.provider_routing, &patch);
        settings.provider_routing.default_provider = settings.provider_routing.default_provider.trim().to_string();
        settings.provider_routing.ollama_model = settings.provider_routing.ollama_model.trim().to_string();
        settings.provider_routing.openai_model = settings.provider_routing.openai_model.trim().to_string();
        settings.provider_routing.anthropic_model = settings.provider_routing.anthropic_model.trim().to_string();
        settings.provider_routing.custom_openai_model = settings.provider_routing.custom_openai_model.trim().to_string();
        validate_provider_routing(&settings.providers, &settings.provider_routing)?;
        Ok(settings.provider_routing.clone())
    })
}

#[cfg(test)]
mod tests {
    use super::apply_profile_patch;
    use crate::models::{ProfilePatch, TerminalProfile};

    #[test]
    fn profile_patch_sets_shell_and_args_together() {
        let mut profile = TerminalProfile::default();
        let patch = ProfilePatch {
            shell: Some(Some("wsl.exe".to_string())),
            args: Some(vec!["-d".to_string(), "Ubuntu".to_string()]),
            ..ProfilePatch::default()
        };
        apply_profile_patch(&mut profile, &patch);
        assert_eq!(profile.shell.as_deref(), Some("wsl.exe"));
        assert_eq!(profile.args, vec!["-d".to_string(), "Ubuntu".to_string()]);
    }

    #[test]
    fn profile_patch_omitting_args_preserves_existing() {
        let mut profile = TerminalProfile {
            args: vec!["-NoLogo".to_string()],
            ..TerminalProfile::default()
        };
        let patch = ProfilePatch {
            font_size: Some(15),
            ..ProfilePatch::default()
        };
        apply_profile_patch(&mut profile, &patch);
        assert_eq!(profile.args, vec!["-NoLogo".to_string()]);
        assert_eq!(profile.font_size, 15);
    }

    #[test]
    fn profile_patch_clears_args_with_empty_vec() {
        let mut profile = TerminalProfile {
            args: vec!["-d".to_string(), "Ubuntu".to_string()],
            ..TerminalProfile::default()
        };
        let patch = ProfilePatch {
            args: Some(Vec::new()),
            ..ProfilePatch::default()
        };
        apply_profile_patch(&mut profile, &patch);
        assert!(profile.args.is_empty());
    }

    #[test]
    fn profile_patch_json_deserializes_shell_string() {
        let patch: ProfilePatch =
            serde_json::from_str(r#"{"shell":"wsl.exe","args":["-d","Ubuntu"]}"#).expect("parse patch json");
        assert_eq!(patch.shell, Some(Some("wsl.exe".to_string())));
        assert_eq!(patch.args.as_deref(), Some(&["-d".to_string(), "Ubuntu".to_string()][..]));
    }

    #[test]
    fn profile_patch_json_deserializes_shell_null_as_clear() {
        let patch: ProfilePatch = serde_json::from_str(r#"{"shell":null}"#).expect("parse patch json");
        assert_eq!(patch.shell, Some(None));
    }
}
