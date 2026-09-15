//! Shell discovery for the terminal-profile picker.
//!
//! Goal: let users pick from shells that actually exist on their machine instead
//! of typing an executable name and hoping it's on `PATH`. This is platform-aware
//! but deliberately platform-neutral in spirit — Windows gets WSL distro
//! enumeration as a first-class citizen, while macOS/Linux get `$SHELL` plus the
//! login shells listed in `/etc/shells`. Probing is best-effort: anything that
//! fails to detect is omitted (or, for well-known native shells, returned with
//! `available: false` so the UI can explain why it's disabled).
//!
//! Detection never spawns the shell itself; the only subprocess we run is
//! `wsl.exe -l -q` to list distros, and its (UTF-16LE) output is parsed by a pure,
//! unit-tested helper.

use crate::models::ShellCandidate;
use std::path::{Path, PathBuf};

/// Probe the host for shells the user can reasonably select. The first entry with
/// `is_default == true` is the recommended pick for this platform.
pub fn detect_shells() -> Vec<ShellCandidate> {
    #[cfg(target_os = "windows")]
    {
        detect_windows_shells()
    }
    #[cfg(not(target_os = "windows"))]
    {
        detect_unix_shells()
    }
}

/// Resolve an executable on `PATH` (honoring `PATHEXT` on Windows). Returns the
/// first match. Used both for detection and for the spawn-time default fallback.
pub fn find_on_path(exe: &str) -> Option<PathBuf> {
    // An absolute/relative path with separators is checked directly.
    let raw = Path::new(exe);
    if raw.components().count() > 1 || raw.is_absolute() {
        return if raw.is_file() { Some(raw.to_path_buf()) } else { None };
    }

    let path_var = std::env::var_os("PATH")?;
    let exts: Vec<String> = if cfg!(target_os = "windows") {
        let pathext = std::env::var("PATHEXT").unwrap_or_else(|_| ".EXE;.CMD;.BAT;.COM".to_string());
        // An exe that already carries an extension should be tried as-is too.
        let mut list = vec![String::new()];
        list.extend(pathext.split(';').filter(|segment| !segment.is_empty()).map(|segment| segment.to_string()));
        list
    } else {
        vec![String::new()]
    };

    for dir in std::env::split_paths(&path_var) {
        for ext in &exts {
            let candidate = dir.join(format!("{exe}{ext}"));
            if candidate.is_file() {
                return Some(candidate);
            }
        }
    }
    None
}

// ---------------------------------------------------------------------------
// Windows
// ---------------------------------------------------------------------------

#[cfg(target_os = "windows")]
fn detect_windows_shells() -> Vec<ShellCandidate> {
    let mut candidates: Vec<ShellCandidate> = Vec::new();

    let pwsh_available = find_on_path("pwsh.exe").is_some();

    // PowerShell 7 (pwsh) — the recommended default when present.
    candidates.push(ShellCandidate {
        id: "pwsh".to_string(),
        label: "PowerShell 7 (pwsh)".to_string(),
        shell: "pwsh.exe".to_string(),
        args: Vec::new(),
        kind: "native".to_string(),
        available: pwsh_available,
        is_default: pwsh_available,
    });

    // Windows PowerShell 5.1 — always present on supported Windows; the default
    // when pwsh is missing.
    let win_ps = windows_powershell_path();
    candidates.push(ShellCandidate {
        id: "windows-powershell".to_string(),
        label: "Windows PowerShell 5.1".to_string(),
        shell: win_ps
            .as_ref()
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_else(|| "powershell.exe".to_string()),
        args: Vec::new(),
        kind: "native".to_string(),
        available: win_ps.is_some(),
        is_default: !pwsh_available,
    });

    // Command Prompt.
    let cmd = system32_path("cmd.exe");
    candidates.push(ShellCandidate {
        id: "cmd".to_string(),
        label: "Command Prompt (cmd)".to_string(),
        shell: cmd
            .as_ref()
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_else(|| "cmd.exe".to_string()),
        args: Vec::new(),
        kind: "native".to_string(),
        available: cmd.is_some(),
        is_default: false,
    });

    // Git Bash, if Git for Windows is installed.
    if let Some(git_bash) = find_git_bash() {
        candidates.push(ShellCandidate {
            id: "git-bash".to_string(),
            label: "Git Bash".to_string(),
            shell: git_bash.to_string_lossy().to_string(),
            args: vec!["-i".to_string(), "-l".to_string()],
            kind: "native".to_string(),
            available: true,
            is_default: false,
        });
    }

    // WSL: a "default distro" entry plus one per installed distro.
    if let Some(wsl) = find_on_path("wsl.exe") {
        let wsl_str = wsl.to_string_lossy().to_string();
        candidates.push(ShellCandidate {
            id: "wsl".to_string(),
            label: "WSL (default distro)".to_string(),
            shell: wsl_str.clone(),
            args: Vec::new(),
            kind: "wsl".to_string(),
            available: true,
            is_default: false,
        });
        for distro in list_wsl_distros(&wsl_str) {
            candidates.push(ShellCandidate {
                id: format!("wsl:{distro}"),
                label: format!("{distro} (WSL)"),
                shell: wsl_str.clone(),
                args: vec!["-d".to_string(), distro],
                kind: "wsl".to_string(),
                available: true,
                is_default: false,
            });
        }
    }

    candidates
}

#[cfg(target_os = "windows")]
fn system_root() -> PathBuf {
    std::env::var_os("SystemRoot")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from(r"C:\Windows"))
}

#[cfg(target_os = "windows")]
fn system32_path(exe: &str) -> Option<PathBuf> {
    let candidate = system_root().join("System32").join(exe);
    candidate.is_file().then_some(candidate)
}

#[cfg(target_os = "windows")]
fn windows_powershell_path() -> Option<PathBuf> {
    let candidate = system_root()
        .join("System32")
        .join("WindowsPowerShell")
        .join("v1.0")
        .join("powershell.exe");
    candidate.is_file().then_some(candidate)
}

#[cfg(target_os = "windows")]
fn find_git_bash() -> Option<PathBuf> {
    let mut roots: Vec<PathBuf> = Vec::new();
    for var in ["ProgramFiles", "ProgramFiles(x86)", "ProgramW6432"] {
        if let Some(value) = std::env::var_os(var) {
            roots.push(PathBuf::from(value));
        }
    }
    if let Some(local) = std::env::var_os("LOCALAPPDATA") {
        roots.push(PathBuf::from(local).join("Programs"));
    }
    for root in roots {
        let candidate = root.join("Git").join("bin").join("bash.exe");
        if candidate.is_file() {
            return Some(candidate);
        }
    }
    None
}

#[cfg(target_os = "windows")]
fn list_wsl_distros(wsl_exe: &str) -> Vec<String> {
    use std::os::windows::process::CommandExt;
    use std::process::Command;
    use std::sync::mpsc;
    use std::time::Duration;

    /// Hide the probe console so Windows Terminal (default terminal app) does not steal focus.
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;

    const WSL_LIST_TIMEOUT: Duration = Duration::from_secs(2);
    let wsl_exe = wsl_exe.to_string();
    let (tx, rx) = mpsc::channel();
    std::thread::spawn(move || {
        let output = Command::new(&wsl_exe)
            .args(["-l", "-q"])
            .creation_flags(CREATE_NO_WINDOW)
            .output();
        let _ = tx.send(output);
    });
    match rx.recv_timeout(WSL_LIST_TIMEOUT) {
        Ok(Ok(output)) if output.status.success() => parse_wsl_distros(&output.stdout),
        _ => Vec::new(),
    }
}

/// Parse `wsl.exe -l -q` stdout. The stream is UTF-16LE (often with a BOM and
/// trailing NULs / CRs); decode leniently and drop blank lines. Pure for testing.
pub fn parse_wsl_distros(stdout: &[u8]) -> Vec<String> {
    let decoded = decode_utf16le_lossy(stdout);
    decoded
        .lines()
        .map(|line| line.trim().trim_matches('\0').trim())
        .filter(|line| !line.is_empty())
        .map(|line| line.to_string())
        .collect()
}

/// Decode a UTF-16LE byte stream (tolerating an odd trailing byte and a leading
/// BOM) into a `String`, replacing invalid sequences.
fn decode_utf16le_lossy(bytes: &[u8]) -> String {
    let start = if bytes.starts_with(&[0xFF, 0xFE]) { 2 } else { 0 };
    let units: Vec<u16> = bytes[start..]
        .chunks_exact(2)
        .map(|pair| u16::from_le_bytes([pair[0], pair[1]]))
        .collect();
    String::from_utf16_lossy(&units)
}

// ---------------------------------------------------------------------------
// Unix (macOS + Linux)
// ---------------------------------------------------------------------------

#[cfg(not(target_os = "windows"))]
fn detect_unix_shells() -> Vec<ShellCandidate> {
    let env_shell = std::env::var("SHELL").ok().filter(|value| !value.is_empty());
    let etc = std::fs::read_to_string("/etc/shells").unwrap_or_default();
    let paths = unix_shell_paths(env_shell.as_deref(), &etc);

    paths
        .iter()
        .map(|path| {
            let available = Path::new(path).is_file();
            let is_default = env_shell.as_deref() == Some(path.as_str());
            ShellCandidate {
                id: format!("posix:{path}"),
                label: shell_label_for_path(path),
                shell: path.clone(),
                args: Vec::new(),
                kind: "posix".to_string(),
                available,
                is_default,
            }
        })
        .collect()
}

/// Build the ordered, de-duplicated list of POSIX shell paths: `$SHELL` first (so
/// it becomes the default), then `/etc/shells` entries. Pure for testing.
pub fn unix_shell_paths(env_shell: Option<&str>, etc_shells: &str) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    let mut push_unique = |value: &str| {
        let value = value.trim();
        if !value.is_empty() && !out.iter().any(|existing| existing == value) {
            out.push(value.to_string());
        }
    };

    if let Some(shell) = env_shell {
        push_unique(shell);
    }
    for line in etc_shells.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        push_unique(line);
    }
    out
}

#[cfg(not(target_os = "windows"))]
fn shell_label_for_path(path: &str) -> String {
    Path::new(path)
        .file_name()
        .map(|name| name.to_string_lossy().to_string())
        .unwrap_or_else(|| path.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn utf16le(value: &str) -> Vec<u8> {
        let mut bytes = vec![0xFF, 0xFE];
        for unit in value.encode_utf16() {
            bytes.extend_from_slice(&unit.to_le_bytes());
        }
        bytes
    }

    #[test]
    fn parse_wsl_distros_decodes_utf16le_with_bom_and_trims() {
        let raw = utf16le("Ubuntu\r\nDebian\r\n\r\n");
        assert_eq!(parse_wsl_distros(&raw), vec!["Ubuntu".to_string(), "Debian".to_string()]);
    }

    #[test]
    fn parse_wsl_distros_handles_trailing_nul_padding() {
        let mut raw = utf16le("Alpine\n");
        raw.push(0x00); // stray odd byte should not panic
        assert_eq!(parse_wsl_distros(&raw), vec!["Alpine".to_string()]);
    }

    #[test]
    fn parse_wsl_distros_empty_is_empty() {
        assert!(parse_wsl_distros(&[]).is_empty());
        assert!(parse_wsl_distros(&utf16le("\r\n  \r\n")).is_empty());
    }

    #[test]
    fn unix_shell_paths_prefers_env_shell_then_etc_skipping_comments() {
        let etc = "# /etc/shells\n/bin/sh\n/bin/bash\n/bin/zsh\n";
        let paths = unix_shell_paths(Some("/bin/zsh"), etc);
        assert_eq!(
            paths,
            vec![
                "/bin/zsh".to_string(),
                "/bin/sh".to_string(),
                "/bin/bash".to_string(),
            ]
        );
    }

    #[test]
    fn unix_shell_paths_dedupes_and_ignores_blank_env() {
        let etc = "/bin/bash\n/bin/bash\n";
        let paths = unix_shell_paths(None, etc);
        assert_eq!(paths, vec!["/bin/bash".to_string()]);
    }
}
