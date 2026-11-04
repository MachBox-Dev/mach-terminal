use serde::Serialize;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShellContextSnapshot {
    pub elevated: bool,
    pub git_branch: Option<String>,
    pub git_short_stat: Option<String>,
}

const PROBE_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(2);
const MAX_PROBE_OUTPUT: u64 = 8192;

#[tauri::command]
pub async fn shell_context_snapshot(
    cwd: Option<String>,
    include_git_diff: bool,
) -> Result<ShellContextSnapshot, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let branch = cwd.as_deref().and_then(git_branch_for_cwd);
        let stat = if include_git_diff && branch.is_some() {
            cwd.as_deref().and_then(git_short_stat_for_cwd)
        } else {
            None
        };
        ShellContextSnapshot {
            elevated: is_elevated(),
            git_branch: branch,
            git_short_stat: stat,
        }
    })
    .await
    .map_err(|error| format!("shell context worker failed: {error}"))
}

// Drain stdout concurrently so a full pipe cannot defeat the deadline. Limit the
// bytes retained, discard stderr, and never wait for an inherited pipe at shutdown.
fn bounded_output(
    cmd: std::process::Command,
    timeout: std::time::Duration,
) -> Option<std::process::Output> {
    bounded_command_output(cmd, timeout, MAX_PROBE_OUTPUT)
}

pub(crate) fn bounded_command_output(
    mut cmd: std::process::Command,
    timeout: std::time::Duration,
    output_limit: u64,
) -> Option<std::process::Output> {
    use std::io::Read;
    use std::process::Stdio;
    let deadline = std::time::Instant::now() + timeout;
    cmd.stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    let mut child = cmd.spawn().ok()?;
    let stdout = child.stdout.take()?;
    let (sender, receiver) = std::sync::mpsc::sync_channel(1);
    std::thread::spawn(move || {
        let mut bytes = Vec::new();
        let result = stdout.take(output_limit + 1).read_to_end(&mut bytes);
        let _ = sender.send(
            result
                .ok()
                .filter(|_| bytes.len() <= output_limit as usize)
                .map(|_| bytes),
        );
    });
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break status,
            Ok(None) if std::time::Instant::now() < deadline => {
                std::thread::sleep(std::time::Duration::from_millis(10))
            }
            _ => {
                let _ = child.kill();
                let _ = child.wait();
                return None;
            }
        }
    };
    let stdout = receiver
        .recv_timeout(deadline.saturating_duration_since(std::time::Instant::now()))
        .ok()??;
    Some(std::process::Output {
        status,
        stdout,
        stderr: Vec::new(),
    })
}

fn git_command(cwd: &str, args: &[&str]) -> Option<std::process::Output> {
    let mut cmd = std::process::Command::new("git");
    cmd.env("GIT_OPTIONAL_LOCKS", "0")
        .args(["--no-pager", "-c", "core.fsmonitor=false"])
        .arg("-C")
        .arg(cwd)
        .args(args);
    bounded_output(cmd, PROBE_TIMEOUT)
}

fn git_branch_for_cwd(cwd: &str) -> Option<String> {
    let output = git_command(cwd, &["rev-parse", "--abbrev-ref", "HEAD"])?;
    if !output.status.success() {
        return None;
    }
    let s = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if s.is_empty() || s == "HEAD" {
        return None;
    }
    Some(s)
}

fn git_short_stat_for_cwd(cwd: &str) -> Option<String> {
    let output = git_command(
        cwd,
        &[
            "diff",
            "--no-ext-diff",
            "--no-textconv",
            "HEAD",
            "--shortstat",
        ],
    )?;
    if !output.status.success() {
        return None;
    }
    let raw = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if raw.is_empty() {
        return Some("clean".to_string());
    }
    Some(compact_git_shortstat(&raw))
}

/// Turns `3 files changed, 10 insertions(+), 2 deletions(-)` into `3 · +10 −2`.
fn compact_git_shortstat(raw: &str) -> String {
    let mut files = None::<u32>;
    let mut ins = None::<u32>;
    let mut del = None::<u32>;
    for part in raw.split(',') {
        let p = part.trim();
        if let Some(prefix) = p.strip_suffix("file changed") {
            files = prefix.trim().parse().ok();
        } else if let Some(prefix) = p.strip_suffix("files changed") {
            files = prefix.trim().parse().ok();
        } else if p.contains("insertion") {
            ins = p.split_whitespace().next().and_then(|s| s.parse().ok());
        } else if p.contains("deletion") {
            del = p.split_whitespace().next().and_then(|s| s.parse().ok());
        }
    }
    let mut out = String::new();
    if let Some(n) = files {
        out.push_str(&n.to_string());
    }
    if ins.is_some() || del.is_some() {
        if !out.is_empty() {
            out.push_str(" · ");
        }
        if let Some(n) = ins {
            out.push('+');
            out.push_str(&n.to_string());
        }
        if ins.is_some() && del.is_some() {
            out.push(' ');
        }
        if let Some(n) = del {
            out.push('\u{2212}');
            out.push_str(&n.to_string());
        }
    }
    if out.is_empty() {
        raw.to_string()
    } else {
        out
    }
}

fn is_elevated() -> bool {
    static ELEVATED: std::sync::OnceLock<bool> = std::sync::OnceLock::new();
    *ELEVATED.get_or_init(|| {
        #[cfg(windows)]
        {
            use windows::Win32::Foundation::{CloseHandle, HANDLE};
            use windows::Win32::Security::{
                GetTokenInformation, TokenElevation, TOKEN_ELEVATION, TOKEN_QUERY,
            };
            use windows::Win32::System::Threading::{GetCurrentProcess, OpenProcessToken};
            let mut token = HANDLE::default();
            // SAFETY: process pseudo-handle is valid; token and output buffers are
            // owned here, correctly sized, and the token is closed on every path.
            unsafe {
                if OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token).is_err() {
                    return false;
                }
                let mut elevation = TOKEN_ELEVATION::default();
                let mut returned = 0;
                let result = GetTokenInformation(
                    token,
                    TokenElevation,
                    Some((&mut elevation as *mut TOKEN_ELEVATION).cast()),
                    std::mem::size_of::<TOKEN_ELEVATION>() as u32,
                    &mut returned,
                );
                let _ = CloseHandle(token);
                result.is_ok() && elevation.TokenIsElevated != 0
            }
        }
        #[cfg(unix)]
        {
            let mut cmd = std::process::Command::new("id");
            cmd.arg("-u");
            bounded_output(cmd, PROBE_TIMEOUT)
                .filter(|o| o.status.success())
                .and_then(|o| String::from_utf8(o.stdout).ok())
                .map(|s| s.trim() == "0")
                .unwrap_or(false)
        }
        #[cfg(not(any(windows, unix)))]
        {
            false
        }
    })
}

#[cfg(test)]
mod tests {
    use super::compact_git_shortstat;

    #[test]
    fn probes_enforce_deadline_and_output_limit() {
        use std::process::Command;
        use std::time::{Duration, Instant};
        fn shell(script: &str) -> Command {
            let mut command = Command::new(if cfg!(windows) {
                "powershell.exe"
            } else {
                "sh"
            });
            if cfg!(windows) {
                command.args([
                    "-NoLogo",
                    "-NoProfile",
                    "-NonInteractive",
                    "-Command",
                    script,
                ]);
            } else {
                command.args(["-c", script]);
            }
            command
        }
        let start = Instant::now();
        let slow = shell(if cfg!(windows) {
            "Start-Sleep -Seconds 10"
        } else {
            "exec sleep 10"
        });
        assert!(super::bounded_output(slow, Duration::from_millis(150)).is_none());
        assert!(start.elapsed() < Duration::from_secs(3));
        let loud = shell(if cfg!(windows) {
            "[Console]::Write(('x' * 20000))"
        } else {
            "head -c 20000 /dev/zero"
        });
        assert!(super::bounded_output(loud, Duration::from_secs(3)).is_none());
        let small = shell(if cfg!(windows) {
            "[Console]::Write('ok')"
        } else {
            "printf ok"
        });
        assert_eq!(
            super::bounded_output(small, Duration::from_secs(3))
                .unwrap()
                .stdout,
            b"ok"
        );
    }

    #[test]
    fn shortstat_compact() {
        assert_eq!(
            compact_git_shortstat(" 3 files changed, 10 insertions(+), 2 deletions(-)"),
            "3 · +10 \u{2212}2"
        );
        assert_eq!(
            compact_git_shortstat(" 1 file changed, 3 insertions(+)"),
            "1 · +3"
        );
    }
}
