//! Materialize Mach-owned shell hooks under app local data and optionally inject a marker block into user profiles.

use serde::Serialize;
use std::fs;
use std::io::{ErrorKind, Read};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager, Runtime};

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

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum CanonicalShellKind {
    Pwsh,
    Bash,
    Zsh,
}

impl CanonicalShellKind {
    fn as_str(self) -> &'static str {
        match self {
            CanonicalShellKind::Pwsh => "pwsh",
            CanonicalShellKind::Bash => "bash",
            CanonicalShellKind::Zsh => "zsh",
        }
    }
}

#[derive(Debug, Clone, Copy)]
struct ShellStrategy {
    kind: CanonicalShellKind,
    init_script_name: &'static str,
    supports_backup_restore: bool,
    supports_profile_override: bool,
}

const PWSH_STRATEGY: ShellStrategy = ShellStrategy {
    kind: CanonicalShellKind::Pwsh,
    init_script_name: "mach-init.ps1",
    supports_backup_restore: true,
    supports_profile_override: true,
};

const BASH_STRATEGY: ShellStrategy = ShellStrategy {
    kind: CanonicalShellKind::Bash,
    init_script_name: "mach-init.bash",
    supports_backup_restore: true,
    supports_profile_override: false,
};

const ZSH_STRATEGY: ShellStrategy = ShellStrategy {
    kind: CanonicalShellKind::Zsh,
    init_script_name: "mach-init.zsh",
    supports_backup_restore: true,
    supports_profile_override: false,
};

fn normalize_shell_kind(shell_kind: &str) -> Result<CanonicalShellKind, String> {
    match shell_kind.trim() {
        "pwsh" | "powershell" => Ok(CanonicalShellKind::Pwsh),
        "bash" => Ok(CanonicalShellKind::Bash),
        "zsh" => Ok(CanonicalShellKind::Zsh),
        _ => Err(format!("unknown shell_kind: {shell_kind}")),
    }
}

fn shell_strategy(shell_kind: &str) -> Result<ShellStrategy, String> {
    match normalize_shell_kind(shell_kind)? {
        CanonicalShellKind::Pwsh => Ok(PWSH_STRATEGY),
        CanonicalShellKind::Bash => Ok(BASH_STRATEGY),
        CanonicalShellKind::Zsh => Ok(ZSH_STRATEGY),
    }
}

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

fn shell_dir<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    let base = app
        .path()
        .app_local_data_dir()
        .map_err(|e| format!("failed to resolve app local data dir: {e}"))?;
    Ok(base.join("shell"))
}

fn materialize_scripts_inner<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
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

fn resolve_unix_shell_profile(shell_kind: CanonicalShellKind) -> Option<PathBuf> {
    match shell_kind {
        CanonicalShellKind::Bash => resolve_bash_profile(),
        CanonicalShellKind::Zsh => resolve_zsh_profile(),
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
    strategy: ShellStrategy,
    shell_hint: Option<&str>,
) -> Result<(PathBuf, Option<&'static str>), String> {
    match strategy.kind {
        CanonicalShellKind::Pwsh => {
            let (path, source) = resolve_pwsh_hook_target(app, shell_hint)?;
            Ok((path, Some(source)))
        }
        CanonicalShellKind::Bash | CanonicalShellKind::Zsh => {
            let path = resolve_unix_shell_profile(strategy.kind)
                .ok_or_else(|| "could not resolve home directory".to_string())?;
            Ok((path, Some("auto")))
        }
    }
}

fn shell_capabilities_for_strategy(strategy: ShellStrategy) -> ShellIntegrationShellCapabilities {
    ShellIntegrationShellCapabilities {
        supports_backup_restore: strategy.supports_backup_restore,
        supports_profile_override: strategy.supports_profile_override,
    }
}

fn shell_capabilities(shell_kind: &str) -> ShellIntegrationShellCapabilities {
    shell_strategy(shell_kind)
        .map(shell_capabilities_for_strategy)
        .unwrap_or(ShellIntegrationShellCapabilities {
            supports_backup_restore: false,
            supports_profile_override: false,
        })
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

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct ShellMarkerHealth {
    marker_present: bool,
    matches_expected: Option<bool>,
    health: &'static str,
}

fn derive_shell_marker_health(content: &str, expected_line: Option<&str>) -> ShellMarkerHealth {
    let marker = marker_present(content);
    let matches_expected = if marker {
        match (expected_line, marker_inner_line(content)) {
            (Some(expected), Some(inner)) => Some(inner == expected),
            _ => None,
        }
    } else {
        None
    };
    ShellMarkerHealth {
        marker_present: marker,
        matches_expected,
        health: classify_shell_health(None, marker, matches_expected),
    }
}

fn build_shell_status_row(
    kind: &str,
    profile_path: Option<String>,
    profile_resolved: bool,
    marker_present: bool,
    health: &'static str,
    backup_count: Option<u32>,
    profile_path_source: Option<&str>,
    error: Option<String>,
) -> ShellIntegrationShellStatus {
    ShellIntegrationShellStatus {
        shell_kind: kind.to_string(),
        profile_path,
        profile_resolved,
        marker_present,
        health: health.to_string(),
        backup_count,
        capabilities: shell_capabilities(kind),
        profile_path_source: profile_path_source.map(str::to_string),
        error,
    }
}

fn resolved_profile_shell_status(
    kind: &str,
    profile_path: &Path,
    profile_path_source: Option<&str>,
    expected_line: Option<&str>,
) -> ShellIntegrationShellStatus {
    let path = profile_path.to_string_lossy().to_string();
    let backup_count = Some(count_backups_for_profile(profile_path));
    if profile_path.exists() {
        match read_profile_capped(profile_path) {
            Ok(content) => {
                let derived = derive_shell_marker_health(&content, expected_line);
                build_shell_status_row(
                    kind,
                    Some(path),
                    true,
                    derived.marker_present,
                    derived.health,
                    backup_count,
                    profile_path_source,
                    None,
                )
            }
            Err(error) => {
                let health = classify_shell_health(Some(error.as_str()), false, None);
                build_shell_status_row(
                    kind,
                    Some(path),
                    true,
                    false,
                    health,
                    backup_count,
                    profile_path_source,
                    Some(error),
                )
            }
        }
    } else {
        build_shell_status_row(
            kind,
            Some(path),
            true,
            false,
            classify_shell_health(None, false, None),
            backup_count,
            profile_path_source,
            None,
        )
    }
}

fn unresolved_profile_shell_status(
    kind: &str,
    profile_path: Option<String>,
    profile_path_source: Option<&str>,
    error: String,
) -> ShellIntegrationShellStatus {
    let health = classify_shell_health(Some(error.as_str()), false, None);
    build_shell_status_row(
        kind,
        profile_path,
        false,
        false,
        health,
        None,
        profile_path_source,
        Some(error),
    )
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
    resolved_profile_shell_status("pwsh", pb, Some(source), expected_line)
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
        None => unresolved_profile_shell_status(kind, None, None, "could not resolve home directory".to_string()),
        Some(path) => resolved_profile_shell_status(kind, &path, Some("auto"), expected_line),
    }
}

#[tauri::command]
#[tracing::instrument(skip(app))]
pub fn shell_integration_status<R: Runtime>(app: AppHandle<R>) -> Result<ShellIntegrationStatus, String> {
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
            Err(e) => shells.push(unresolved_profile_shell_status(
                "pwsh",
                Some(normalize_pwsh_display_path(raw)),
                Some("override"),
                e,
            )),
        }
    } else {
        match resolve_powershell_profile(shell_hint) {
            Ok(pb) => shells.push(pwsh_shell_status(&pb, "auto", expected_pwsh_line.as_deref())),
            Err(e) => shells.push(unresolved_profile_shell_status("pwsh", None, None, e)),
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
    let strategy = shell_strategy(&shell_kind)?;
    let (profile_path, _) = resolve_shell_hook_target(&app, strategy, profile.shell.as_deref())?;
    let entries = list_backup_candidates(&profile_path)?
        .into_iter()
        .map(|candidate| candidate.entry)
        .collect();
    Ok(ShellIntegrationBackupListResult {
        shell_kind: strategy.kind.as_str().to_string(),
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
    let strategy = shell_strategy(&shell_kind)?;
    let (profile_path, _) = resolve_shell_hook_target(&app, strategy, profile.shell.as_deref())?;
    let candidates = list_backup_candidates(&profile_path)?;
    let selected = candidates
        .into_iter()
        .find(|candidate| candidate.entry.backup_id == backup_id)
        .ok_or_else(|| "backup id not found for current profile target".to_string())?;
    restore_profile_from_backup(&profile_path, &selected.path)?;
    Ok(ShellIntegrationBackupRestoreResult {
        shell_kind: strategy.kind.as_str().to_string(),
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
    let strategy = shell_strategy(&shell_kind)?;
    let (profile_path, _) = resolve_shell_hook_target(&app, strategy, profile.shell.as_deref())?;
    let init = dir.join(strategy.init_script_name);
    if !init.exists() {
        return Err(format!("{} was not materialized", strategy.init_script_name));
    }
    let line = match strategy.kind {
        CanonicalShellKind::Pwsh => powershell_dot_source_line(&init)?,
        CanonicalShellKind::Bash => bash_source_line(&init),
        CanonicalShellKind::Zsh => zsh_source_line(&init),
    };
    install_into_profile(&profile_path, &line)
}

#[tauri::command]
#[tracing::instrument(skip(app))]
pub fn shell_integration_remove(app: AppHandle, shell_kind: String) -> Result<(), String> {
    let profile = settings::get_profile(&app).unwrap_or_else(|_| TerminalProfile::default());
    let strategy = shell_strategy(&shell_kind)?;
    let (profile_path, _) = resolve_shell_hook_target(&app, strategy, profile.shell.as_deref())?;
    remove_from_profile(&profile_path)
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
    fn derive_shell_marker_health_tracks_expected_line_match() {
        let expected = ". '/tmp/mach-init.ps1'";
        let matching = format!("x\n{MARKER_BEGIN}\n{expected}\n{MARKER_END}\n");
        let mismatch = format!("x\n{MARKER_BEGIN}\n. '/tmp/other.ps1'\n{MARKER_END}\n");

        let healthy = derive_shell_marker_health(&matching, Some(expected));
        assert!(healthy.marker_present);
        assert_eq!(healthy.matches_expected, Some(true));
        assert_eq!(healthy.health, "healthy");

        let stale = derive_shell_marker_health(&mismatch, Some(expected));
        assert!(stale.marker_present);
        assert_eq!(stale.matches_expected, Some(false));
        assert_eq!(stale.health, "stale");
    }

    #[test]
    fn pwsh_resolved_status_row_preserves_override_source_and_health() {
        let temp = tempdir().expect("tempdir");
        let profile = temp.path().join("Microsoft.PowerShell_profile.ps1");
        let expected = ". '/tmp/mach-init.ps1'";
        let profile_content = format!("prelude\n{MARKER_BEGIN}\n{expected}\n{MARKER_END}\n");
        fs::write(&profile, profile_content).expect("write profile");

        let healthy = resolved_profile_shell_status("pwsh", &profile, Some("override"), Some(expected));
        assert_eq!(healthy.shell_kind, "pwsh");
        assert!(healthy.profile_resolved);
        assert!(healthy.marker_present);
        assert_eq!(healthy.health, "healthy");
        assert_eq!(healthy.profile_path_source.as_deref(), Some("override"));
        assert_eq!(healthy.backup_count, Some(0));
        assert_eq!(healthy.error, None);

        let stale = resolved_profile_shell_status("pwsh", &profile, Some("override"), Some(". '/tmp/other.ps1'"));
        assert_eq!(stale.health, "stale");
        assert_eq!(stale.profile_path_source.as_deref(), Some("override"));
    }

    #[test]
    fn unix_status_rows_preserve_auto_and_unresolved_source_semantics() {
        let temp = tempdir().expect("tempdir");
        let bash_profile = temp.path().join(".bashrc");
        let expected = ". \"/tmp/mach-init.bash\"";
        let profile_content = format!("p\n{MARKER_BEGIN}\n{expected}\n{MARKER_END}\n");
        fs::write(&bash_profile, profile_content).expect("write bash profile");

        let bash = unix_profile_shell_status("bash", Some(bash_profile.clone()), Some(expected));
        assert_eq!(bash.shell_kind, "bash");
        assert!(bash.profile_resolved);
        assert!(bash.marker_present);
        assert_eq!(bash.health, "healthy");
        assert_eq!(bash.profile_path_source.as_deref(), Some("auto"));
        assert_eq!(bash.error, None);

        let zsh = resolved_profile_shell_status("zsh", &bash_profile, Some("auto"), Some(expected));
        assert_eq!(zsh.shell_kind, "zsh");
        assert_eq!(zsh.health, "healthy");
        assert_eq!(zsh.profile_path_source.as_deref(), Some("auto"));

        let unresolved = unix_profile_shell_status("bash", None, Some(expected));
        assert_eq!(unresolved.shell_kind, "bash");
        assert!(!unresolved.profile_resolved);
        assert_eq!(unresolved.health, "error");
        assert_eq!(unresolved.profile_path_source, None);
        assert!(unresolved.error.is_some());
    }

    #[test]
    fn unresolved_pwsh_override_status_keeps_override_source() {
        let status = unresolved_profile_shell_status(
            "pwsh",
            Some("C:\\Users\\mike\\Documents\\profile.ps1".to_string()),
            Some("override"),
            "invalid profile path".to_string(),
        );
        assert_eq!(status.shell_kind, "pwsh");
        assert!(!status.profile_resolved);
        assert_eq!(status.health, "error");
        assert_eq!(status.profile_path_source.as_deref(), Some("override"));
        assert_eq!(status.backup_count, None);
        assert_eq!(status.marker_present, false);
        assert!(status.error.as_deref().unwrap_or_default().contains("invalid profile path"));
    }

    #[test]
    fn shell_status_serialization_preserves_wire_shape_null_semantics() {
        let status = unresolved_profile_shell_status("pwsh", None, None, "resolver failed".to_string());
        let value = serde_json::to_value(&status).expect("serialize shell status row");
        assert_eq!(value.get("shellKind").and_then(|v| v.as_str()), Some("pwsh"));
        assert_eq!(value.get("profileResolved").and_then(|v| v.as_bool()), Some(false));
        assert_eq!(value.get("health").and_then(|v| v.as_str()), Some("error"));
        assert!(value.get("profilePath").is_some_and(|v| v.is_null()));
        assert!(value.get("backupCount").is_some_and(|v| v.is_null()));
        assert!(value.get("profilePathSource").is_some_and(|v| v.is_null()));
        assert_eq!(value.get("error").and_then(|v| v.as_str()), Some("resolver failed"));
    }

    #[test]
    fn shell_integration_status_serialization_preserves_top_level_and_cross_shell_contract() {
        let status = ShellIntegrationStatus {
            script_version: MACH_SHELL_SCRIPT_VERSION,
            shell_dir: "/tmp/mach-shell".to_string(),
            shells: vec![
                build_shell_status_row(
                    "pwsh",
                    Some("C:\\Users\\mike\\profile.ps1".to_string()),
                    true,
                    true,
                    "healthy",
                    Some(1),
                    Some("override"),
                    None,
                ),
                unresolved_profile_shell_status(
                    "bash",
                    Some("/home/mike/.bashrc".to_string()),
                    Some("auto"),
                    "resolver failed".to_string(),
                ),
                build_shell_status_row(
                    "zsh",
                    Some("/home/mike/.zshrc".to_string()),
                    true,
                    false,
                    "missing",
                    Some(0),
                    Some("auto"),
                    None,
                ),
            ],
        };
        let value = serde_json::to_value(&status).expect("serialize shell integration status");
        assert_eq!(
            value.get("scriptVersion").and_then(|field| field.as_u64()),
            Some(MACH_SHELL_SCRIPT_VERSION as u64)
        );
        assert_eq!(
            value.get("shellDir").and_then(|field| field.as_str()),
            Some("/tmp/mach-shell")
        );
        let rows = value
            .get("shells")
            .and_then(|field| field.as_array())
            .expect("shell rows");
        let kinds: Vec<&str> = rows
            .iter()
            .map(|row| row.get("shellKind").and_then(|field| field.as_str()).expect("shell kind"))
            .collect();
        assert_eq!(kinds, vec!["pwsh", "bash", "zsh"]);
        assert_eq!(
            rows[0]
                .get("capabilities")
                .and_then(|field| field.get("supportsBackupRestore"))
                .and_then(|field| field.as_bool()),
            Some(true)
        );
        assert_eq!(
            rows[0]
                .get("capabilities")
                .and_then(|field| field.get("supportsProfileOverride"))
                .and_then(|field| field.as_bool()),
            Some(true)
        );
        assert_eq!(
            rows[1]
                .get("capabilities")
                .and_then(|field| field.get("supportsProfileOverride"))
                .and_then(|field| field.as_bool()),
            Some(false)
        );
        assert_eq!(
            rows[2]
                .get("profilePathSource")
                .and_then(|field| field.as_str()),
            Some("auto")
        );
        assert!(matches!(
            rows[1].get("health").and_then(|field| field.as_str()),
            Some("healthy" | "stale" | "missing" | "error")
        ));
    }

    #[test]
    fn shell_status_canonical_rows_preserve_capabilities_and_allowed_health_values() {
        let pwsh = build_shell_status_row(
            "pwsh",
            Some("C:\\Users\\mike\\profile.ps1".to_string()),
            true,
            true,
            "healthy",
            Some(2),
            Some("override"),
            None,
        );
        let bash = build_shell_status_row(
            "bash",
            Some("/home/mike/.bashrc".to_string()),
            true,
            false,
            "missing",
            Some(0),
            Some("auto"),
            None,
        );
        let zsh = build_shell_status_row(
            "zsh",
            Some("/home/mike/.zshrc".to_string()),
            true,
            true,
            "stale",
            Some(1),
            Some("auto"),
            None,
        );
        let rows = [pwsh, bash, zsh];
        let kinds: Vec<&str> = rows.iter().map(|row| row.shell_kind.as_str()).collect();
        assert_eq!(kinds, vec!["pwsh", "bash", "zsh"]);
        assert!(rows[0].capabilities.supports_backup_restore);
        assert!(rows[0].capabilities.supports_profile_override);
        assert!(rows[1].capabilities.supports_backup_restore);
        assert!(!rows[1].capabilities.supports_profile_override);
        assert!(rows[2].capabilities.supports_backup_restore);
        assert!(!rows[2].capabilities.supports_profile_override);
        for row in rows {
            assert!(matches!(row.health.as_str(), "healthy" | "stale" | "missing" | "error"));
        }
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

    #[test]
    fn normalize_shell_kind_maps_aliases_and_rejects_unknown() {
        assert_eq!(normalize_shell_kind("pwsh").expect("pwsh"), CanonicalShellKind::Pwsh);
        assert_eq!(
            normalize_shell_kind("powershell").expect("powershell"),
            CanonicalShellKind::Pwsh
        );
        assert_eq!(normalize_shell_kind("bash").expect("bash"), CanonicalShellKind::Bash);
        assert_eq!(normalize_shell_kind("zsh").expect("zsh"), CanonicalShellKind::Zsh);
        assert!(normalize_shell_kind("fish").is_err());
    }

    #[test]
    fn shell_strategy_is_complete_for_supported_shells() {
        let pwsh = shell_strategy("pwsh").expect("pwsh strategy");
        let bash = shell_strategy("bash").expect("bash strategy");
        let zsh = shell_strategy("zsh").expect("zsh strategy");

        assert_eq!(pwsh.init_script_name, "mach-init.ps1");
        assert!(pwsh.supports_backup_restore);
        assert!(pwsh.supports_profile_override);

        assert_eq!(bash.init_script_name, "mach-init.bash");
        assert!(bash.supports_backup_restore);
        assert!(!bash.supports_profile_override);

        assert_eq!(zsh.init_script_name, "mach-init.zsh");
        assert!(zsh.supports_backup_restore);
        assert!(!zsh.supports_profile_override);
    }

    #[test]
    fn powershell_alias_strategy_matches_pwsh() {
        let pwsh = shell_strategy("pwsh").expect("pwsh");
        let alias = shell_strategy("powershell").expect("powershell alias");
        assert_eq!(pwsh.kind, alias.kind);
        assert_eq!(pwsh.init_script_name, alias.init_script_name);
        assert_eq!(pwsh.supports_backup_restore, alias.supports_backup_restore);
        assert_eq!(pwsh.supports_profile_override, alias.supports_profile_override);
    }
}
