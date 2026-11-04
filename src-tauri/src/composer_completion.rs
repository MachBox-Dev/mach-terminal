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
    /// UTF-16 code units, matching the textarea's selectionStart.
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

#[derive(Debug, Clone, Deserialize, Serialize)]
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
    session: Option<crate::models::PtySessionInfo>,
) -> Result<ComposerCompletionResponse, String> {
    let cursor = byte_offset_for_utf16(&request.draft, request.cursor);
    let token = token_at_cursor(&request.draft, cursor);
    let query = unquote_token(&token.raw);
    let limit = request.limit.unwrap_or(DEFAULT_LIMIT).min(MAX_LIMIT);
    let cwd = resolve_cwd_for_completion(
        session.as_ref().and_then(|session| session.cwd.as_deref()),
        request.cwd.as_deref(),
    )?;
    if let Some(shell) = session.as_ref().map(|session| session.shell.as_str()) {
        if let Some(result) = complete_powershell(shell, &cwd, &request.draft, cursor, limit)? {
            return Ok(result);
        }
    }

    // Bare arguments such as `cd doc<Tab>` are commonly relative paths.
    // Keep command-name discovery for the first token.
    let argument = !request.draft[..token.start].trim().is_empty();
    let explicit_path = should_complete_path(&query);
    let paths = if explicit_path {
        complete_paths(&cwd, &query, limit)?
    } else if argument {
        complete_paths(&cwd, &query, limit).unwrap_or_default()
    } else {
        Vec::new()
    };
    let candidates = if explicit_path || !paths.is_empty() {
        paths.into_iter()
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
        replacement_start: request.draft[..token.start].encode_utf16().count(),
        replacement_end: request.draft[..token.end].encode_utf16().count(),
        query,
        candidates,
    })
}

/// Ask the configured PowerShell executable for native completion without
/// evaluating the draft or sending any keys to the live PTY.
fn complete_powershell(
    shell: &str,
    cwd: &Path,
    draft: &str,
    cursor: usize,
    limit: usize,
) -> Result<Option<ComposerCompletionResponse>, String> {
    let basename = shell.rsplit(['/', '\\']).next().unwrap_or_default();
    if !["pwsh", "pwsh.exe", "powershell", "powershell.exe"]
        .iter().any(|name| basename.eq_ignore_ascii_case(name))
    {
        return Ok(None);
    }
    if draft.len() > 8192 || draft.contains('\0') {
        return Err("Draft is too large or contains a NUL character.".to_string());
    }

    // Keep repeated Tab presses from stacking up PowerShell processes.
    static PROBE: Mutex<()> = Mutex::new(());
    let _probe = PROBE.try_lock().map_err(|_| "PowerShell completion is busy.".to_string())?;
    let mut command = std::process::Command::new(shell);
    command
        .current_dir(cwd)
        .args(["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", r#"
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$draft = [string] $env:MACH_COMPLETION_DRAFT
$result = TabExpansion2 -inputScript $draft -cursorColumn ([int] $env:MACH_COMPLETION_CURSOR)
$items = @($result.CompletionMatches | Select-Object -First ([int] $env:MACH_COMPLETION_LIMIT) | ForEach-Object {
    @{ value = $_.CompletionText; kind = $_.ResultType.ToString() }
})
@{
    replacementStart = $result.ReplacementIndex
    replacementLength = $result.ReplacementLength
    candidates = $items
} | ConvertTo-Json -Compress -Depth 4
"#])
        .env("MACH_COMPLETION_DRAFT", draft)
        .env("MACH_COMPLETION_CURSOR", draft[..cursor].encode_utf16().count().to_string())
        .env("MACH_COMPLETION_LIMIT", limit.max(1).to_string());

    let Some(output) = crate::shell_context::bounded_command_output(command, Duration::from_secs(2), 128 * 1024)
        .filter(|output| output.status.success())
    else {
        return Ok(None);
    };
    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct PowerShellCompletion {
        replacement_start: i32,
        replacement_length: i32,
        candidates: Vec<ComposerCompletionCandidate>,
    }
    let Ok(result) = serde_json::from_slice::<PowerShellCompletion>(&output.stdout) else {
        return Ok(None);
    };
    if result.candidates.is_empty() || limit == 0 {
        return Ok(Some(ComposerCompletionResponse {
            replacement_start: draft[..cursor].encode_utf16().count(),
            replacement_end: draft[..cursor].encode_utf16().count(),
            query: String::new(),
            candidates: Vec::new(),
        }));
    }
    let start = usize::try_from(result.replacement_start).map_err(|_| "Invalid completion start")?;
    let length = usize::try_from(result.replacement_length).map_err(|_| "Invalid completion length")?;
    let end = start.checked_add(length).ok_or("Invalid completion range")?;
    let start_byte = byte_offset_for_utf16(draft, start);
    let end_byte = byte_offset_for_utf16(draft, end);
    if draft[..start_byte].encode_utf16().count() != start || draft[..end_byte].encode_utf16().count() != end {
        return Err("PowerShell returned an invalid completion range.".to_string());
    }
    Ok(Some(ComposerCompletionResponse {
        replacement_start: start,
        replacement_end: end,
        query: draft[start_byte..end_byte].to_string(),
        candidates: result.candidates,
    }))
}

fn byte_offset_for_utf16(text: &str, cursor: usize) -> usize {
    let mut units = 0;
    for (offset, ch) in text.char_indices() {
        if units + ch.len_utf16() > cursor {
            return offset;
        }
        units += ch.len_utf16();
    }
    text.len()
}

fn token_at_cursor(draft: &str, cursor: usize) -> CompletionToken {
    let start = draft[..cursor].char_indices().rev()
        .find(|(_, ch)| ch.is_whitespace())
        .map(|(offset, ch)| offset + ch.len_utf8())
        .unwrap_or(0);
    let end = draft[cursor..].char_indices()
        .find(|(_, ch)| ch.is_whitespace())
        .map(|(offset, _)| cursor + offset)
        .unwrap_or(draft.len());
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

fn is_executable_candidate(path: &Path, _extensions: &HashSet<String>) -> bool {
    #[cfg(target_os = "windows")]
    {
        if let Some(ext) = path.extension().and_then(|value| value.to_str()) {
            return _extensions.contains(&format!(".{}", ext.to_lowercase()));
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
    fn token_scans_unicode_without_slicing_inside_a_character() {
        for draft in ["à", "é", "文件", "🦀"] {
            let token = token_at_cursor(draft, draft.len());
            assert_eq!(token.raw, draft);
            assert_eq!(token.start, 0);
            assert_eq!(token.end, draft.len());
        }
    }

    #[test]
    fn completion_round_trips_textarea_utf16_offsets() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("résultat.txt"), "").unwrap();
        let prefix = "echo 🦀 文件 à ";
        let draft = format!("{prefix}./rés --flag");
        let cursor = format!("{prefix}./rés").encode_utf16().count();
        let result = super::complete(super::ComposerCompletionRequest {
            draft, cursor, cwd: Some(dir.path().to_string_lossy().into_owned()),
            shell: None, session_id: None, limit: None,
        }, None).unwrap();
        assert_eq!(result.replacement_start, prefix.encode_utf16().count());
        assert_eq!(result.replacement_end, cursor);
        assert_eq!(result.query, "./rés");
        assert_eq!(result.candidates[0].value, "./résultat.txt");
    }

    #[test]
    fn completes_bare_relative_path_arguments() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir(dir.path().join("documents")).unwrap();
        let result = super::complete(
            super::ComposerCompletionRequest {
                draft: "cd doc".to_string(),
                cursor: 6,
                cwd: Some(dir.path().to_string_lossy().into_owned()),
                shell: None,
                session_id: None,
                limit: None,
            },
            None,
        ).unwrap();
        assert_eq!(result.replacement_start, 3);
        assert_eq!(result.replacement_end, 6);
        assert_eq!(result.candidates[0].value, format!("documents{}", std::path::MAIN_SEPARATOR));
        assert_eq!(result.candidates[0].kind, "path");
    }

    #[cfg(windows)]
    #[test]
    fn powershell_owns_quoted_paths_parameters_and_empty_results() {
        use super::{complete, ComposerCompletionRequest};
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir(dir.path().join("ola documents")).unwrap();
        let run = |draft: &str, cursor: usize| {
            complete(ComposerCompletionRequest {
                draft: draft.to_string(), cursor, cwd: None, shell: None,
                session_id: Some("test".to_string()), limit: None,
            }, Some(crate::models::PtySessionInfo {
                id: "test".to_string(), shell: "powershell.exe".to_string(),
                cwd: Some(dir.path().to_string_lossy().into_owned()), status: "running".to_string(),
            })).unwrap()
        };
        let path = run("cd ./ola", 8);
        assert_eq!(path.replacement_start, 3);
        assert_eq!(path.replacement_end, 8);
        assert!(path.candidates[0].value.starts_with("'"));
        assert!(path.candidates[0].value.contains("ola documents"));
        let parameter = run("Get-ChildItem -Filt -Force", 19);
        assert_eq!(parameter.replacement_end, 19);
        assert_eq!(parameter.candidates[0].value, "-Filter");
        assert!(run("cd ./no-such-directory", 22).candidates.is_empty());
    }

    #[test]
    fn malformed_utf16_cursor_is_clamped_to_a_character_boundary() {
        assert_eq!(super::byte_offset_for_utf16("🦀x", 1), 0);
        assert_eq!(super::byte_offset_for_utf16("🦀x", 2), 4);
        assert_eq!(super::byte_offset_for_utf16("🦀x", usize::MAX), 5);
        let token = token_at_cursor("à", super::byte_offset_for_utf16("à", 1));
        assert_eq!(token.raw, "à");
        let token = token_at_cursor("echo\u{a0}文件", "echo\u{a0}文件".len());
        assert_eq!(token.raw, "文件");
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
