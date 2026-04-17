use crate::models::HistoryEntry;
use serde::{Deserialize, Serialize};
use std::collections::VecDeque;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use tauri::AppHandle;
use tauri::Manager;
use tracing::warn;

#[derive(Debug, Serialize, Deserialize)]
struct HistoryFile {
    entries: Vec<HistoryEntry>,
}

/// Result of loading history from disk.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct HistoryLoadOutcome {
    /// True when the file existed but was not valid JSON; file was backed up and in-memory history reset.
    pub recovered_from_corruption: bool,
}

fn history_file_path(base_dir: &Path) -> PathBuf {
    base_dir.join("command_history.json")
}

fn next_temp_name() -> String {
    static TEMP_COUNTER: AtomicU64 = AtomicU64::new(0);
    let counter = TEMP_COUNTER.fetch_add(1, Ordering::Relaxed);
    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    format!("{timestamp}-{counter}")
}

fn backup_corrupt_history(path: &Path, raw: &str) -> Result<PathBuf, String> {
    let suffix = next_temp_name();
    let backup = path.with_extension(format!("corrupt-{suffix}.json"));
    fs::write(&backup, raw).map_err(|error| format!("failed to write corrupt history backup: {error}"))?;
    Ok(backup)
}

fn resolve_history_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let base = match std::env::var("MACH_TERMINAL_HISTORY_DIR") {
        Ok(override_dir) if !override_dir.trim().is_empty() => PathBuf::from(override_dir),
        _ => app
            .path()
            .app_config_dir()
            .map_err(|error| format!("failed to resolve app config dir: {error}"))?,
    };
    fs::create_dir_all(&base).map_err(|error| format!("failed to create config dir: {error}"))?;
    Ok(base)
}

pub fn load_history_from_path(
    path: &Path,
    deque: &mut VecDeque<HistoryEntry>,
    max_entries: usize,
    sequence: &AtomicU64,
) -> Result<HistoryLoadOutcome, String> {
    let raw = match fs::read_to_string(path) {
        Ok(content) => content,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Ok(HistoryLoadOutcome {
                recovered_from_corruption: false,
            });
        }
        Err(error) => return Err(format!("failed to read command history file: {error}")),
    };

    let file: HistoryFile = match serde_json::from_str(&raw) {
        Ok(f) => f,
        Err(error) => {
            let backup = backup_corrupt_history(path, &raw)?;
            warn!(
                "command history file is invalid JSON ({error}); backed up to {}; starting with empty history",
                backup.display()
            );
            deque.clear();
            sequence.store(0, Ordering::Relaxed);
            return Ok(HistoryLoadOutcome {
                recovered_from_corruption: true,
            });
        }
    };

    deque.clear();
    for entry in file.entries.into_iter().take(max_entries) {
        deque.push_back(entry);
    }
    let max_id = deque.iter().map(|entry| entry.id).max().unwrap_or(0);
    let current = sequence.load(Ordering::Relaxed);
    let floor = max_id.max(current);
    sequence.store(floor.saturating_add(1), Ordering::Relaxed);
    Ok(HistoryLoadOutcome {
        recovered_from_corruption: false,
    })
}

pub fn save_history_to_path(path: &Path, deque: &VecDeque<HistoryEntry>) -> Result<(), String> {
    let entries: Vec<HistoryEntry> = deque.iter().cloned().collect();
    let file = HistoryFile { entries };
    let payload = serde_json::to_string(&file).map_err(|error| format!("failed to encode history: {error}"))?;
    let temp_path = path.with_extension(format!("tmp-{}", next_temp_name()));
    fs::write(&temp_path, payload).map_err(|error| format!("failed to write temp history file: {error}"))?;
    if path.exists() {
        fs::remove_file(path).map_err(|error| format!("failed to replace history file: {error}"))?;
    }
    fs::rename(&temp_path, path).map_err(|error| format!("failed to finalize history file: {error}"))
}

pub fn load_history(
    app: &AppHandle,
    deque: &mut VecDeque<HistoryEntry>,
    max_entries: usize,
    sequence: &AtomicU64,
) -> Result<HistoryLoadOutcome, String> {
    let base_dir = resolve_history_dir(app)?;
    let path = history_file_path(&base_dir);
    load_history_from_path(&path, deque, max_entries, sequence)
}

pub fn save_history(app: &AppHandle, deque: &VecDeque<HistoryEntry>) -> Result<(), String> {
    let base_dir = resolve_history_dir(app)?;
    let path = history_file_path(&base_dir);
    save_history_to_path(&path, deque)
}

pub fn resolve_history_json_path(app: &AppHandle) -> Result<PathBuf, String> {
    let base_dir = resolve_history_dir(app)?;
    Ok(history_file_path(&base_dir))
}
