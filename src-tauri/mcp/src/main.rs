//! Model Context Protocol (MCP) stdio Server for Mach Terminal
//! Exposes command history, workspace tabs/sessions, shell presets, terminal profile,
//! and deep-link handoffs (`machterm://composer` and `machterm://ai-note`) to AI agents.
//! Communicates via JSON-RPC 2.0 over stdin/stdout.

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::Command;
use tokio::io::{AsyncBufReadExt, BufReader};
use url::Url;

#[derive(Deserialize, Debug)]
struct JsonRpcRequest {
    #[allow(dead_code)]
    jsonrpc: String,
    id: Option<Value>,
    method: String,
    params: Option<Value>,
}

#[derive(Serialize, Debug)]
struct JsonRpcResponse {
    jsonrpc: String,
    id: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    result: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<JsonRpcError>,
}

#[derive(Serialize, Debug)]
struct JsonRpcError {
    code: i32,
    message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    data: Option<Value>,
}

impl JsonRpcResponse {
    fn success(id: Option<Value>, result: Value) -> Self {
        Self {
            jsonrpc: "2.0".to_string(),
            id,
            result: Some(result),
            error: None,
        }
    }

    fn error(id: Option<Value>, code: i32, message: String) -> Self {
        Self {
            jsonrpc: "2.0".to_string(),
            id,
            result: None,
            error: Some(JsonRpcError {
                code,
                message,
                data: None,
            }),
        }
    }
}

#[derive(Deserialize, Debug)]
struct InitializeParams {
    #[serde(rename = "protocolVersion")]
    protocol_version: Option<String>,
}

const SUPPORTED_PROTOCOL_VERSIONS: &[&str] = &["2024-11-05", "2025-03-26"];

fn negotiate_protocol_version(requested: Option<&str>) -> &'static str {
    if let Some(version) = requested {
        for supported in SUPPORTED_PROTOCOL_VERSIONS {
            if *supported == version {
                return supported;
            }
        }
    }
    "2024-11-05"
}

fn is_notification(id: &Option<Value>) -> bool {
    id.is_none()
}

#[derive(Deserialize, Serialize, Debug, Clone)]
struct HistoryEntry {
    id: u64,
    session_id: String,
    command: String,
    timestamp_ms: u64,
}

#[derive(Deserialize, Debug)]
struct HistoryFile {
    #[serde(default)]
    entries: Vec<HistoryEntry>,
}

#[derive(Deserialize, Debug)]
struct QueryCommandHistoryArgs {
    query: Option<String>,
    session_id: Option<String>,
    limit: Option<usize>,
}

#[derive(Deserialize, Debug)]
struct SendToComposerArgs {
    text: String,
    label: Option<String>,
    open_deep_link: Option<bool>,
}

#[derive(Deserialize, Debug)]
struct SendAiNoteArgs {
    text: String,
    label: Option<String>,
    open_deep_link: Option<bool>,
}

fn resolve_config_dir() -> Result<PathBuf, String> {
    let mut args = std::env::args();
    while let Some(arg) = args.next() {
        if arg == "--config-dir" {
            if let Some(p) = args.next() {
                return Ok(PathBuf::from(p));
            }
        }
    }
    if let Ok(env_dir) = std::env::var("MACH_TERMINAL_CONFIG_DIR") {
        if !env_dir.trim().is_empty() {
            return Ok(PathBuf::from(env_dir));
        }
    }
    let base = dirs::config_dir().ok_or_else(|| "Could not resolve OS config directory".to_string())?;
    Ok(base.join("com.machbox.terminal"))
}

fn read_settings_json(config_dir: &Path) -> Value {
    let path = config_dir.join("settings.json");
    fs::read_to_string(path)
        .ok()
        .and_then(|raw| serde_json::from_str(&raw).ok())
        .unwrap_or_else(|| json!({}))
}

fn is_mcp_server_enabled(config_dir: &Path) -> bool {
    if let Ok(val) = std::env::var("MACH_TERMINAL_MCP_ENABLED") {
        let trimmed = val.trim();
        if trimmed == "1" || trimmed.eq_ignore_ascii_case("true") {
            return true;
        }
        if trimmed == "0" || trimmed.eq_ignore_ascii_case("false") {
            return false;
        }
    }
    let settings = read_settings_json(config_dir);
    settings
        .get("mcp")
        .and_then(|m| m.get("serverEnabled").or_else(|| m.get("server_enabled")))
        .and_then(|v| v.as_bool())
        .unwrap_or(false)
}

fn tools_definitions() -> Value {
    json!([
        {
            "name": "query_command_history",
            "description": "Search or list recent terminal commands from Mach Terminal's persisted command history.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": "Optional case-insensitive substring filter for command text."
                    },
                    "session_id": {
                        "type": "string",
                        "description": "Optional session ID filter."
                    },
                    "limit": {
                        "type": "integer",
                        "description": "Maximum number of commands to return (default: 50, max: 200)."
                    }
                }
            }
        },
        {
            "name": "list_workspace_sessions",
            "description": "List persisted workspace tabs, pane groups, and restorable shell sessions (shell, args, cwd, custom tab name, inputMode) from Mach Terminal.",
            "inputSchema": {
                "type": "object",
                "properties": {}
            }
        },
        {
            "name": "list_shell_presets",
            "description": "List saved shell launch presets configured in Mach Terminal.",
            "inputSchema": {
                "type": "object",
                "properties": {}
            }
        },
        {
            "name": "get_terminal_profile",
            "description": "Retrieve Mach Terminal's default shell profile (shell, args, cwd, font_size, minimal_shell_prompt) and AI provider routing summary.",
            "inputSchema": {
                "type": "object",
                "properties": {}
            }
        },
        {
            "name": "send_to_composer",
            "description": "Stage a command or multi-line snippet in Mach Terminal's command composer via the machterm://composer deep link (never auto-executed; user reviews and presses Enter).",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "text": {
                        "type": "string",
                        "description": "Command or newline-separated commands to place in the composer draft (max 6000 chars)."
                    },
                    "label": {
                        "type": "string",
                        "description": "Optional source label shown alongside the composer draft."
                    },
                    "open_deep_link": {
                        "type": "boolean",
                        "description": "Whether to invoke the OS URL opener for machterm://composer immediately (default: true)."
                    }
                },
                "required": ["text"]
            }
        },
        {
            "name": "send_ai_note",
            "description": "Send context or a note into Mach Terminal's AI panel as a reviewable attachment via the machterm://ai-note deep link.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "text": {
                        "type": "string",
                        "description": "Note or context text to attach in Mach Terminal's AI panel (max 6000 chars)."
                    },
                    "label": {
                        "type": "string",
                        "description": "Optional label for the AI context attachment chip."
                    },
                    "open_deep_link": {
                        "type": "boolean",
                        "description": "Whether to invoke the OS URL opener for machterm://ai-note immediately (default: true)."
                    }
                },
                "required": ["text"]
            }
        }
    ])
}

fn build_machterm_url(host: &str, text: &str, label: Option<&str>) -> Result<String, String> {
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return Err("text cannot be empty".to_string());
    }
    let capped: String = trimmed.chars().take(6000).collect();
    let mut url = Url::parse(&format!("machterm://{host}"))
        .map_err(|e| format!("failed to build machterm URL: {e}"))?;
    {
        let mut pairs = url.query_pairs_mut();
        pairs.append_pair("text", &capped);
        if let Some(l) = label.map(str::trim).filter(|s| !s.is_empty()) {
            pairs.append_pair("label", l);
        }
    }
    Ok(url.to_string())
}

fn launch_os_url(url: &str) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        Command::new("cmd")
            .args(["/C", "start", "", url])
            .spawn()
            .map_err(|e| format!("failed to launch deep link via cmd: {e}"))?;
        return Ok(());
    }
    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .arg(url)
            .spawn()
            .map_err(|e| format!("failed to launch deep link via open: {e}"))?;
        return Ok(());
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        Command::new("xdg-open")
            .arg(url)
            .spawn()
            .map_err(|e| format!("failed to launch deep link via xdg-open: {e}"))?;
        return Ok(());
    }
}

fn wrap_text_content(val: &Value) -> Value {
    json!({
        "content": [
            {
                "type": "text",
                "text": serde_json::to_string_pretty(val).unwrap_or_else(|_| val.to_string())
            }
        ]
    })
}

fn execute_tool(name: &str, args: Value, config_dir: &Path) -> Result<Value, String> {
    match name {
        "query_command_history" => {
            let parsed: QueryCommandHistoryArgs = serde_json::from_value(args).unwrap_or(QueryCommandHistoryArgs {
                query: None,
                session_id: None,
                limit: None,
            });
            let limit = parsed.limit.unwrap_or(50).clamp(1, 200);
            let history_path = std::env::var("MACH_TERMINAL_HISTORY_DIR")
                .ok()
                .filter(|s| !s.trim().is_empty())
                .map(PathBuf::from)
                .unwrap_or_else(|| config_dir.to_path_buf())
                .join("command_history.json");

            let entries: Vec<HistoryEntry> = if history_path.exists() {
                let raw = fs::read_to_string(&history_path)
                    .map_err(|e| format!("Failed to read command history: {e}"))?;
                let file: HistoryFile = serde_json::from_str(&raw)
                    .map_err(|e| format!("Failed to parse command history: {e}"))?;
                file.entries
            } else {
                Vec::new()
            };

            let q_lower = parsed
                .query
                .as_deref()
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .map(str::to_lowercase);
            let sid_filter = parsed
                .session_id
                .as_deref()
                .map(str::trim)
                .filter(|s| !s.is_empty());

            let filtered: Vec<HistoryEntry> = entries
                .into_iter()
                .rev()
                .filter(|e| {
                    if let Some(sid) = sid_filter {
                        if e.session_id != sid {
                            return false;
                        }
                    }
                    if let Some(ref q) = q_lower {
                        if !e.command.to_lowercase().contains(q) {
                            return false;
                        }
                    }
                    true
                })
                .take(limit)
                .collect();

            Ok(wrap_text_content(&json!({
                "count": filtered.len(),
                "entries": filtered,
            })))
        }
        "list_workspace_sessions" => {
            let layout_path = config_dir.join("workspace_layout.json");
            if !layout_path.exists() {
                return Ok(wrap_text_content(&json!({
                    "sessions": [],
                    "groups": [],
                    "activeGroupId": null
                })));
            }
            let raw = fs::read_to_string(&layout_path)
                .map_err(|e| format!("Failed to read workspace layout: {e}"))?;
            let layout: Value = serde_json::from_str(&raw)
                .map_err(|e| format!("Failed to parse workspace layout: {e}"))?;
            Ok(wrap_text_content(&json!({
                "schemaVersion": layout.get("schemaVersion").cloned().unwrap_or(json!(2)),
                "activeGroupId": layout.get("activeGroupId").cloned().unwrap_or(Value::Null),
                "sessions": layout.get("sessions").cloned().unwrap_or_else(|| json!([])),
                "groups": layout.get("groups").cloned().unwrap_or_else(|| json!([])),
            })))
        }
        "list_shell_presets" => {
            let settings = read_settings_json(config_dir);
            let presets = settings
                .get("shell_presets")
                .cloned()
                .unwrap_or_else(|| json!([]));
            Ok(wrap_text_content(&json!({
                "presets": presets
            })))
        }
        "get_terminal_profile" => {
            let settings = read_settings_json(config_dir);
            let profile = settings.get("profile").cloned().unwrap_or_else(|| json!({}));
            let routing = settings.get("provider_routing").cloned().unwrap_or_else(|| json!({}));
            Ok(wrap_text_content(&json!({
                "profile": profile,
                "provider_routing": {
                    "default_provider": routing.get("default_provider"),
                    "ai_feature_enabled": routing.get("ai_feature_enabled"),
                }
            })))
        }
        "send_to_composer" => {
            let parsed: SendToComposerArgs = serde_json::from_value(args).map_err(|e| e.to_string())?;
            let url = build_machterm_url("composer", &parsed.text, parsed.label.as_deref())?;
            let should_open = parsed.open_deep_link.unwrap_or(true);
            let mut launched = false;
            let mut launch_error = None;
            if should_open {
                match launch_os_url(&url) {
                    Ok(()) => launched = true,
                    Err(e) => launch_error = Some(e),
                }
            }
            Ok(wrap_text_content(&json!({
                "deep_link": url,
                "launched": launched,
                "launch_error": launch_error,
            })))
        }
        "send_ai_note" => {
            let parsed: SendAiNoteArgs = serde_json::from_value(args).map_err(|e| e.to_string())?;
            let url = build_machterm_url("ai-note", &parsed.text, parsed.label.as_deref())?;
            let should_open = parsed.open_deep_link.unwrap_or(true);
            let mut launched = false;
            let mut launch_error = None;
            if should_open {
                match launch_os_url(&url) {
                    Ok(()) => launched = true,
                    Err(e) => launch_error = Some(e),
                }
            }
            Ok(wrap_text_content(&json!({
                "deep_link": url,
                "launched": launched,
                "launch_error": launch_error,
            })))
        }
        _ => Err(format!("Unknown tool name: {name}")),
    }
}

fn handle_request(req: JsonRpcRequest, config_dir: &Path) -> Option<JsonRpcResponse> {
    if is_notification(&req.id) {
        return match req.method.as_str() {
            "notifications/initialized" | "notifications/cancelled" => None,
            _ => None,
        };
    }

    let id = req.id.clone();
    Some(match req.method.as_str() {
        "initialize" => {
            if !is_mcp_server_enabled(config_dir) {
                return Some(JsonRpcResponse::error(
                    id,
                    -32000,
                    "MCP server is disabled in Mach Terminal settings.".to_string(),
                ));
            }
            let requested_version = req
                .params
                .as_ref()
                .and_then(|p| serde_json::from_value::<InitializeParams>(p.clone()).ok())
                .and_then(|p| p.protocol_version);
            let protocol_version = negotiate_protocol_version(requested_version.as_deref());

            JsonRpcResponse::success(
                id,
                json!({
                    "protocolVersion": protocol_version,
                    "capabilities": {
                        "tools": {}
                    },
                    "serverInfo": {
                        "name": "mach-terminal-mcp",
                        "version": env!("CARGO_PKG_VERSION")
                    }
                }),
            )
        }
        "ping" => JsonRpcResponse::success(id, json!({})),
        "resources/list" => JsonRpcResponse::success(id, json!({ "resources": [] })),
        "prompts/list" => JsonRpcResponse::success(id, json!({ "prompts": [] })),
        "tools/list" => {
            if !is_mcp_server_enabled(config_dir) {
                return Some(JsonRpcResponse::success(id, json!({ "tools": [] })));
            }
            JsonRpcResponse::success(id, json!({ "tools": tools_definitions() }))
        }
        "tools/call" => {
            if !is_mcp_server_enabled(config_dir) {
                return Some(JsonRpcResponse::error(
                    id,
                    -32000,
                    "MCP server is disabled in Mach Terminal settings.".to_string(),
                ));
            }
            let params = match req.params {
                Some(p) => p,
                None => return Some(JsonRpcResponse::error(id, -32602, "Missing params".to_string())),
            };
            let name = match params.get("name").and_then(|n| n.as_str()) {
                Some(n) => n,
                None => return Some(JsonRpcResponse::error(id, -32602, "Missing tool name".to_string())),
            };
            let arguments = params.get("arguments").cloned().unwrap_or(Value::Null);
            match execute_tool(name, arguments, config_dir) {
                Ok(result) => JsonRpcResponse::success(id, result),
                Err(e) => JsonRpcResponse::success(
                    id,
                    json!({
                        "content": [{"type": "text", "text": format!("Error executing tool: {e}")}],
                        "isError": true
                    }),
                ),
            }
        }
        _ => JsonRpcResponse::error(id, -32601, format!("Method not found: {}", req.method)),
    })
}

fn send_response(resp: &JsonRpcResponse) {
    if let Ok(serialized) = serde_json::to_string(resp) {
        let mut stdout = std::io::stdout();
        let _ = stdout.write_all(serialized.as_bytes());
        let _ = stdout.write_all(b"\n");
        let _ = stdout.flush();
    }
}

#[tokio::main]
async fn main() {
    let config_dir = match resolve_config_dir() {
        Ok(dir) => dir,
        Err(e) => {
            eprintln!("Error resolving Mach Terminal config dir: {e}");
            std::process::exit(1);
        }
    };

    let mut reader = BufReader::new(tokio::io::stdin());
    let mut line = String::new();

    loop {
        line.clear();
        match reader.read_line(&mut line).await {
            Ok(0) => break,
            Ok(_) => {
                let trimmed = line.trim();
                if trimmed.is_empty() {
                    continue;
                }
                let req: JsonRpcRequest = match serde_json::from_str(trimmed) {
                    Ok(r) => r,
                    Err(e) => {
                        eprintln!("MCP parse error: {e}");
                        continue;
                    }
                };
                if let Some(resp) = handle_request(req, &config_dir) {
                    send_response(&resp);
                }
            }
            Err(e) => {
                eprintln!("Error reading stdin: {e}");
                break;
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn gating_rejects_when_disabled_and_allows_when_enabled() {
        let dir = tempfile::tempdir().unwrap();
        let init_req = JsonRpcRequest {
            jsonrpc: "2.0".into(),
            id: Some(json!(1)),
            method: "initialize".into(),
            params: Some(json!({"protocolVersion": "2025-03-26"})),
        };
        let denied = handle_request(init_req, dir.path()).unwrap();
        assert!(denied.error.is_some());

        fs::write(
            dir.path().join("settings.json"),
            r#"{"mcp":{"serverEnabled":true},"profile":{"shell":"pwsh.exe","font_size":14},"shell_presets":[{"id":"p1","name":"Ubuntu","shell":"wsl.exe","args":["-d","Ubuntu"]}]}"#,
        )
        .unwrap();

        let init_ok = handle_request(
            JsonRpcRequest {
                jsonrpc: "2.0".into(),
                id: Some(json!(2)),
                method: "initialize".into(),
                params: Some(json!({"protocolVersion": "2025-03-26"})),
            },
            dir.path(),
        )
        .unwrap();
        assert_eq!(
            init_ok.result.unwrap()["protocolVersion"],
            json!("2025-03-26")
        );
    }

    #[test]
    fn history_sessions_presets_and_deep_link_tools_work() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(
            dir.path().join("settings.json"),
            r#"{"mcp":{"serverEnabled":true},"profile":{"shell":"pwsh.exe","font_size":14},"shell_presets":[{"id":"p1","name":"Ubuntu","shell":"wsl.exe","args":["-d","Ubuntu"]}]}"#,
        )
        .unwrap();
        fs::write(
            dir.path().join("command_history.json"),
            r#"{"entries":[{"id":1,"session_id":"session-1","command":"cargo test --workspace","timestamp_ms":1000},{"id":2,"session_id":"session-2","command":"git status -sb","timestamp_ms":2000}]}"#,
        )
        .unwrap();
        fs::write(
            dir.path().join("workspace_layout.json"),
            r#"{"schemaVersion":2,"activeGroupId":"g1","sessions":[{"sessionId":"session-1","shell":"pwsh.exe","cwd":"C:\\dev"}],"groups":[]}"#,
        )
        .unwrap();

        let hist = execute_tool(
            "query_command_history",
            json!({"query": "cargo"}),
            dir.path(),
        )
        .unwrap();
        let hist_json: Value =
            serde_json::from_str(hist["content"][0]["text"].as_str().unwrap()).unwrap();
        assert_eq!(hist_json["count"], 1);
        assert_eq!(hist_json["entries"][0]["command"], "cargo test --workspace");

        let ws = execute_tool("list_workspace_sessions", json!({}), dir.path()).unwrap();
        let ws_json: Value =
            serde_json::from_str(ws["content"][0]["text"].as_str().unwrap()).unwrap();
        assert_eq!(ws_json["sessions"].as_array().unwrap().len(), 1);

        let presets = execute_tool("list_shell_presets", json!({}), dir.path()).unwrap();
        let presets_json: Value =
            serde_json::from_str(presets["content"][0]["text"].as_str().unwrap()).unwrap();
        assert_eq!(presets_json["presets"].as_array().unwrap().len(), 1);

        let comp = execute_tool(
            "send_to_composer",
            json!({"text": "echo hello", "label": "MCP", "open_deep_link": false}),
            dir.path(),
        )
        .unwrap();
        let comp_json: Value =
            serde_json::from_str(comp["content"][0]["text"].as_str().unwrap()).unwrap();
        assert_eq!(
            comp_json["deep_link"],
            "machterm://composer?text=echo+hello&label=MCP"
        );

        let note = execute_tool(
            "send_ai_note",
            json!({"text": "Check the logs", "label": "Triage", "open_deep_link": false}),
            dir.path(),
        )
        .unwrap();
        let note_json: Value =
            serde_json::from_str(note["content"][0]["text"].as_str().unwrap()).unwrap();
        assert_eq!(
            note_json["deep_link"],
            "machterm://ai-note?text=Check+the+logs&label=Triage"
        );
    }
}
