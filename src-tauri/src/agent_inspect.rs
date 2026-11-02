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
enum WindowsChildDisposition {
    Inactive,
    NonAgentForeground,
    AgentForeground(String),
}

#[cfg(any(windows, test))]
fn is_windows_background_job_host(exe_name: &str, args: &[String]) -> bool {
    let lower = exe_name.trim().to_ascii_lowercase();
    let stem = lower
        .rsplit(['/', '\\'])
        .next()
        .unwrap_or(&lower)
        .strip_suffix(".exe")
        .unwrap_or(&lower);
    if matches!(stem, "pwsh" | "powershell") {
        return args.iter().skip(1).any(|arg| {
            let a = arg.to_ascii_lowercase();
            matches!(
                a.as_str(),
                "-servermode" | "-s" | "-encodedcommand" | "-e" | "-ec" | "-background"
            )
        });
    }
    if stem == "cmd" {
        let joined = args.join(" ").to_ascii_lowercase();
        return joined.contains("start /b") || joined.contains("start \"\" /b");
    }
    false
}

#[cfg(windows)]
fn windows_inspect_process(pid: u32, exe_name: &str) -> WindowsChildDisposition {
    use sysinfo::{Pid, ProcessRefreshKind, ProcessesToUpdate, System, UpdateKind};
    let mut system = System::new();
    let sys_pid = Pid::from_u32(pid);
    system.refresh_processes_specifics(
        ProcessesToUpdate::Some(&[sys_pid]),
        true,
        ProcessRefreshKind::nothing().with_cmd(UpdateKind::Always),
    );
    let Some(process) = system.process(sys_pid) else {
        return WindowsChildDisposition::Inactive;
    };
    if matches!(
        process.status(),
        sysinfo::ProcessStatus::Stop
            | sysinfo::ProcessStatus::Zombie
            | sysinfo::ProcessStatus::Dead
    ) {
        return WindowsChildDisposition::Inactive;
    }
    let args: Vec<String> = process
        .cmd()
        .iter()
        .map(|arg| arg.to_string_lossy().into_owned())
        .collect();
    if is_windows_background_job_host(exe_name, &args) {
        return WindowsChildDisposition::Inactive;
    }
    if is_known_agent_exe(exe_name) {
        return WindowsChildDisposition::AgentForeground(exe_name.to_string());
    }
    if is_interpreter(exe_name) {
        if let Some(identity) = interpreter_agent_identity(&args) {
            return WindowsChildDisposition::AgentForeground(identity.to_string());
        }
    }
    WindowsChildDisposition::NonAgentForeground
}

/// Probe descendant processes of `shell_pid` to detect any active foreground CLI coding agent
/// (`agy`, `claude`, `codex`, `gemini`, `aider`, `opencode`, `cursor-agent`, `goose`, `amp`, `copilot`).
///
/// On Windows, uses the in-process Win32 Toolhelp32 API (`CreateToolhelp32Snapshot`) so no
/// external console subprocess (`powershell` / `wmic`) is ever spawned.
/// Returns `Some(exe_name)` only when a non-stopped coding agent belongs to the active foreground tree.
pub struct AgentProcessProbe {
    pub command_line: Option<String>,
    pub has_descendants: bool,
}

#[cfg(test)]
pub fn probe_child_command_line(shell_pid: u32) -> Option<String> {
    probe_session_process(shell_pid).and_then(|probe| probe.command_line)
}

pub fn probe_session_process(shell_pid: u32) -> Option<AgentProcessProbe> {
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
            if Process32FirstW(snapshot, &mut entry).is_err() {
                let _ = CloseHandle(snapshot);
                return None;
            }
            {
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
                        if !visited.insert(*child_pid) {
                            continue;
                        }
                        match windows_inspect_process(*child_pid, exe_name) {
                            WindowsChildDisposition::Inactive => {}
                            WindowsChildDisposition::AgentForeground(identity) => {
                                return Some(AgentProcessProbe {
                                    command_line: Some(identity),
                                    has_descendants: true,
                                });
                            }
                            WindowsChildDisposition::NonAgentForeground => {
                                queue.push_back(*child_pid);
                            }
                        }
                    }
                }
            }
            Some(AgentProcessProbe {
                command_line: None,
                has_descendants: children_by_parent
                    .get(&shell_pid)
                    .is_some_and(|children| !children.is_empty()),
            })
        }
    }
    #[cfg(not(target_os = "windows"))]
    {
        let output = std::process::Command::new("ps")
            .args(["-ax", "-o", "pid=,ppid=,pgid=,tpgid=,stat=,args="])
            .output()
            .ok()?;
        if !output.status.success() {
            return None;
        }
        Some(process_probe_from_snapshot(
            shell_pid,
            &String::from_utf8_lossy(&output.stdout),
        ))
    }
}

#[cfg(any(not(target_os = "windows"), test))]
#[derive(Clone, Debug)]
struct PsSnapshotRow {
    pid: u32,
    ppid: u32,
    pgid: Option<u32>,
    tpgid: Option<i32>,
    stat: Option<String>,
    command: String,
}

#[cfg(any(not(target_os = "windows"), test))]
fn is_ps_stat_token(token: &str) -> bool {
    let mut chars = token.chars();
    let Some(first) = chars.next() else {
        return false;
    };
    if !matches!(
        first,
        'R' | 'S' | 'D' | 'I' | 'T' | 't' | 'Z' | 'X' | 'W' | 'U'
    ) {
        return false;
    }
    token.len() <= 7
        && chars.all(|c| {
            matches!(
                c,
                's' | 'l' | '+' | '<' | 'N' | 'L' | 'E' | 'V' | 'W' | 'p' | 'a' | 'x'
            )
        })
}

#[cfg(any(not(target_os = "windows"), test))]
fn parse_ps_snapshot_row(line: &str) -> Option<PsSnapshotRow> {
    let mut fields = line.trim().splitn(2, char::is_whitespace);
    let pid = fields.next()?.parse::<u32>().ok()?;
    let rest = fields.next()?.trim_start();
    let mut fields = rest.splitn(2, char::is_whitespace);
    let ppid = fields.next()?.parse::<u32>().ok()?;
    let after_ppid = fields.next()?.trim_start();
    if after_ppid.is_empty() {
        return None;
    }

    // Check 6-column `pid ppid pgid tpgid stat args` format first.
    let mut f6 = after_ppid.splitn(2, char::is_whitespace);
    if let (Some(tok3), Some(rest3)) = (f6.next(), f6.next()) {
        if let Ok(pgid) = tok3.parse::<u32>() {
            let mut f6b = rest3.trim_start().splitn(2, char::is_whitespace);
            if let (Some(tok4), Some(rest4)) = (f6b.next(), f6b.next()) {
                if let Ok(tpgid) = tok4.parse::<i32>() {
                    let mut f6c = rest4.trim_start().splitn(2, char::is_whitespace);
                    if let (Some(tok5), Some(cmd_rest)) = (f6c.next(), f6c.next()) {
                        let cmd = cmd_rest.trim();
                        if is_ps_stat_token(tok5) && !cmd.is_empty() {
                            return Some(PsSnapshotRow {
                                pid,
                                ppid,
                                pgid: Some(pgid),
                                tpgid: Some(tpgid),
                                stat: Some(tok5.to_string()),
                                command: cmd.to_string(),
                            });
                        }
                    }
                }
            }
        }
        // Check 4-column `pid ppid stat args` format.
        let cmd = rest3.trim();
        if is_ps_stat_token(tok3) && !cmd.is_empty() {
            return Some(PsSnapshotRow {
                pid,
                ppid,
                pgid: None,
                tpgid: None,
                stat: Some(tok3.to_string()),
                command: cmd.to_string(),
            });
        }
    }

    Some(PsSnapshotRow {
        pid,
        ppid,
        pgid: None,
        tpgid: None,
        stat: None,
        command: after_ppid.trim().to_string(),
    })
}

#[cfg(any(not(target_os = "windows"), test))]
impl PsSnapshotRow {
    fn is_zombie_or_dead(&self) -> bool {
        self.stat
            .as_deref()
            .is_some_and(|s| s.starts_with(['Z', 'X']))
    }

    fn is_stopped(&self) -> bool {
        self.stat
            .as_deref()
            .is_some_and(|s| s.starts_with(['T', 't', 'Z', 'X']))
    }

    fn is_foreground(&self, shell_tpgid: Option<i32>) -> bool {
        if self.is_stopped() {
            return false;
        }
        if let Some(stat) = self.stat.as_deref() {
            if !stat.contains('+') {
                return false;
            }
        }
        if let (Some(pgid), Some(tpgid)) = (self.pgid, self.tpgid) {
            if tpgid <= 0 || pgid as i32 != tpgid {
                return false;
            }
            if let Some(expected_tpgid) = shell_tpgid {
                if expected_tpgid <= 0 || pgid as i32 != expected_tpgid {
                    return false;
                }
            }
        }
        !self.command.trim_end().ends_with('&')
    }
}

#[cfg(any(not(target_os = "windows"), test))]
fn process_probe_from_snapshot(shell_pid: u32, snapshot: &str) -> AgentProcessProbe {
    use std::collections::{HashMap, HashSet, VecDeque};
    let mut children: HashMap<u32, Vec<PsSnapshotRow>> = HashMap::new();
    let mut shell_tpgid: Option<i32> = None;
    for line in snapshot.lines() {
        let Some(row) = parse_ps_snapshot_row(line) else {
            continue;
        };
        if row.pid == shell_pid {
            shell_tpgid = row.tpgid;
        }
        if row.pid != 0 && row.pid != row.ppid && !row.is_zombie_or_dead() {
            children.entry(row.ppid).or_default().push(row);
        }
    }
    let has_descendants = children
        .get(&shell_pid)
        .is_some_and(|rows| !rows.is_empty());
    let mut queue = VecDeque::from([shell_pid]);
    let mut visited = HashSet::from([shell_pid]);
    while let Some(parent) = queue.pop_front() {
        for row in children.get(&parent).into_iter().flatten() {
            if !visited.insert(row.pid) || !row.is_foreground(shell_tpgid) {
                continue;
            }
            let tokens = command_tokens(&row.command);
            if tokens.first().is_some_and(|exe| is_known_agent_exe(exe)) {
                return AgentProcessProbe {
                    command_line: Some(row.command.clone()),
                    has_descendants: true,
                };
            }
            if let Some(identity) = interpreter_agent_identity(&tokens) {
                return AgentProcessProbe {
                    command_line: Some(identity.to_string()),
                    has_descendants: true,
                };
            }
            queue.push_back(row.pid);
        }
    }
    AgentProcessProbe {
        command_line: None,
        has_descendants,
    }
}

#[cfg(test)]
fn agent_from_process_snapshot(shell_pid: u32, snapshot: &str) -> Option<String> {
    process_probe_from_snapshot(shell_pid, snapshot).command_line
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
    fn distinguishes_unknown_live_children_from_a_returned_shell() {
        assert!(super::process_probe_from_snapshot(10, "11 10 node unrelated.js").has_descendants);
        assert!(!super::process_probe_from_snapshot(10, "11 1 node unrelated.js").has_descendants);
    }

    #[test]
    fn ignores_stopped_or_background_agents_in_ps_snapshot() {
        let foreground = "10 1 10 12 Ss /bin/zsh\n11 10 12 12 S+ bash -c wrapper\n12 11 12 12 S+ /usr/local/bin/claude --resume";
        let probe_fg = super::process_probe_from_snapshot(10, foreground);
        assert_eq!(
            probe_fg.command_line.as_deref(),
            Some("/usr/local/bin/claude --resume")
        );
        assert!(probe_fg.has_descendants);

        let stopped = "10 1 10 10 Ss+ /bin/zsh\n12 10 12 10 T /usr/local/bin/claude";
        let probe_stopped = super::process_probe_from_snapshot(10, stopped);
        assert_eq!(probe_stopped.command_line, None);
        assert!(probe_stopped.has_descendants);

        let background = "10 1 10 10 Ss+ /bin/zsh\n12 10 12 10 S /usr/local/bin/claude";
        let probe_bg = super::process_probe_from_snapshot(10, background);
        assert_eq!(probe_bg.command_line, None);
        assert!(probe_bg.has_descendants);

        let zombie = "10 1 10 10 Ss+ /bin/zsh\n12 10 12 10 Z /usr/local/bin/claude";
        let probe_zombie = super::process_probe_from_snapshot(10, zombie);
        assert_eq!(probe_zombie.command_line, None);
        assert!(!probe_zombie.has_descendants);
    }

    #[test]
    fn filters_windows_background_job_hosts() {
        assert!(super::is_windows_background_job_host(
            "pwsh.exe",
            &["pwsh.exe".into(), "-ServerMode".into()]
        ));
        assert!(super::is_windows_background_job_host(
            "powershell.exe",
            &["powershell.exe".into(), "-EncodedCommand".into(), "abc".into()]
        ));
        assert!(!super::is_windows_background_job_host(
            "pwsh.exe",
            &["pwsh.exe".into(), "-NoLogo".into()]
        ));
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
