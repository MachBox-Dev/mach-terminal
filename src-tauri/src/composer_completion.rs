use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::ffi::OsStr;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

const DEFAULT_LIMIT: usize = 40;
const MAX_LIMIT: usize = 200;
const COMMAND_CACHE_KEY: &str = "path_commands";

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ComposerCompletionRequest {
    pub draft: String,
    pub cursor: usize,
    /// Optional UI hint (OSC7 map / session snapshot). Prefer `session_id` + backend lookup when set.
    pub cwd: Option<String>,
    pub shell: Option<String>,
    pub session_id: Option<String>,
    pub limit: Option<usize>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ComposerCompletionResponse {
    pub replacement_start: usize,
    pub replacement_end: usize,
    pub query: String,
    pub candidates: Vec<ComposerCompletionCandidate>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ComposerCompletionCandidate {
    pub value: String,
    pub kind: String,
}

#[derive(Debug, Clone)]
struct CompletionToken {
    start: usize,
    end: usize,
    raw: String,
}

#[derive(Default)]
struct CommandCache {
    entries: HashMap<String, Vec<String>>,
    path_key: String,
    captured_at: Option<Instant>,
}

static COMMAND_CACHE: OnceLock<Mutex<CommandCache>> = OnceLock::new();

pub fn complete(
    request: ComposerCompletionRequest,
    manager: Option<&crate::session_manager::SessionManager>,
) -> Result<ComposerCompletionResponse, String> {
    let cursor = request.cursor.min(request.draft.len());
    let token = token_at_cursor(&request.draft, cursor);
    let query = unquote_token(&token.raw);
    let limit = request.limit.unwrap_or(DEFAULT_LIMIT).min(MAX_LIMIT);
    let session_cwd = match (request.session_id.as_deref(), manager) {
        (Some(id), Some(mgr)) => mgr.session_cwd_snapshot(id)?,
        _ => None,
    };
    let cwd = resolve_cwd_for_completion(session_cwd.as_deref(), request.cwd.as_deref())?;

    let candidates = if should_complete_path(&query) {
        complete_paths(&cwd, &query, limit)?
            .into_iter()
            .map(|value| ComposerCompletionCandidate {
                value,
                kind: "path".to_string(),
            })
            .collect()
    } else {
        complete_commands(request.shell.as_deref(), &query, limit)?
            .into_iter()
            .map(|value| ComposerCompletionCandidate {
                value,
                kind: "command".to_string(),
            })
            .collect()
    };

    Ok(ComposerCompletionResponse {
        replacement_start: token.start,
        replacement_end: token.end,
        query,
        candidates,
    })
}

fn token_at_cursor(draft: &str, cursor: usize) -> CompletionToken {
    let bytes = draft.as_bytes();
    let mut start = cursor;
    while start > 0 {
        let ch = bytes[start - 1] as char;
        if ch.is_whitespace() {
            break;
        }
        start -= 1;
    }
    let mut end = cursor;
    while end < bytes.len() {
        let ch = bytes[end] as char;
        if ch.is_whitespace() {
            break;
        }
        end += 1;
    }
    CompletionToken {
        start,
        end,
        raw: draft[start..end].to_string(),
    }
}

fn unquote_token(token: &str) -> String {
    if token.len() >= 2 {
        let first = token.chars().next().unwrap_or_default();
        let last = token.chars().last().unwrap_or_default();
        if (first == '"' && last == '"') || (first == '\'' && last == '\'') {
            return token[1..token.len() - 1].to_string();
        }
    }
    token.to_string()
}

/// Prefer live session cwd from the PTY (when `session_id` resolves), then the UI hint.
/// Do **not** require `exists()` — network paths, ACL quirks, and racey metadata should not
/// force a fallback to the *app* process cwd (which breaks relative path completion).
fn resolve_cwd_for_completion(session_cwd: Option<&str>, cwd_hint: Option<&str>) -> Result<PathBuf, String> {
    if let Some(path) = session_cwd.and_then(normalize_cwd_string) {
        return Ok(path);
    }
    if let Some(path) = cwd_hint.and_then(normalize_cwd_string) {
        return Ok(path);
    }
    std::env::current_dir().map_err(|error| format!("failed to resolve current directory: {error}"))
}

fn normalize_cwd_string(value: &str) -> Option<PathBuf> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return None;
    }
    let path = PathBuf::from(trimmed);
    if path.is_absolute() {
        return Some(path);
    }
    std::env::current_dir().ok().map(|cwd| cwd.join(path))
}

fn should_complete_path(query: &str) -> bool {
    if query.is_empty() {
        return true;
    }
    query.contains('/')
        || query.contains('\\')
        || query.starts_with('.')
        || query.starts_with('~')
        || query.starts_with('"')
        || query.starts_with('\'')
        || query.contains(':')
}

fn split_dir_and_prefix(query: &str) -> (&str, &str, Option<char>) {
    let slash = query.rfind('/');
    let backslash = query.rfind('\\');
    let separator = match (slash, backslash) {
        (Some(a), Some(b)) => {
            if a > b {
                Some((a, '/'))
            } else {
                Some((b, '\\'))
            }
        }
        (Some(a), None) => Some((a, '/')),
        (None, Some(b)) => Some((b, '\\')),
        (None, None) => None,
    };

    if let Some((idx, sep)) = separator {
        (&query[..=idx], &query[idx + 1..], Some(sep))
    } else {
        ("", query, None)
    }
}

fn resolve_query_dir(cwd: &Path, dir_part: &str) -> PathBuf {
    if dir_part.is_empty() {
        return cwd.to_path_buf();
    }
    if let Some(stripped) = dir_part.strip_prefix('~') {
        if let Some(home) = dirs::home_dir() {
            let rest = stripped.trim_start_matches(['/', '\\']);
            return if rest.is_empty() { home } else { home.join(rest) };
        }
    }
    let dir = PathBuf::from(dir_part);
    if dir.is_absolute() {
        dir
    } else {
        cwd.join(dir)
    }
}

fn complete_paths(cwd: &Path, query: &str, limit: usize) -> Result<Vec<String>, String> {
    let (dir_part, prefix, sep_hint) = split_dir_and_prefix(query);
    let query_dir = resolve_query_dir(cwd, dir_part);
    let mut entries = std::fs::read_dir(&query_dir)
        .map_err(|error| format!("failed to read completion directory `{}`: {error}", query_dir.display()))?;
    let mut results = Vec::new();
    while let Some(item) = entries.next() {
        let Ok(entry) = item else { continue };
        let file_name = entry.file_name().to_string_lossy().to_string();
        if !prefix.is_empty() && !file_name.to_lowercase().starts_with(&prefix.to_lowercase()) {
            continue;
        }
        let mut candidate = format!("{dir_part}{file_name}");
        if entry.path().is_dir() {
            candidate.push(sep_hint.unwrap_or(std::path::MAIN_SEPARATOR));
        }
        results.push(candidate);
        if results.len() >= limit {
            break;
        }
    }
    results.sort();
    Ok(results)
}

fn complete_commands(shell: Option<&str>, query: &str, limit: usize) -> Result<Vec<String>, String> {
    let mut set = HashSet::new();
    for builtin in shell_builtin_commands(shell) {
        if query.is_empty() || builtin.to_lowercase().starts_with(&query.to_lowercase()) {
            set.insert(builtin.to_string());
        }
    }
    for command in path_commands()? {
        if query.is_empty() || command.to_lowercase().starts_with(&query.to_lowercase()) {
            set.insert(command);
        }
    }
    let mut values: Vec<String> = set.into_iter().collect();
    values.sort();
    values.truncate(limit);
    Ok(values)
}

fn path_commands() -> Result<Vec<String>, String> {
    let cache = COMMAND_CACHE.get_or_init(|| Mutex::new(CommandCache::default()));
    let path_value = std::env::var_os("PATH")
        .unwrap_or_default()
        .to_string_lossy()
        .to_string();
    let stale_after = Duration::from_secs(30);
    if let Ok(guard) = cache.lock() {
        let fresh = guard
            .captured_at
            .map(|captured| captured.elapsed() < stale_after)
            .unwrap_or(false);
        if fresh && guard.path_key == path_value {
            if let Some(cached) = guard.entries.get(COMMAND_CACHE_KEY) {
                return Ok(cached.clone());
            }
        }
    }

    let path = std::ffi::OsString::from(&path_value);
    let path_dirs: Vec<PathBuf> = std::env::split_paths(&path).collect();
    let exts = executable_extensions();
    let mut set = HashSet::new();
    for dir in path_dirs {
        let Ok(entries) = std::fs::read_dir(&dir) else { continue };
        for item in entries {
            let Ok(entry) = item else { continue };
            let path = entry.path();
            if !path.is_file() {
                continue;
            }
            if is_executable_candidate(&path, &exts) {
                if let Some(command) = normalize_command_name(path.file_name()) {
                    set.insert(command);
                }
            }
        }
    }
    let mut commands: Vec<String> = set.into_iter().collect();
    commands.sort();
    if let Ok(mut guard) = cache.lock() {
        guard.entries.insert(COMMAND_CACHE_KEY.to_string(), commands.clone());
        guard.path_key = path_value;
        guard.captured_at = Some(Instant::now());
    }
    Ok(commands)
}

fn executable_extensions() -> HashSet<String> {
    #[cfg(target_os = "windows")]
    {
        let pathext = std::env::var("PATHEXT").unwrap_or(".COM;.EXE;.BAT;.CMD;.PS1".to_string());
        return pathext
            .split(';')
            .map(|value| value.trim().to_lowercase())
            .filter(|value| !value.is_empty())
            .collect();
    }
    #[cfg(not(target_os = "windows"))]
    {
        HashSet::new()
    }
}

fn is_executable_candidate(path: &Path, extensions: &HashSet<String>) -> bool {
    #[cfg(target_os = "windows")]
    {
        if let Some(ext) = path.extension().and_then(|value| value.to_str()) {
            return extensions.contains(&format!(".{}", ext.to_lowercase()));
        }
        false
    }
    #[cfg(not(target_os = "windows"))]
    {
        use std::os::unix::fs::PermissionsExt;
        path.metadata()
            .map(|meta| meta.permissions().mode() & 0o111 != 0)
            .unwrap_or(false)
    }
}

fn normalize_command_name(name: Option<&OsStr>) -> Option<String> {
    let value = name?.to_string_lossy().to_string();
    #[cfg(target_os = "windows")]
    {
        let lowercase = value.to_lowercase();
        for ext in [".exe", ".cmd", ".bat", ".com", ".ps1"] {
            if lowercase.ends_with(ext) {
                return Some(value[..value.len() - ext.len()].to_string());
            }
        }
        Some(value)
    }
    #[cfg(not(target_os = "windows"))]
    {
        Some(value)
    }
}

fn shell_builtin_commands(shell: Option<&str>) -> &'static [&'static str] {
    let shell = shell.unwrap_or_default().to_lowercase();
    if shell.contains("pwsh") || shell.contains("powershell") {
        return &[
            "cd", "ls", "pwd", "cat", "echo", "where", "Get-ChildItem", "Get-Location", "Set-Location",
            "Get-Command", "Write-Host", "Clear-Host", "New-Item", "Remove-Item", "Copy-Item", "Move-Item",
        ];
    }
    &[
        "cd", "ls", "pwd", "cat", "echo", "which", "clear", "mkdir", "rm", "cp", "mv", "touch", "grep", "find",
        "sed", "awk",
    ]
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;

    use super::{normalize_cwd_string, resolve_cwd_for_completion, split_dir_and_prefix, token_at_cursor, unquote_token};

    #[test]
    fn token_scans_word_at_cursor() {
        let token = token_at_cursor("npm run bui", 11);
        assert_eq!(token.start, 8);
        assert_eq!(token.end, 11);
        assert_eq!(token.raw, "bui");
    }

    #[test]
    fn split_dir_and_prefix_handles_windows_and_unix_separators() {
        let (dir, prefix, _) = split_dir_and_prefix("./src/com");
        assert_eq!(dir, "./src/");
        assert_eq!(prefix, "com");

        let (win_dir, win_prefix, _) = split_dir_and_prefix("C:\\Users\\mi");
        assert_eq!(win_dir, "C:\\Users\\");
        assert_eq!(win_prefix, "mi");
    }

    #[test]
    fn unquote_token_removes_balanced_wrapping_quote() {
        assert_eq!(unquote_token("\"hello\""), "hello");
        assert_eq!(unquote_token("'hello'"), "hello");
        assert_eq!(unquote_token("hello"), "hello");
    }

    #[test]
    fn normalize_cwd_accepts_absolute_paths_without_existence_check() {
        #[cfg(windows)]
        {
            let p = normalize_cwd_string(r"C:\path\that\likely\does\not\exist").expect("cwd");
            assert!(p.is_absolute());
        }
        #[cfg(not(windows))]
        {
            let p = normalize_cwd_string("/path/that/likely/does/not/exist").expect("cwd");
            assert!(p.is_absolute());
        }
    }

    #[test]
    fn resolve_cwd_prefers_session_hint_over_ui_hint() {
        #[cfg(windows)]
        {
            let got = resolve_cwd_for_completion(Some(r"C:\session"), Some(r"D:\hint")).unwrap();
            assert_eq!(got, PathBuf::from(r"C:\session"));
        }
        #[cfg(not(windows))]
        {
            let got = resolve_cwd_for_completion(Some("/session"), Some("/hint")).unwrap();
            assert_eq!(got, PathBuf::from("/session"));
        }
    }
}
