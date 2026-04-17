use mach_terminal_lib::models::{AppSettings, SETTINGS_SCHEMA_VERSION};
use mach_terminal_lib::settings::{
    apply_provider_endpoint_patch, load_settings_from_path, save_settings_to_path,
};
use std::fs;
use std::sync::Arc;
use std::thread;
use tempfile::tempdir;

#[test]
fn malformed_settings_creates_backup_and_returns_error() {
    let temp = tempdir().expect("tempdir");
    let settings_path = temp.path().join("settings.json");
    fs::write(&settings_path, "{invalid-json").expect("write malformed settings");

    let error = load_settings_from_path(&settings_path).expect_err("malformed settings should fail");
    assert!(error.contains("invalid JSON"));

    let backup_count = fs::read_dir(temp.path())
        .expect("read temp dir")
        .filter_map(Result::ok)
        .filter(|entry| entry.file_name().to_string_lossy().contains("corrupt-"))
        .count();
    assert!(backup_count >= 1, "expected at least one corrupt backup file");
}

#[test]
fn save_and_load_round_trip_settings_file() {
    let temp = tempdir().expect("tempdir");
    let settings_path = temp.path().join("settings.json");
    let mut settings = AppSettings::default();
    settings.profile.font_size = 16;

    save_settings_to_path(&settings_path, &settings).expect("save settings");
    let loaded = load_settings_from_path(&settings_path).expect("load settings");
    assert_eq!(loaded.schema_version, SETTINGS_SCHEMA_VERSION);
    assert_eq!(loaded.profile.font_size, 16);
}

#[test]
fn concurrent_writes_do_not_corrupt_file() {
    let temp = tempdir().expect("tempdir");
    let settings_path = Arc::new(temp.path().join("settings.json"));

    let mut handles = Vec::new();
    for font_size in [12_u8, 13_u8, 14_u8, 15_u8, 16_u8] {
        let path = Arc::clone(&settings_path);
        handles.push(thread::spawn(move || {
            let mut settings = AppSettings::default();
            settings.profile.font_size = font_size;
            save_settings_to_path(path.as_ref(), &settings).expect("save from thread");
        }));
    }

    for handle in handles {
        handle.join().expect("writer thread join");
    }

    let loaded = load_settings_from_path(settings_path.as_ref()).expect("load after concurrent writes");
    assert!((12..=16).contains(&loaded.profile.font_size));
}

#[test]
fn legacy_settings_without_schema_version_are_migrated() {
    let temp = tempdir().expect("tempdir");
    let settings_path = temp.path().join("settings.json");
    fs::write(
        &settings_path,
        r#"{
  "profile": { "shell": null, "cwd": null, "env": {}, "font_size": 15 },
  "providers": [
    { "id": "openai", "enabled": false, "endpoint": null, "api_key_env": "OPENAI_API_KEY" }
  ],
  "provider_routing": { "default_provider": "openai", "ollama_model": "llama3.2", "ai_feature_enabled": false }
}"#,
    )
    .expect("write legacy settings");

    let migrated = load_settings_from_path(&settings_path).expect("load migrated settings");
    assert_eq!(migrated.schema_version, SETTINGS_SCHEMA_VERSION);
    assert_eq!(migrated.profile.font_size, 15);

    let rewritten_raw = fs::read_to_string(&settings_path).expect("read rewritten settings");
    let rewritten_json: serde_json::Value = serde_json::from_str(&rewritten_raw).expect("valid rewritten json");
    assert_eq!(
        rewritten_json
            .get("schema_version")
            .and_then(|value| value.as_u64()),
        Some(SETTINGS_SCHEMA_VERSION as u64)
    );
}

#[test]
fn provider_endpoint_patch_does_not_drop_unrelated_provider_fields() {
    let mut settings = AppSettings::default();
    let original_api_env = settings
        .providers
        .iter()
        .find(|provider| provider.id == "openai")
        .and_then(|provider| provider.api_key_env.clone())
        .expect("openai api_key_env exists");

    apply_provider_endpoint_patch(
        &mut settings.providers,
        "openai",
        Some("https://api.openai.example".to_string()),
    );

    let updated = settings
        .providers
        .iter()
        .find(|provider| provider.id == "openai")
        .expect("openai provider");
    assert_eq!(updated.endpoint.as_deref(), Some("https://api.openai.example"));
    assert_eq!(updated.api_key_env.as_deref(), Some(original_api_env.as_str()));
    assert!(settings.providers.iter().any(|provider| provider.id == "anthropic"));
}

#[test]
fn concurrent_patch_writes_keep_json_valid_and_preserve_invariants() {
    let temp = tempdir().expect("tempdir");
    let settings_path = Arc::new(temp.path().join("settings.json"));
    save_settings_to_path(settings_path.as_ref(), &AppSettings::default()).expect("initial save");

    let mut handles = Vec::new();
    for endpoint in [
        "http://localhost:11434",
        "http://localhost:11435",
        "http://localhost:11436",
    ] {
        let path = Arc::clone(&settings_path);
        let endpoint = endpoint.to_string();
        handles.push(thread::spawn(move || {
            let mut settings = load_settings_from_path(path.as_ref()).expect("load in writer");
            apply_provider_endpoint_patch(&mut settings.providers, "ollama", Some(endpoint));
            save_settings_to_path(path.as_ref(), &settings).expect("save in writer");
        }));
    }

    for handle in handles {
        handle.join().expect("patch writer join");
    }

    let loaded = load_settings_from_path(settings_path.as_ref()).expect("load after patch writes");
    assert_eq!(loaded.schema_version, SETTINGS_SCHEMA_VERSION);
    assert!(loaded.providers.iter().any(|provider| provider.id == "openai"));
    assert!(loaded.providers.iter().any(|provider| provider.id == "ollama"));
}
