//! Materialize Mach-owned shell hooks under app local data and optionally inject a marker block into user profiles.

use serde::Serialize;
use std::fs;
use std::io::{ErrorKind, Read};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager};

use crate::models::{
    ShellIntegrationBackupEntry, ShellIntegrationBackupListResult, ShellIntegrationBackupRestoreResult,
    ShellIntegrationSettings, TerminalProfile,
};
use crate::settings;

pub const MACH_SHELL_SCRIPT_VERSION: u32 = 1;

pub const MARKER_BEGIN: &str = "# BEGIN MACH TERMINAL SHELL HOOK";
pub const MARKER_END: &str = "# END MACH TERMINAL SHELL HOOK";

/// Cap profile reads/writes to avoid pathological files (512 KiB).
const MAX_PROFILE_BYTES: usize = 512 * 1024;

static PROFILE_EDIT_LOCK: Mutex<()> = Mutex::new(());

const EMBED_PS1: &str = include_str!("../resources/shell/mach-init.ps1");
const EMBED_BASH: &str = include_str!("../resources/shell/mach-init.bash");
const EMBED_ZSH: &str = include_str!("../resources/shell/mach-init.zsh");

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShellIntegrationMaterializeResult {
    pub dir: String,
    pub version: u32,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShellIntegrationShellCapabilities {
    pub supports_backup_restore: bool,
    pub supports_profile_override: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShellIntegrationShellStatus {
    pub shell_kind: String,
    pub profile_path: Option<String>,
    pub profile_resolved: bool,
    pub marker_present: bool,
    /// `healthy`, `stale`, `missing`, or `error`.
    pub health: String,
    /// Number of available sidecar backups.
    pub backup_count: Option<u32>,
    pub capabilities: ShellIntegrationShellCapabilities,
    /// `override`, `auto`, or unset when PowerShell profile could not be resolved.
    pub profile_path_source: Option<String>,
    pub error: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShellIntegrationStatus {
    pub script_version: u32,
    pub shell_dir: String,
    pub shells: Vec<ShellIntegrationShellStatus>,
}

fn shell_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let base = app
        .path()
        .app_local_data_dir()
        .map_err(|e| format!("failed to resolve app local data dir: {e}"))?;
    Ok(base.join("shell"))
}

fn materialize_scripts_inner(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = shell_dir(app)?;
    fs::create_dir_all(&dir).map_err(|e| format!("failed to create shell dir: {e}"))?;
    let ps1 = dir.join("mach-init.ps1");
    let bash = dir.join("mach-init.bash");
    let zsh = dir.join("mach-init.zsh");
    fs::write(&ps1, EMBED_PS1.as_bytes()).map_err(|e| format!("failed to write mach-init.ps1: {e}"))?;
    fs::write(&bash, EMBED_BASH.as_bytes()).map_err(|e| format!("failed to write mach-init.bash: {e}"))?;
    fs::write(&zsh, EMBED_ZSH.as_bytes()).map_err(|e| format!("failed to write mach-init.zsh: {e}"))?;
    Ok(dir)
}

/// Ensure scripts on disk match the embedded bodies (updates on each call).
#[tauri::command]
#[tracing::instrument(skip(app))]
pub fn shell_integration_materialize_scripts(app: AppHandle) -> Result<ShellIntegrationMaterializeResult, String> {
    let dir = materialize_scripts_inner(&app)?;
    Ok(ShellIntegrationMaterializeResult {
        dir: dir.to_string_lossy().to_string(),
        version: MACH_SHELL_SCRIPT_VERSION,
    })
}

fn read_profile_capped(path: &Path) -> Result<String, String> {
    let meta = fs::metadata(path).map_err(|e| format!("failed to stat profile: {e}"))?;
    if meta.len() as usize > MAX_PROFILE_BYTES {
        return Err(format!(
            "profile exceeds max size ({} MiB)",
            MAX_PROFILE_BYTES / (1024 * 1024)
        ));
    }
    let f = fs::File::open(path).map_err(|e| format!("failed to open profile: {e}"))?;
    let mut buf = Vec::new();
    f.take(MAX_PROFILE_BYTES as u64)
        .read_to_end(&mut buf)
        .map_err(|e| format!("failed to read profile: {e}"))?;
    String::from_utf8(buf).map_err(|e| format!("profile is not valid UTF-8: {e}"))
}

fn marker_present(content: &str) -> bool {
    content.contains(MARKER_BEGIN) && content.contains(MARKER_END)
}

fn marker_inner_line(content: &str) -> Option<String> {
    let start = content.find(MARKER_BEGIN)?;
    let from_start = &content[start + MARKER_BEGIN.len()..];
    let from_start = from_start.trim_start_matches(['\r', '\n']);
    let end = from_start.find(MARKER_END)?;
    let inner = from_start[..end].trim();
    if inner.is_empty() {
        None
    } else {
        Some(inner.to_string())
    }
}

fn strip_profile_block_simple(content: &str) -> String {
    if !marker_present(content) {
        return content.to_string();
    }
    let mut result = content.to_string();
    while let Some(start) = result.find(MARKER_BEGIN) {
        let after_start = &result[start..];
        if let Some(rel_end) = after_start.find(MARKER_END) {
            let end_idx = start + rel_end + MARKER_END.len();
            let tail = &result[end_idx..];
            let strip_to = end_idx + if tail.starts_with("\r\n") {
                2
            } else if tail.starts_with('\n') {
                1
            } else {
                0
            };
            result.replace_range(start..strip_to, "");
        } else {
            break;
        }
    }
    while result.contains("\n\n\n") {
        result = result.replace("\n\n\n", "\n\n");
    }
    result.trim_end().to_string()
}

/// Replace or remove Mach block — used by tests and production.
pub fn replace_mach_profile_block(content: &str, new_inner: Option<&str>) -> String {
    let base = strip_profile_block_simple(content);
    let base_trim = base.trim_end();
    match new_inner {
        Some(inner) => {
            let block = format!("{MARKER_BEGIN}\n{inner}\n{MARKER_END}\n");
            if base_trim.is_empty() {
                block
            } else if !base_trim.ends_with('\n') {
                format!("{base_trim}\n\n{block}")
            } else {
                format!("{base_trim}\n{block}")
            }
        }
        None => {
            if base_trim.is_empty() {
                String::new()
            } else {
                format!("{base_trim}\n")
            }
        }
    }
}

fn pwsh_exe_for_profile_hint(shell: Option<&str>) -> &'static str {
    let s = shell.unwrap_or("").to_lowercase();
    if s.contains("powershell") && !s.contains("pwsh") {
        return "powershell";
    }
    "pwsh"
}

fn try_resolve_powershell_profile(exe: &str) -> Result<PathBuf, String> {
    let output = Command::new(exe)
        .args(["-NoProfile", "-NonInteractive", "-Command", "Write-Output $PROFILE"])
        .output()
        .map_err(|e| format!("failed to run {exe} (is it on PATH?): {e}"))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("{exe} failed to print $PROFILE: {stderr}"));
    }
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if stdout.is_empty() {
        return Err("$PROFILE resolved to empty string".to_string());
    }
    if !stdout.to_lowercase().ends_with(".ps1") {
        return Err(format!("unexpected $PROFILE value (expected .ps1): {stdout}"));
    }
    Ok(PathBuf::from(stdout))
}

fn resolve_powershell_profile(shell_hint: Option<&str>) -> Result<PathBuf, String> {
    let primary = pwsh_exe_for_profile_hint(shell_hint);
    match try_resolve_powershell_profile(primary) {
        Ok(p) => Ok(p),
        Err(e1) => {
            if primary == "pwsh" {
                try_resolve_powershell_profile("powershell")
                    .map_err(|e2| format!("{e1}; fallback powershell.exe: {e2}"))
            } else {
                Err(e1)
            }
        }
    }
}

fn resolve_bash_profile() -> Option<PathBuf> {
    dirs::home_dir().map(|h| h.join(".bashrc"))
}

fn resolve_zsh_profile() -> Option<PathBuf> {
    dirs::home_dir().map(|h| h.join(".zshrc"))
}

fn resolve_unix_shell_profile(shell_kind: &str) -> Option<PathBuf> {
    match shell_kind {
        "bash" => resolve_bash_profile(),
        "zsh" => resolve_zsh_profile(),
        _ => None,
    }
}

fn normalize_pwsh_display_path(raw: &str) -> String {
    let t = raw.trim();
    if cfg!(windows) {
        t.replace('/', "\\")
    } else {
        t.to_string()
    }
}

/// Validates a user-configured PowerShell profile override (Windows-first).
pub fn validate_pwsh_profile_override(raw: &str) -> Result<PathBuf, String> {
    let t = raw.trim();
    if t.is_empty() {
        return Err("PowerShell profile override cannot be empty or whitespace-only.".to_string());
    }
    if t.contains('\0') {
        return Err("profile path contains invalid characters".to_string());
    }
    if !t.to_lowercase().ends_with(".ps1") {
        return Err("PowerShell profile override must end with .ps1.".to_string());
    }
    Ok(PathBuf::from(normalize_pwsh_display_path(t)))
}

fn pwsh_trimmed_override(si: &ShellIntegrationSettings) -> Option<&str> {
    si.pwsh_profile_override.as_deref().map(str::trim).filter(|s| !s.is_empty())
}

fn resolve_pwsh_hook_target(app: &AppHandle, shell_hint: Option<&str>) -> Result<(PathBuf, &'static str), String> {
    let si = settings::load_settings(app).map(|s| s.shell_integration).unwrap_or_default();
    if let Some(t) = pwsh_trimmed_override(&si) {
        let path = validate_pwsh_profile_override(t)?;
        return Ok((path, "override"));
    }
    resolve_powershell_profile(shell_hint).map(|p| (p, "auto"))
}

fn resolve_shell_hook_target(
    app: &AppHandle,
    shell_kind: &str,
    shell_hint: Option<&str>,
) -> Result<(PathBuf, Option<&'static str>), String> {
    match shell_kind {
        "pwsh" | "powershell" => {
            let (path, source) = resolve_pwsh_hook_target(app, shell_hint)?;
            Ok((path, Some(source)))
        }
        "bash" | "zsh" => {
            let path = resolve_unix_shell_profile(shell_kind)
                .ok_or_else(|| "could not resolve home directory".to_string())?;
            Ok((path, Some("auto")))
        }
        _ => Err(format!("unknown shell_kind: {shell_kind}")),
    }
}

fn shell_capabilities(shell_kind: &str) -> ShellIntegrationShellCapabilities {
    ShellIntegrationShellCapabilities {
        supports_backup_restore: matches!(shell_kind, "pwsh" | "powershell" | "bash" | "zsh"),
        supports_profile_override: matches!(shell_kind, "pwsh" | "powershell"),
    }
}

fn classify_shell_health(error: Option<&str>, marker: bool, expected_matches: Option<bool>) -> &'static str {
    if error.is_some() {
        return "error";
    }
    if !marker {
        return "missing";
    }
    if let Some(false) = expected_matches {
        return "stale";
    }
    "healthy"
}

fn backup_dir_for_profile(profile_path: &Path) -> Result<PathBuf, String> {
    let parent = profile_path
        .parent()
        .ok_or_else(|| "profile path has no parent directory".to_string())?;
    Ok(parent.join(".mach-terminal-shell-backups"))
}

#[derive(Debug, Clone)]
struct BackupCandidate {
    path: PathBuf,
    entry: ShellIntegrationBackupEntry,
}

fn list_backup_candidates(profile_path: &Path) -> Result<Vec<BackupCandidate>, String> {
    let backup_dir = backup_dir_for_profile(profile_path)?;
    if !backup_dir.exists() {
        return Ok(Vec::new());
    }
    let fname = profile_path
        .file_name()
        .ok_or_else(|| "profile path has no file name".to_string())?
        .to_string_lossy()
        .to_string();
    let prefix = format!("{fname}.");
    const SUFFIX: &str = ".mach.bak";

    let mut candidates: Vec<BackupCandidate> = Vec::new();
    for entry in fs::read_dir(&backup_dir).map_err(|e| format!("failed to read backup directory: {e}"))? {
        let Ok(entry) = entry else {
            continue;
        };
        let name = entry.file_name().to_string_lossy().to_string();
        if !name.starts_with(&prefix) || !name.ends_with(SUFFIX) {
            continue;
        }
        let ts_part = &name[prefix.len()..name.len() - SUFFIX.len()];
        let Ok(ts) = ts_part.parse::<u64>() else {
            continue;
        };
        let Ok(metadata) = entry.metadata() else {
            continue;
        };
        candidates.push(BackupCandidate {
            path: entry.path(),
            entry: ShellIntegrationBackupEntry {
                backup_id: format!("{ts}:{name}"),
                file_name: name,
                created_at_ms: ts,
                size_bytes: metadata.len(),
            },
        });
    }
    candidates.sort_by(|a, b| b.entry.created_at_ms.cmp(&a.entry.created_at_ms));
    Ok(candidates)
}

fn count_backups_for_profile(profile_path: &Path) -> u32 {
    list_backup_candidates(profile_path)
        .map(|v| v.len() as u32)
        .unwrap_or(0)
}

fn pwsh_shell_status(pb: &Path, source: &'static str, expected_line: Option<&str>) -> ShellIntegrationShellStatus {
    let ps = pb.to_string_lossy().to_string();
    let backup_count = Some(count_backups_for_profile(pb));
    if pb.exists() {
        match read_profile_capped(pb) {
            Ok(c) => {
                let marker = marker_present(&c);
                let matches_expected = if marker {
                    match (expected_line, marker_inner_line(&c)) {
                        (Some(expected), Some(inner)) => Some(inner == expected),
                        _ => None,
                    }
                } else {
                    None
                };
                ShellIntegrationShellStatus {
                    shell_kind: "pwsh".to_string(),
                    profile_path: Some(ps),
                    profile_resolved: true,
                    marker_present: marker,
                    health: classify_shell_health(None, marker, matches_expected).to_string(),
                    backup_count,
                    capabilities: shell_capabilities("pwsh"),
                    profile_path_source: Some(source.to_string()),
                    error: None,
                }
            }
            Err(e) => ShellIntegrationShellStatus {
                shell_kind: "pwsh".to_string(),
                profile_path: Some(ps),
                profile_resolved: true,
                marker_present: false,
                health: classify_shell_health(Some(e.as_str()), false, None).to_string(),
                backup_count,
                capabilities: shell_capabilities("pwsh"),
                profile_path_source: Some(source.to_string()),
                error: Some(e),
            },
        }
    } else {
        ShellIntegrationShellStatus {
            shell_kind: "pwsh".to_string(),
            profile_path: Some(ps),
            profile_resolved: true,
            marker_present: false,
            health: "missing".to_string(),
            backup_count,
            capabilities: shell_capabilities("pwsh"),
            profile_path_source: Some(source.to_string()),
            error: None,
        }
    }
}

const MAX_SIDE_CAR_PROFILE_BACKUPS: usize = 3;

fn backup_profile_before_mutate(profile_path: &Path) -> Result<(), String> {
    if !profile_path.exists() {
        return Ok(());
    }
    let fname = profile_path
        .file_name()
        .ok_or_else(|| "profile path has no file name".to_string())?;
    let backup_dir = backup_dir_for_profile(profile_path)?;
    fs::create_dir_all(&backup_dir).map_err(|e| format!("failed to create backup directory: {e}"))?;
    let ts = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let backup_name = format!("{}.{ts}.mach.bak", fname.to_string_lossy());
    let dest = backup_dir.join(backup_name);
    fs::copy(profile_path, &dest).map_err(|e| map_profile_io_error("backup profile", e))?;

    let stem_prefix = format!("{}.", fname.to_string_lossy());
    let mut dated: Vec<(SystemTime, PathBuf)> = fs::read_dir(&backup_dir)
        .map_err(|e| format!("failed to read backup directory: {e}"))?
        .filter_map(|e| e.ok())
        .filter(|e| {
            let name = e.file_name().to_string_lossy().to_string();
            name.starts_with(&stem_prefix) && name.ends_with(".mach.bak")
        })
        .filter_map(|e| {
            let mt = e.metadata().ok()?.modified().ok()?;
            Some((mt, e.path()))
        })
        .collect();
    dated.sort_by(|a, b| b.0.cmp(&a.0));
    for (_, old) in dated.into_iter().skip(MAX_SIDE_CAR_PROFILE_BACKUPS) {
        let _ = fs::remove_file(old);
    }
    Ok(())
}

fn map_profile_io_error(op: &str, e: std::io::Error) -> String {
    if e.kind() == ErrorKind::PermissionDenied {
        format!("{op}: permission denied (profile may be locked by policy or another editor): {e}")
    } else {
        format!("{op}: {e}")
    }
}

fn unix_profile_shell_status(kind: &str, resolve: Option<PathBuf>, expected_line: Option<&str>) -> ShellIntegrationShellStatus {
    match resolve {
        None => ShellIntegrationShellStatus {
            shell_kind: kind.to_string(),
            profile_path: None,
            profile_resolved: false,
            marker_present: false,
            health: "error".to_string(),
            backup_count: None,
            capabilities: shell_capabilities(kind),
            profile_path_source: None,
            error: Some("could not resolve home directory".to_string()),
        },
        Some(path) => {
            let ps = path.to_string_lossy().to_string();
            let backup_count = Some(count_backups_for_profile(&path));
            if path.exists() {
                match read_profile_capped(&path) {
                    Ok(c) => {
                        let marker = marker_present(&c);
                        let matches_expected = if marker {
                            match (expected_line, marker_inner_line(&c)) {
                                (Some(expected), Some(inner)) => Some(inner == expected),
                                _ => None,
                            }
                        } else {
                            None
                        };
                        ShellIntegrationShellStatus {
                            shell_kind: kind.to_string(),
                            profile_path: Some(ps),
                            profile_resolved: true,
                            marker_present: marker,
                            health: classify_shell_health(None, marker, matches_expected).to_string(),
                            backup_count,
                            capabilities: shell_capabilities(kind),
                            profile_path_source: Some("auto".to_string()),
                            error: None,
                        }
                    }
                    Err(e) => ShellIntegrationShellStatus {
                        shell_kind: kind.to_string(),
                        profile_path: Some(ps),
                        profile_resolved: true,
                        marker_present: false,
                        health: "error".to_string(),
                        backup_count,
                        capabilities: shell_capabilities(kind),
                        profile_path_source: Some("auto".to_string()),
                        error: Some(e),
                    },
                }
            } else {
                ShellIntegrationShellStatus {
                    shell_kind: kind.to_string(),
                    profile_path: Some(ps),
                    profile_resolved: true,
                    marker_present: false,
                    health: "missing".to_string(),
                    backup_count,
                    capabilities: shell_capabilities(kind),
                    profile_path_source: Some("auto".to_string()),
                    error: None,
                }
            }
        }
    }
}

#[tauri::command]
#[tracing::instrument(skip(app))]
pub fn shell_integration_status(app: AppHandle) -> Result<ShellIntegrationStatus, String> {
    let dir = materialize_scripts_inner(&app)?;
    let profile = settings::get_profile(&app).unwrap_or_else(|_| TerminalProfile::default());

    let mut shells = Vec::new();

    let si = settings::load_settings(&app).map(|s| s.shell_integration).unwrap_or_default();
    let shell_hint = profile.shell.as_deref();
    let expected_pwsh_line = powershell_dot_source_line(&dir.join("mach-init.ps1")).ok();
    let expected_bash_line = Some(bash_source_line(&dir.join("mach-init.bash")));
    let expected_zsh_line = Some(zsh_source_line(&dir.join("mach-init.zsh")));

    if let Some(raw) = pwsh_trimmed_override(&si) {
        match validate_pwsh_profile_override(raw) {
            Ok(pb) => shells.push(pwsh_shell_status(&pb, "override", expected_pwsh_line.as_deref())),
            Err(e) => shells.push(ShellIntegrationShellStatus {
                shell_kind: "pwsh".to_string(),
                profile_path: Some(normalize_pwsh_display_path(raw)),
                profile_resolved: false,
                marker_present: false,
                health: "error".to_string(),
                backup_count: None,
                capabilities: shell_capabilities("pwsh"),
                profile_path_source: Some("override".to_string()),
                error: Some(e),
            }),
        }
    } else {
        match resolve_powershell_profile(shell_hint) {
            Ok(pb) => shells.push(pwsh_shell_status(&pb, "auto", expected_pwsh_line.as_deref())),
            Err(e) => shells.push(ShellIntegrationShellStatus {
                shell_kind: "pwsh".to_string(),
                profile_path: None,
                profile_resolved: false,
                marker_present: false,
                health: "error".to_string(),
                backup_count: None,
                capabilities: shell_capabilities("pwsh"),
                profile_path_source: None,
                error: Some(e),
            }),
        }
    }

    shells.push(unix_profile_shell_status(
        "bash",
        resolve_bash_profile(),
        expected_bash_line.as_deref(),
    ));
    shells.push(unix_profile_shell_status(
        "zsh",
        resolve_zsh_profile(),
        expected_zsh_line.as_deref(),
    ));

    Ok(ShellIntegrationStatus {
        script_version: MACH_SHELL_SCRIPT_VERSION,
        shell_dir: dir.to_string_lossy().to_string(),
        shells,
    })
}

#[tauri::command]
#[tracing::instrument(skip(app))]
pub fn shell_integration_backups_list(app: AppHandle, shell_kind: String) -> Result<ShellIntegrationBackupListResult, String> {
    let profile = settings::get_profile(&app).unwrap_or_else(|_| TerminalProfile::default());
    let normalized_kind = match shell_kind.as_str() {
        "powershell" => "pwsh",
        other => other,
    };
    let (profile_path, _) = resolve_shell_hook_target(&app, normalized_kind, profile.shell.as_deref())?;
    let entries = list_backup_candidates(&profile_path)?
        .into_iter()
        .map(|candidate| candidate.entry)
        .collect();
    Ok(ShellIntegrationBackupListResult {
        shell_kind: normalized_kind.to_string(),
        profile_path: profile_path.to_string_lossy().to_string(),
        entries,
    })
}

fn restore_profile_from_backup(profile_path: &Path, backup_path: &Path) -> Result<(), String> {
    let _lock = PROFILE_EDIT_LOCK.lock().map_err(|_| "profile edit lock poisoned".to_string())?;
    if !backup_path.exists() {
        return Err("selected backup no longer exists".to_string());
    }
    let parent = profile_path
        .parent()
        .ok_or_else(|| "profile path has no parent directory".to_string())?;
    fs::create_dir_all(parent).map_err(|e| format!("failed to create profile directory: {e}"))?;
    backup_profile_before_mutate(profile_path)?;
    let bytes = fs::read(backup_path).map_err(|e| map_profile_io_error("read backup profile", e))?;
    fs::write(profile_path, bytes).map_err(|e| map_profile_io_error("write profile", e))?;
    Ok(())
}

#[tauri::command]
#[tracing::instrument(skip(app))]
pub fn shell_integration_backup_restore(
    app: AppHandle,
    shell_kind: String,
    backup_id: String,
) -> Result<ShellIntegrationBackupRestoreResult, String> {
    let profile = settings::get_profile(&app).unwrap_or_else(|_| TerminalProfile::default());
    let normalized_kind = match shell_kind.as_str() {
        "powershell" => "pwsh",
        other => other,
    };
    let (profile_path, _) = resolve_shell_hook_target(&app, normalized_kind, profile.shell.as_deref())?;
    let candidates = list_backup_candidates(&profile_path)?;
    let selected = candidates
        .into_iter()
        .find(|candidate| candidate.entry.backup_id == backup_id)
        .ok_or_else(|| "backup id not found for current profile target".to_string())?;
    restore_profile_from_backup(&profile_path, &selected.path)?;
    Ok(ShellIntegrationBackupRestoreResult {
        shell_kind: normalized_kind.to_string(),
        profile_path: profile_path.to_string_lossy().to_string(),
        restored_backup_id: selected.entry.backup_id,
    })
}

fn powershell_dot_source_line(init_path: &Path) -> Result<String, String> {
    let s = init_path.to_string_lossy().replace('\'', "''");
    Ok(format!(". '{s}'"))
}

fn bash_source_line(init_path: &Path) -> String {
    let p = init_path.to_string_lossy();
    format!(". \"{p}\"")
}

fn zsh_source_line(init_path: &Path) -> String {
    bash_source_line(init_path)
}

fn install_into_profile(
    profile_path: &Path,
    inner_line: &str,
) -> Result<(), String> {
    let _lock = PROFILE_EDIT_LOCK.lock().map_err(|_| "profile edit lock poisoned".to_string())?;

    let parent = profile_path
        .parent()
        .ok_or_else(|| "profile path has no parent directory".to_string())?;
    fs::create_dir_all(parent).map_err(|e| format!("failed to create profile directory: {e}"))?;

    let existing = if profile_path.exists() {
        read_profile_capped(profile_path)?
    } else {
        String::new()
    };

    backup_profile_before_mutate(profile_path)?;

    let next = replace_mach_profile_block(&existing, Some(inner_line));
    fs::write(profile_path, next.as_bytes())
        .map_err(|e| map_profile_io_error("write profile", e))?;
    Ok(())
}

fn remove_from_profile(profile_path: &Path) -> Result<(), String> {
    let _lock = PROFILE_EDIT_LOCK.lock().map_err(|_| "profile edit lock poisoned".to_string())?;
    if !profile_path.exists() {
        return Ok(());
    }
    backup_profile_before_mutate(profile_path)?;
    let existing = read_profile_capped(profile_path)?;
    let next = replace_mach_profile_block(&existing, None);
    fs::write(profile_path, next.as_bytes())
        .map_err(|e| map_profile_io_error("write profile", e))?;
    Ok(())
}

#[tauri::command]
#[tracing::instrument(skip(app))]
pub fn shell_integration_install(app: AppHandle, shell_kind: String) -> Result<(), String> {
    let dir = materialize_scripts_inner(&app)?;
    let profile = settings::get_profile(&app).unwrap_or_else(|_| TerminalProfile::default());

    match shell_kind.as_str() {
        "pwsh" | "powershell" => {
            let (profile_path, _) = resolve_shell_hook_target(&app, "pwsh", profile.shell.as_deref())?;
            let init = dir.join("mach-init.ps1");
            if !init.exists() {
                return Err("mach-init.ps1 was not materialized".to_string());
            }
            let line = powershell_dot_source_line(&init)?;
            install_into_profile(&profile_path, &line)
        }
        "bash" => {
            let (profile_path, _) = resolve_shell_hook_target(&app, "bash", profile.shell.as_deref())?;
            let init = dir.join("mach-init.bash");
            if !init.exists() {
                return Err("mach-init.bash was not materialized".to_string());
            }
            let line = bash_source_line(&init);
            install_into_profile(&profile_path, &line)
        }
        "zsh" => {
            let (profile_path, _) = resolve_shell_hook_target(&app, "zsh", profile.shell.as_deref())?;
            let init = dir.join("mach-init.zsh");
            if !init.exists() {
                return Err("mach-init.zsh was not materialized".to_string());
            }
            let line = zsh_source_line(&init);
            install_into_profile(&profile_path, &line)
        }
        _ => Err(format!("unknown shell_kind: {shell_kind}")),
    }
}

#[tauri::command]
#[tracing::instrument(skip(app))]
pub fn shell_integration_remove(app: AppHandle, shell_kind: String) -> Result<(), String> {
    let profile = settings::get_profile(&app).unwrap_or_else(|_| TerminalProfile::default());

    match shell_kind.as_str() {
        "pwsh" | "powershell" => {
            let (profile_path, _) = resolve_shell_hook_target(&app, "pwsh", profile.shell.as_deref())?;
            remove_from_profile(&profile_path)
        }
        "bash" => {
            let (profile_path, _) = resolve_shell_hook_target(&app, "bash", profile.shell.as_deref())?;
            remove_from_profile(&profile_path)
        }
        "zsh" => {
            let (profile_path, _) = resolve_shell_hook_target(&app, "zsh", profile.shell.as_deref())?;
            remove_from_profile(&profile_path)
        }
        _ => Err(format!("unknown shell_kind: {shell_kind}")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::tempdir;

    #[test]
    fn inject_once_appends_block() {
        let before = "# x\n";
        let inner = ". '/tmp/mach-init.ps1'";
        let after = replace_mach_profile_block(before, Some(inner));
        assert!(after.contains(MARKER_BEGIN));
        assert!(after.contains(inner));
        assert!(after.contains(MARKER_END));
    }

    #[test]
    fn reinstall_replaces_block() {
        let inner1 = ". '/a.ps1'";
        let inner2 = ". '/b.ps1'";
        let once = replace_mach_profile_block("", Some(inner1));
        let twice = replace_mach_profile_block(&once, Some(inner2));
        assert_eq!(twice.matches(MARKER_BEGIN).count(), 1);
        assert!(twice.contains(inner2));
        assert!(!twice.contains(inner1));
    }

    #[test]
    fn remove_strips_markers() {
        let inner = ". '/x.ps1'";
        let with_block = replace_mach_profile_block("keep\n", Some(inner));
        let removed = replace_mach_profile_block(&with_block, None);
        assert!(!removed.contains(MARKER_BEGIN));
        assert!(removed.contains("keep"));
    }

    #[test]
    fn strip_balanced() {
        let orig = "start\n# BEGIN MACH TERMINAL SHELL HOOK\n.\n# END MACH TERMINAL SHELL HOOK\nend\n";
        let stripped = strip_profile_block_simple(orig);
        assert!(!stripped.contains(MARKER_BEGIN));
        assert!(stripped.contains("start"));
        assert!(stripped.contains("end"));
    }

    #[test]
    fn validate_pwsh_profile_override_rejects_non_ps1() {
        assert!(validate_pwsh_profile_override("C:\\a\\b.txt").is_err());
    }

    #[test]
    fn validate_pwsh_profile_override_accepts_ps1() {
        let p = validate_pwsh_profile_override("C:\\Users\\x\\profile.ps1");
        assert!(p.is_ok());
    }

    #[test]
    fn marker_inner_line_extracts_hook_line() {
        let profile = format!(
            "x\n{MARKER_BEGIN}\n. '/tmp/mach-init.ps1'\n{MARKER_END}\n"
        );
        let inner = marker_inner_line(&profile).expect("marker inner line");
        assert_eq!(inner, ". '/tmp/mach-init.ps1'");
    }

    #[test]
    fn list_backup_candidates_filters_invalid_names() {
        let temp = tempdir().expect("tempdir");
        let profile = temp.path().join("Microsoft.PowerShell_profile.ps1");
        let backup_dir = profile
            .parent()
            .expect("profile parent")
            .join(".mach-terminal-shell-backups");
        fs::create_dir_all(&backup_dir).expect("create backup dir");
        fs::write(
            backup_dir.join("Microsoft.PowerShell_profile.ps1.1000.mach.bak"),
            "a",
        )
        .expect("write valid backup");
        fs::write(
            backup_dir.join("Microsoft.PowerShell_profile.ps1.bad.mach.bak"),
            "a",
        )
        .expect("write invalid backup");
        fs::write(backup_dir.join("other.1001.mach.bak"), "a").expect("write foreign backup");
        let entries = list_backup_candidates(&profile).expect("list backups");
        assert_eq!(entries.len(), 1);
        assert_eq!(
            entries[0].entry.file_name,
            "Microsoft.PowerShell_profile.ps1.1000.mach.bak"
        );
    }

    #[test]
    fn restore_profile_from_backup_rewrites_profile_content() {
        let temp = tempdir().expect("tempdir");
        let profile = temp.path().join("Microsoft.PowerShell_profile.ps1");
        let backup_dir = profile
            .parent()
            .expect("profile parent")
            .join(".mach-terminal-shell-backups");
        fs::create_dir_all(&backup_dir).expect("create backup dir");
        fs::write(&profile, "current").expect("write current profile");
        let backup = backup_dir.join("Microsoft.PowerShell_profile.ps1.2000.mach.bak");
        fs::write(&backup, "restored").expect("write backup profile");

        restore_profile_from_backup(&profile, &backup).expect("restore backup");
        let restored = fs::read_to_string(&profile).expect("read restored profile");
        assert_eq!(restored, "restored");
    }

    #[test]
    fn classify_shell_health_marks_stale_when_marker_mismatch() {
        let stale = classify_shell_health(None, true, Some(false));
        let healthy = classify_shell_health(None, true, Some(true));
        let missing = classify_shell_health(None, false, None);
        assert_eq!(stale, "stale");
        assert_eq!(healthy, "healthy");
        assert_eq!(missing, "missing");
    }

    #[test]
    fn shell_capabilities_match_expected_shells() {
        let pwsh = shell_capabilities("pwsh");
        let bash = shell_capabilities("bash");
        assert!(pwsh.supports_backup_restore);
        assert!(pwsh.supports_profile_override);
        assert!(bash.supports_backup_restore);
        assert!(!bash.supports_profile_override);
    }
}
