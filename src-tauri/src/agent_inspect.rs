pub use crate::models::SessionProcessInspection;

pub fn is_known_agent_exe(exe_or_cmd: &str) -> bool {
    let first_token = exe_or_cmd
        .split_whitespace()
        .next()
        .unwrap_or("")
        .trim_matches(|c| c == '"' || c == '\'');
    let base = first_token
        .rsplit(['/', '\\'])
        .next()
        .unwrap_or(first_token)
        .to_ascii_lowercase();
    let stem = base
        .strip_suffix(".exe")
        .or_else(|| base.strip_suffix(".cmd"))
        .or_else(|| base.strip_suffix(".bat"))
        .unwrap_or(&base);
    matches!(
        stem,
        "agy"
            | "antigravity"
            | "claude"
            | "claude-code"
            | "codex"
            | "gemini"
            | "aider"
            | "opencode"
            | "cursor-agent"
            | "goose"
            | "amp"
            | "copilot"
    )
}

/// Probe descendant processes of `shell_pid` to detect any active CLI coding agent
/// (`agy`, `claude`, `codex`, `gemini`, `aider`, `opencode`, `cursor-agent`, `goose`, `amp`, `copilot`).
///
/// On Windows, uses the in-process Win32 Toolhelp32 API (`CreateToolhelp32Snapshot`) so no
/// external console subprocess (`powershell` / `wmic`) is ever spawned.
/// Returns `Some(exe_name)` only when a known coding agent binary is a live descendant of `shell_pid`.
pub fn probe_child_command_line(shell_pid: u32) -> Option<String> {
    #[cfg(target_os = "windows")]
    {
        use std::collections::{HashMap, HashSet, VecDeque};
        use windows::Win32::Foundation::CloseHandle;
        use windows::Win32::System::Diagnostics::ToolHelp::{
            CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W,
            TH32CS_SNAPPROCESS,
        };

        unsafe {
            let snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0).ok()?;
            let mut entry = PROCESSENTRY32W {
                dwSize: std::mem::size_of::<PROCESSENTRY32W>() as u32,
                ..Default::default()
            };

            let mut children_by_parent: HashMap<u32, Vec<(u32, String)>> = HashMap::new();
            if Process32FirstW(snapshot, &mut entry).is_ok() {
                loop {
                    let pid = entry.th32ProcessID;
                    let ppid = entry.th32ParentProcessID;
                    if pid != 0 && pid != ppid {
                        let nul_pos = entry
                            .szExeFile
                            .iter()
                            .position(|&c| c == 0)
                            .unwrap_or(entry.szExeFile.len());
                        let exe_name = String::from_utf16_lossy(&entry.szExeFile[..nul_pos])
                            .trim()
                            .to_string();
                        if !exe_name.is_empty() {
                            children_by_parent
                                .entry(ppid)
                                .or_default()
                                .push((pid, exe_name));
                        }
                    }
                    if Process32NextW(snapshot, &mut entry).is_err() {
                        break;
                    }
                }
            }
            let _ = CloseHandle(snapshot);

            let mut queue = VecDeque::new();
            let mut visited = HashSet::new();
            queue.push_back(shell_pid);
            visited.insert(shell_pid);

            while let Some(parent_pid) = queue.pop_front() {
                if let Some(children) = children_by_parent.get(&parent_pid) {
                    for (child_pid, exe_name) in children {
                        if visited.insert(*child_pid) {
                            queue.push_back(*child_pid);
                        }
                        if is_known_agent_exe(exe_name) {
                            return Some(exe_name.clone());
                        }
                    }
                }
            }
            None
        }
    }
    #[cfg(not(target_os = "windows"))]
    {
        let output = std::process::Command::new("pgrep")
            .args(["-P", &shell_pid.to_string(), "-a"])
            .output()
            .ok()?;
        if !output.status.success() {
            return None;
        }
        let text = String::from_utf8_lossy(&output.stdout);
        for line in text.lines().map(str::trim).filter(|l| !l.is_empty()).rev() {
            let cmd = line
                .split_once(char::is_whitespace)
                .map(|(_, rest)| rest.trim())
                .unwrap_or(line);
            if !cmd.is_empty() && is_known_agent_exe(cmd) {
                return Some(cmd.to_string());
            }
        }
        None
    }
}

#[cfg(test)]
mod tests {
    use super::is_known_agent_exe;

    #[test]
    fn recognizes_known_coding_agent_executables_and_rejects_shells() {
        assert!(is_known_agent_exe("agy.exe"));
        assert!(is_known_agent_exe("C:\\Users\\user\\bin\\antigravity.exe"));
        assert!(is_known_agent_exe("/usr/local/bin/claude --resume"));
        assert!(is_known_agent_exe("codex"));
        assert!(is_known_agent_exe("gemini.cmd"));
        assert!(!is_known_agent_exe("pwsh.exe"));
        assert!(!is_known_agent_exe("/bin/zsh"));
        assert!(!is_known_agent_exe("git status"));
    }
}
