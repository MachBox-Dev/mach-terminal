use serde::Serialize;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShellContextSnapshot {
    pub elevated: bool,
    pub git_branch: Option<String>,
    pub git_short_stat: Option<String>,
}

#[tauri::command]
pub fn shell_context_snapshot(
    cwd: Option<String>,
    include_git_diff: bool,
) -> Result<ShellContextSnapshot, String> {
    Ok(ShellContextSnapshot {
        elevated: is_elevated(),
        git_branch: cwd.as_deref().and_then(git_branch_for_cwd),
        git_short_stat: if include_git_diff {
            cwd.as_deref().and_then(git_short_stat_for_cwd)
        } else {
            None
        },
    })
}

fn git_branch_for_cwd(cwd: &str) -> Option<String> {
    let output = std::process::Command::new("git")
        .args(["-C", cwd, "rev-parse", "--abbrev-ref", "HEAD"])
        .output()
        .ok()?;
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
    if git_branch_for_cwd(cwd).is_none() {
        return None;
    }
    let output = std::process::Command::new("git")
        .args(["-C", cwd, "diff", "HEAD", "--shortstat"])
        .output()
        .ok()?;
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
    #[cfg(windows)]
    {
        let output = std::process::Command::new("powershell")
            .args([
                "-NoProfile",
                "-Command",
                "[bool](([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator))",
            ])
            .output();
        match output {
            Ok(o) if o.status.success() => {
                String::from_utf8_lossy(&o.stdout).trim().eq_ignore_ascii_case("true")
            }
            _ => false,
        }
    }
    #[cfg(unix)]
    {
        std::process::Command::new("id")
            .arg("-u")
            .output()
            .ok()
            .and_then(|o| String::from_utf8(o.stdout).ok())
            .map(|s| s.trim() == "0")
            .unwrap_or(false)
    }
    #[cfg(not(any(windows, unix)))]
    {
        false
    }
}

#[cfg(test)]
mod tests {
    use super::compact_git_shortstat;

    #[test]
    fn shortstat_compact() {
        assert_eq!(
            compact_git_shortstat(" 3 files changed, 10 insertions(+), 2 deletions(-)"),
            "3 · +10 \u{2212}2"
        );
        assert_eq!(compact_git_shortstat(" 1 file changed, 3 insertions(+)"), "1 · +3");
    }
}
