//! Run native ZLE/Readline completion in an isolated PTY.
use crate::composer_completion::{ComposerCompletionCandidate, ComposerCompletionResponse};
use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use std::io::{Read, Write};
use std::path::Path;
use std::sync::{mpsc, Mutex};
use std::time::{Duration, Instant};

const READY: &[u8] = b"\x1eMACH_READY\x1f";
const RESULT: &[u8] = b"\x1eMACH_RESULT:";
const OUTPUT_LIMIT: usize = 64 * 1024;
const TIMEOUT: Duration = Duration::from_secs(3);
#[cfg(target_os = "macos")]
const COMPLETION_LOCALE: &str = "en_US.UTF-8";
#[cfg(not(target_os = "macos"))]
const COMPLETION_LOCALE: &str = "C.UTF-8";

// The first widget loads data into the editor, Tab performs native completion,
// and the second widget reports the edited line. No accept-line key is sent.
const ZSH_SETUP: &str = r#"_mach_utf8=é; (( ${#_mach_utf8} == 1 )) || exit; if [[ -n $MACH_COMPLETION_PROFILE ]]; then autoload -Uz compinit; compinit -Di && source "$MACH_COMPLETION_PROFILE" || exit; else zle -A .complete-word complete-word; fi; _mach_load() { BUFFER=$MACH_COMPLETION_DRAFT; CURSOR=$MACH_COMPLETION_CURSOR; printf '\036MACH_LOADED\037'; }; _mach_result() { printf '\036MACH_RESULT:%s:%s\037' "$CURSOR" "$BUFFER"; }; zle -N _mach_load; zle -N _mach_result; bindkey -e; bindkey '^[[97~' _mach_load; bindkey '^I' complete-word; bindkey '^[[98~' _mach_result; printf '\036MACH_READY\037'"#;
const BASH_SETUP: &str = r#"_mach_utf8=é; (( ${#_mach_utf8} == 1 )) || exit; if (( BASH_VERSINFO[0] < 4 )); then exit; fi; if [[ -n $MACH_COMPLETION_PROFILE ]]; then source "$MACH_COMPLETION_PROFILE" || exit; fi; _mach_load() { READLINE_LINE=$MACH_COMPLETION_DRAFT; READLINE_POINT=$MACH_COMPLETION_CURSOR; printf '\036MACH_LOADED\037'; }; _mach_result() { printf '\036MACH_RESULT:%s:%s\037' "$READLINE_POINT" "$READLINE_LINE"; }; set -o emacs; bind -x '"\e[97~":_mach_load'; bind '"\C-i":complete'; bind '"\e[99~":"\C-i\e[98~"'; bind -x '"\e[98~":_mach_result'; printf '\036MACH_READY\037'"#;

pub(super) fn complete(
    shell: &str,
    cwd: &Path,
    draft: &str,
    cursor: usize,
    config_dir: Option<&Path>,
) -> Result<Option<ComposerCompletionResponse>, String> {
    let (setup, args, zsh) = match shell.rsplit('/').next() {
        Some("zsh") => (ZSH_SETUP, &["-f", "-i"][..], true),
        Some("bash") => (BASH_SETUP, &["--noprofile", "--norc", "-i"][..], false),
        _ => return Ok(None),
    };
    // Native completion may expand shell expressions. Keep this provider to
    // single-line drafts without command substitution or executable qualifiers.
    if draft.len() > 8192
        || draft
            .chars()
            .any(|ch| ch.is_control() || matches!(ch, '`' | '(' | ')'))
        || draft.contains("$[")
    {
        return Ok(None);
    }

    static PROBE: Mutex<()> = Mutex::new(());
    let _probe = PROBE
        .try_lock()
        .map_err(|_| "Shell completion is busy.".to_string())?;
    let shell_cursor = draft[..cursor].chars().count();
    let mut command = CommandBuilder::new(shell);
    command.args(args);
    command.cwd(cwd);
    // Editor cursor positions are character-based, even if Mach inherited LC_ALL=C.
    command.env("LC_ALL", COMPLETION_LOCALE);
    command.env("TERM", "xterm");
    command.env("HISTFILE", "/dev/null");
    command.env("INPUTRC", "/dev/null");
    for name in [
        "BASH_ENV",
        "ENV",
        "BASHOPTS",
        "SHELLOPTS",
        "PROMPT_COMMAND",
        "PS0",
        "PS1",
        "PS2",
        "PS4",
    ] {
        command.env_remove(name);
    }
    for (name, _) in std::env::vars_os() {
        if name.to_string_lossy().starts_with("BASH_FUNC_") {
            command.env_remove(name);
        }
    }
    let profile_name = if zsh {
        "completion.zsh"
    } else {
        "completion.bash"
    };
    let profile = config_dir
        .map(|dir| dir.join(profile_name))
        .filter(|path| path.is_file());
    command.env_remove("MACH_COMPLETION_PROFILE");
    if let Some(profile) = profile {
        command.env("MACH_COMPLETION_PROFILE", profile);
    }
    command.env("MACH_COMPLETION_DRAFT", draft);
    command.env("MACH_COMPLETION_CURSOR", shell_cursor.to_string());

    let Some(result) = probe(command, setup, zsh) else {
        return Ok(None);
    };
    let (position, line) = result
        .split_once(':')
        .ok_or("Invalid shell completion result.")?;
    let position: usize = position
        .parse()
        .map_err(|_| "Invalid shell completion cursor.")?;
    let position = {
        line.char_indices()
            .map(|(offset, _)| offset)
            .chain([line.len()])
            .nth(position)
            .ok_or("Invalid shell completion cursor.")?
    };
    if !line.is_char_boundary(position) || line.chars().any(char::is_control) {
        return Err("Shell returned an invalid completion edit.".to_string());
    }
    if line == draft {
        let cursor = draft[..cursor].encode_utf16().count();
        return Ok(Some(ComposerCompletionResponse {
            replacement_start: cursor,
            replacement_end: cursor,
            query: String::new(),
            candidates: Vec::new(),
        }));
    }

    let suffix = &line[position..];
    let original = draft
        .strip_suffix(suffix)
        .ok_or("Shell changed text beyond the completion cursor.")?;
    let replacement = &line[..position];
    let common_prefix: usize = original
        .chars()
        .zip(replacement.chars())
        .take_while(|(before, after)| before == after)
        .map(|(ch, _)| ch.len_utf8())
        .sum();
    Ok(Some(ComposerCompletionResponse {
        replacement_start: original[..common_prefix].encode_utf16().count(),
        replacement_end: original.encode_utf16().count(),
        query: original[common_prefix..].to_string(),
        candidates: vec![ComposerCompletionCandidate {
            value: replacement[common_prefix..].to_string(),
            kind: "shell".to_string(),
        }],
    }))
}

fn probe(command: CommandBuilder, setup: &str, zsh: bool) -> Option<String> {
    let pair = native_pty_system()
        .openpty(PtySize {
            rows: 24,
            cols: 120,
            pixel_width: 0,
            pixel_height: 0,
        })
        .ok()?;
    let mut reader = pair.master.try_clone_reader().ok()?;
    let mut writer = pair.master.take_writer().ok()?;
    let mut child = pair.slave.spawn_command(command).ok()?;
    drop(pair.slave);

    let (sender, receiver) = mpsc::sync_channel(4);
    std::thread::spawn(move || {
        let mut buffer = [0; 2048];
        while let Ok(count) = reader.read(&mut buffer) {
            if count == 0 || sender.send(buffer[..count].to_vec()).is_err() {
                break;
            }
        }
    });
    let result = (|| {
        let deadline = Instant::now() + TIMEOUT;
        let mut output = Vec::new();
        writeln!(writer, "{setup}").ok()?;
        while find(&output, READY).is_none() {
            read_more(&receiver, &mut output, deadline)?;
        }
        output.clear();
        writer.write_all(b"\x1b[97~").ok()?;
        while find(&output, b"\x1eMACH_LOADED\x1f").is_none() {
            read_more(&receiver, &mut output, deadline)?;
        }
        output.clear();
        writer
            .write_all(if zsh { b"\t\x1b[98~" } else { b"\x1b[99~" })
            .ok()?;
        loop {
            if let Some(start) = find(&output, RESULT) {
                let body = &output[start + RESULT.len()..];
                if let Some(end) = body.iter().position(|byte| *byte == 0x1f) {
                    return String::from_utf8(body[..end].to_vec()).ok();
                }
            }
            read_more(&receiver, &mut output, deadline)?;
        }
    })();
    drop(receiver);
    drop(writer);
    drop(pair.master);
    let _ = child.kill();
    let _ = child.wait();
    result
}

fn find(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    haystack
        .windows(needle.len())
        .position(|window| window == needle)
}

fn read_more(
    receiver: &mpsc::Receiver<Vec<u8>>,
    output: &mut Vec<u8>,
    deadline: Instant,
) -> Option<()> {
    let remaining = deadline.checked_duration_since(Instant::now())?;
    let chunk = receiver.recv_timeout(remaining).ok()?;
    if output.len() + chunk.len() > OUTPUT_LIMIT {
        return None;
    }
    output.extend(chunk);
    Some(())
}

#[cfg(test)]
mod tests {
    use super::complete;

    #[test]
    fn native_shells_escape_paths_keep_the_suffix_and_do_not_submit() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir(dir.path().join("ola documents")).unwrap();
        for shell in ["zsh", "bash"] {
            let Ok(version) = std::process::Command::new(shell).arg("--version").output() else {
                continue;
            };
            if !version.status.success()
                || (shell == "bash"
                    && String::from_utf8_lossy(&version.stdout).contains("version 3."))
            {
                continue;
            }
            let before_cursor = "echo 🦀 ./ola";
            let draft = format!("{before_cursor} ; touch should-not-run");
            let response = complete(shell, dir.path(), &draft, before_cursor.len(), None)
                .unwrap()
                .unwrap_or_else(|| panic!("{shell} completion unavailable"));
            let units: Vec<_> = draft.encode_utf16().collect();
            let start = String::from_utf16(&units[..response.replacement_start]).unwrap();
            let end = String::from_utf16(&units[response.replacement_end..]).unwrap();
            let replacement = &response.candidates[0].value;
            assert_eq!(
                format!("{start}{replacement}{end}"),
                "echo 🦀 ./ola\\ documents/ ; touch should-not-run",
                "{shell}"
            );
            assert!(
                !dir.path().join("should-not-run").exists(),
                "{shell} submitted the draft"
            );

            let (file, registration) = if shell == "zsh" {
                (
                    "completion.zsh",
                    "_mach_test() { compadd -- custom-result; }; compdef _mach_test mach-demo",
                )
            } else {
                (
                    "completion.bash",
                    "_mach_test() { COMPREPLY=(custom-result); }; complete -F _mach_test mach-demo",
                )
            };
            std::fs::write(dir.path().join(file), registration).unwrap();
            let custom = "mach-demo cust";
            let response = complete(shell, dir.path(), custom, custom.len(), Some(dir.path()))
                .unwrap()
                .unwrap();
            let result = format!(
                "{}{}{}",
                &custom[..response.replacement_start],
                response.candidates[0].value,
                &custom[response.replacement_end..]
            );
            assert_eq!(result.trim_end(), "mach-demo custom-result", "{shell}");

            let no_match = "cd ./no-such-directory";
            assert!(
                complete(shell, dir.path(), no_match, no_match.len(), None)
                    .unwrap()
                    .unwrap()
                    .candidates
                    .is_empty(),
                "{shell}"
            );
        }
    }
}
