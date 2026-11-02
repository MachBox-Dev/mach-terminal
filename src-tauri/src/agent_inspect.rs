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

fn agent_script_identity(script: &str) -> Option<&'static str> {
    let path = script.replace('\\', "/").to_ascii_lowercase();
    let base = path.rsplit('/').next()?;
    let stem = base
        .strip_suffix(".exe")
        .or_else(|| base.strip_suffix(".cmd"))
        .or_else(|| base.strip_suffix(".js"))
        .or_else(|| base.strip_suffix(".mjs"))
        .or_else(|| base.strip_suffix(".py"))
        .unwrap_or(base);
    match stem {
        "agy" | "antigravity" => Some("agy"),
        "claude" | "claude-code" => Some("claude"),
        "codex" => Some("codex"),
        "gemini" => Some("gemini"),
        "aider" => Some("aider"),
        "opencode" => Some("opencode"),
        "cursor-agent" => Some("cursor-agent"),
        "goose" => Some("goose"),
        "amp" => Some("amp"),
        "copilot" => Some("copilot"),
        _ if path.ends_with("/@anthropic-ai/claude-code/cli.js") => Some("claude"),
        _ if path.ends_with("/@google/gemini-cli/dist/index.js") => Some("gemini"),
        _ if path.ends_with("/@openai/codex/bin/codex.js") => Some("codex"),
        _ => None,
    }
}

fn is_interpreter(exe: &str) -> bool {
    let normalized = exe.replace('\\', "/").to_ascii_lowercase();
    let base = normalized.rsplit('/').next().unwrap_or("");
    let stem = base.strip_suffix(".exe").unwrap_or(base);
    matches!(stem, "node" | "nodejs" | "bun" | "python" | "python3")
        || stem
            .strip_prefix("python3.")
            .is_some_and(|v| !v.is_empty() && v.chars().all(|c| c.is_ascii_digit()))
}

fn interpreter_agent_identity(args: &[String]) -> Option<&'static str> {
    if !is_interpreter(args.first()?) {
        return None;
    }
    let script = args.get(1)?;
    if script == "-m" {
        return match args.get(2)?.as_str() {
            "aider" | "aider.main" => Some("aider"),
            _ => None,
        };
    }
    if script.starts_with('-') {
        return None;
    }
    agent_script_identity(script)
}

// Preserve quoted command paths when the process snapshot includes them.
#[cfg(any(not(target_os = "windows"), test))]
fn command_tokens(command: &str) -> Vec<String> {
    let mut tokens = Vec::new();
    let mut token = String::new();
    let mut quote = None;
    for ch in command.chars() {
        if quote == Some(ch) {
            quote = None;
        } else if quote.is_none() && matches!(ch, '\'' | '"') {
            quote = Some(ch);
        } else if quote.is_none() && ch.is_whitespace() {
            if !token.is_empty() {
                tokens.push(std::mem::take(&mut token));
            }
        } else {
            token.push(ch);
        }
    }
    if !token.is_empty() {
        tokens.push(token);
    }
    tokens
}

#[cfg(windows)]
fn windows_interpreter_identity(pid: u32) -> Option<String> {
    use sysinfo::{Pid, ProcessRefreshKind, ProcessesToUpdate, System, UpdateKind};
    let mut system = System::new();
    let pid = Pid::from_u32(pid);
    system.refresh_processes_specifics(
        ProcessesToUpdate::Some(&[pid]),
        true,
        ProcessRefreshKind::nothing().with_cmd(UpdateKind::Always),
    );
    let process = system.process(pid)?;
    let args: Vec<String> = process
        .cmd()
        .iter()
        .map(|arg| arg.to_string_lossy().into_owned())
        .collect();
    interpreter_agent_identity(&args).map(str::to_string)
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
                        if is_interpreter(exe_name) {
                            if let Some(identity) = windows_interpreter_identity(*child_pid) {
                                return Some(identity);
                            }
                        }
                    }
                }
            }
            None
        }
    }
    #[cfg(not(target_os = "windows"))]
    {
        let output = std::process::Command::new("ps")
            .args(["-ax", "-o", "pid=,ppid=,args="])
            .output()
            .ok()?;
        if !output.status.success() {
            return None;
        }
        agent_from_process_snapshot(shell_pid, &String::from_utf8_lossy(&output.stdout))
    }
}

#[cfg(any(not(target_os = "windows"), test))]
fn agent_from_process_snapshot(shell_pid: u32, snapshot: &str) -> Option<String> {
    use std::collections::{HashMap, HashSet, VecDeque};
    let mut children: HashMap<u32, Vec<(u32, String)>> = HashMap::new();
    for line in snapshot.lines() {
        let mut fields = line.trim().splitn(2, char::is_whitespace);
        let Some(pid) = fields.next().and_then(|s| s.parse::<u32>().ok()) else {
            continue;
        };
        let Some(rest) = fields.next() else { continue };
        let mut fields = rest.trim_start().splitn(2, char::is_whitespace);
        let Some(ppid) = fields.next().and_then(|s| s.parse::<u32>().ok()) else {
            continue;
        };
        let Some(command) = fields.next().map(str::trim).filter(|s| !s.is_empty()) else {
            continue;
        };
        children
            .entry(ppid)
            .or_default()
            .push((pid, command.to_string()));
    }
    let mut queue = VecDeque::from([shell_pid]);
    let mut visited = HashSet::from([shell_pid]);
    while let Some(parent) = queue.pop_front() {
        for (pid, command) in children.get(&parent).into_iter().flatten() {
            if !visited.insert(*pid) {
                continue;
            }
            let tokens = command_tokens(command);
            if tokens.first().is_some_and(|exe| is_known_agent_exe(exe)) {
                return Some(command.clone());
            }
            if let Some(identity) = interpreter_agent_identity(&tokens) {
                return Some(identity.to_string());
            }
            queue.push_back(*pid);
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::{agent_from_process_snapshot, is_known_agent_exe};

    #[test]
    fn finds_nested_agents_from_portable_ps_snapshot() {
        let snapshot = " 10 1 /bin/zsh\n 11 10 bash -c wrapper\n 12 11 /usr/local/bin/claude --resume\n 20 1 codex\n malformed";
        assert_eq!(
            agent_from_process_snapshot(10, snapshot),
            Some("/usr/local/bin/claude --resume".into())
        );
        assert_eq!(agent_from_process_snapshot(99, snapshot), None);
        assert_eq!(
            agent_from_process_snapshot(10, "10 11 zsh\n11 10 bash"),
            None
        );
    }

    #[test]
    fn recognizes_interpreter_scripts_without_matching_unrelated_arguments() {
        for (cmd, expected) in [
            (
                "node /usr/lib/node_modules/@anthropic-ai/claude-code/cli.js",
                Some("claude"),
            ),
            (
                "node /usr/lib/node_modules/@google/gemini-cli/dist/index.js",
                Some("gemini"),
            ),
            ("bun /opt/codex.js", Some("codex")),
            ("python3 -m aider", Some("aider")),
            ("python3.13 -m aider.main", Some("aider")),
            ("node /tmp/server.js claude", None),
            ("node --eval claude", None),
            ("python3 -m unrelated aider", None),
        ] {
            let snapshot = format!("11 10 {cmd}");
            assert_eq!(
                agent_from_process_snapshot(10, &snapshot).as_deref(),
                expected
            );
        }
    }

    #[cfg(windows)]
    #[test]
    fn windows_reads_current_process_command_line_without_subprocesses() {
        use sysinfo::{Pid, ProcessRefreshKind, ProcessesToUpdate, System, UpdateKind};
        let mut system = System::new();
        let pid = Pid::from_u32(std::process::id());
        system.refresh_processes_specifics(
            ProcessesToUpdate::Some(&[pid]),
            true,
            ProcessRefreshKind::nothing().with_cmd(UpdateKind::Always),
        );
        assert!(!system.process(pid).unwrap().cmd().is_empty());
    }

    #[cfg(windows)]
    #[test]
    fn windows_detects_a_live_node_agent_script_in_descendants() {
        use std::os::windows::process::CommandExt;
        let directory = tempfile::tempdir().unwrap();
        let script = directory.path().join("claude.js");
        std::fs::write(&script, "setTimeout(() => {}, 30000);").unwrap();
        let mut child = std::process::Command::new("node")
            .arg(&script)
            .creation_flags(0x08000000)
            .spawn()
            .unwrap();
        let detected = super::probe_child_command_line(std::process::id());
        let _ = child.kill();
        let _ = child.wait();
        assert_eq!(detected.as_deref(), Some("claude"));
    }

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
