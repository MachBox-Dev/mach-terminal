use crate::models::{WorkspaceLayout, WORKSPACE_LAYOUT_SCHEMA_VERSION};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::AppHandle;
use tauri::Manager;
use tracing::warn;

fn workspace_file_path(app: &AppHandle) -> Result<PathBuf, String> {
    let base_dir = app
        .path()
        .app_config_dir()
        .map_err(|error| format!("failed to resolve app config dir: {error}"))?;
    fs::create_dir_all(&base_dir).map_err(|error| format!("failed to create config dir: {error}"))?;
    Ok(base_dir.join("workspace_layout.json"))
}

fn next_temp_suffix() -> String {
    static TEMP_COUNTER: AtomicU64 = AtomicU64::new(0);
    let counter = TEMP_COUNTER.fetch_add(1, Ordering::Relaxed);
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    format!("{timestamp}-{counter}")
}

fn backup_corrupt_workspace(path: &Path, raw: &str) -> Result<PathBuf, String> {
    let suffix = next_temp_suffix();
    let backup = path.with_extension(format!("corrupt-{suffix}.json"));
    fs::write(&backup, raw).map_err(|error| format!("failed to write corrupt workspace backup: {error}"))?;
    Ok(backup)
}

pub fn load_workspace_layout_from_path(path: &Path) -> Result<Option<WorkspaceLayout>, String> {
    let raw = match fs::read_to_string(path) {
        Ok(content) => content,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(format!("failed to read workspace layout file: {error}")),
    };

    match serde_json::from_str::<WorkspaceLayout>(&raw) {
        Ok(layout) => {
            if layout.schema_version > WORKSPACE_LAYOUT_SCHEMA_VERSION {
                return Err(format!(
                    "workspace layout schema version {} is newer than supported {}",
                    layout.schema_version, WORKSPACE_LAYOUT_SCHEMA_VERSION
                ));
            }
            Ok(Some(layout))
        }
        Err(error) => {
            let backup = backup_corrupt_workspace(path, &raw)?;
            warn!(
                "workspace layout file is invalid JSON ({error}); backed up to {}; starting with no saved layout",
                backup.display()
            );
            Ok(None)
        }
    }
}

pub fn save_workspace_layout_to_path(path: &Path, layout: &WorkspaceLayout) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| format!("failed to create workspace directory: {error}"))?;
    }
    let mut normalized = layout.clone();
    normalized.schema_version = WORKSPACE_LAYOUT_SCHEMA_VERSION;
    let payload =
        serde_json::to_string_pretty(&normalized).map_err(|error| format!("failed to encode workspace layout: {error}"))?;
    let temp_path = path.with_extension(format!("tmp-{}", next_temp_suffix()));
    fs::write(&temp_path, payload).map_err(|error| format!("failed to write temp workspace layout: {error}"))?;
    if path.exists() {
        fs::remove_file(path).map_err(|error| format!("failed to replace workspace layout file: {error}"))?;
    }
    fs::rename(&temp_path, path).map_err(|error| format!("failed to finalize workspace layout file: {error}"))
}

pub fn load_workspace_layout(app: &AppHandle) -> Result<Option<WorkspaceLayout>, String> {
    let path = workspace_file_path(app)?;
    load_workspace_layout_from_path(&path)
}

pub fn save_workspace_layout(app: &AppHandle, layout: &WorkspaceLayout) -> Result<(), String> {
    let path = workspace_file_path(app)?;
    save_workspace_layout_to_path(&path, layout)
}
