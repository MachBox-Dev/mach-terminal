//! Built-in MCP stdio Client Bridge for Mach Terminal's AI panel.
//! Connects to configured local MCP servers (e.g. `mach-triage-mcp`, `mach-armory-mcp`,
//! `mach-terminal-mcp`, or custom stdio servers) over JSON-RPC 2.0 stdin/stdout to list
//! and execute tools during AI tool-calling rounds.

use crate::models::{McpClientServerConfig, McpClientToolCallResult, McpClientToolDescriptor};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::path::PathBuf;
use std::process::Stdio;
use std::time::Duration;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::Command;
use tokio::time::timeout;

const MCP_REQUEST_TIMEOUT: Duration = Duration::from_secs(12);
const MCP_TOOL_NAMESPACE_PREFIX: &str = "mcp__";

#[derive(Serialize)]
struct JsonRpcRequest {
    jsonrpc: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    id: Option<u64>,
    method: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    params: Option<Value>,
}

#[derive(Deserialize, Debug)]
struct JsonRpcResponse {
    #[allow(dead_code)]
    jsonrpc: Option<String>,
    id: Option<Value>,
    result: Option<Value>,
    error: Option<JsonRpcErrorPayload>,
}

#[derive(Deserialize, Debug)]
struct JsonRpcErrorPayload {
    #[allow(dead_code)]
    code: i64,
    message: String,
}

/// Sanitize a server ID so it can be embedded in an OpenAI/Anthropic function name
/// (`^[a-zA-Z0-9_-]{1,64}$`).
pub fn sanitize_mcp_identifier(raw: &str) -> String {
    let mut out = String::with_capacity(raw.len());
    for ch in raw.chars() {
        if ch.is_ascii_alphanumeric() || ch == '-' {
            out.push(ch);
        } else if ch == '_' || ch.is_whitespace() || ch == '.' {
            out.push('-');
        }
    }
    let trimmed = out.trim_matches('-').to_string();
    if trimmed.is_empty() {
        "server".to_string()
    } else {
        trimmed
    }
}

pub fn build_qualified_tool_name(server_id: &str, tool_name: &str) -> String {
    let clean_server = sanitize_mcp_identifier(server_id);
    format!("{MCP_TOOL_NAMESPACE_PREFIX}{clean_server}__{tool_name}")
}

pub fn parse_qualified_tool_name(qualified: &str) -> Option<(String, String)> {
    let rest = qualified.strip_prefix(MCP_TOOL_NAMESPACE_PREFIX)?;
    let (server_id, tool_name) = rest.split_once("__")?;
    if server_id.is_empty() || tool_name.is_empty() {
        return None;
    }
    Some((server_id.to_string(), tool_name.to_string()))
}

pub fn resolve_terminal_mcp_sidecar_path() -> Option<String> {
    let exe = std::env::current_exe().ok()?;
    let dir = exe.parent()?;
    let ext = if cfg!(windows) { ".exe" } else { "" };

    let mut candidates: Vec<PathBuf> = vec![
        dir.join(format!("mach-terminal-mcp{ext}")),
        dir.join("bin").join(format!("mach-terminal-mcp{ext}")),
        dir.join("..").join("target").join("debug").join(format!("mach-terminal-mcp{ext}")),
        dir.join("..").join("target").join("release").join(format!("mach-terminal-mcp{ext}")),
    ];

    if let Ok(entries) = std::fs::read_dir(dir) {
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().to_string();
            if name.starts_with("mach-terminal-mcp") && name.ends_with(ext) {
                candidates.push(entry.path());
            }
        }
    }
    let bin_dir = dir.join("..").join("bin");
    if let Ok(entries) = std::fs::read_dir(&bin_dir) {
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().to_string();
            if name.starts_with("mach-terminal-mcp") && name.ends_with(ext) {
                candidates.push(entry.path());
            }
        }
    }

    for candidate in candidates {
        if candidate.exists() {
            return Some(candidate.to_string_lossy().into_owned());
        }
    }
    None
}

fn configure_command(server: &McpClientServerConfig) -> Result<Command, String> {
    let cmd_str = server.command.trim();
    if cmd_str.is_empty() {
        return Err(format!("MCP server `{}` has an empty command", server.id));
    }
    let mut cmd = Command::new(cmd_str);
    cmd.args(&server.args)
        .envs(&server.env)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .kill_on_drop(true);

    #[cfg(windows)]
    {
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    Ok(cmd)
}

async fn send_rpc_line(
    stdin: &mut tokio::process::ChildStdin,
    req: &JsonRpcRequest,
) -> Result<(), String> {
    let mut line = serde_json::to_string(req).map_err(|e| format!("failed to encode MCP request: {e}"))?;
    line.push('\n');
    stdin
        .write_all(line.as_bytes())
        .await
        .map_err(|e| format!("failed to write to MCP server stdin: {e}"))?;
    stdin
        .flush()
        .await
        .map_err(|e| format!("failed to flush MCP server stdin: {e}"))?;
    Ok(())
}

async fn read_rpc_response(
    stdout: &mut BufReader<tokio::process::ChildStdout>,
    expected_id: u64,
) -> Result<Value, String> {
    let mut line = String::new();
    loop {
        line.clear();
        let bytes_read = timeout(MCP_REQUEST_TIMEOUT, stdout.read_line(&mut line))
            .await
            .map_err(|_| "MCP server timed out waiting for response".to_string())?
            .map_err(|e| format!("failed reading MCP server stdout: {e}"))?;
        if bytes_read == 0 {
            return Err("MCP server closed stdout unexpectedly".to_string());
        }
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        let parsed: JsonRpcResponse = match serde_json::from_str(trimmed) {
            Ok(p) => p,
            Err(_) => continue,
        };
        let matches_id = parsed
            .id
            .as_ref()
            .and_then(|v| v.as_u64())
            .is_some_and(|id| id == expected_id);
        if !matches_id {
            continue;
        }
        if let Some(err) = parsed.error {
            return Err(err.message);
        }
        return Ok(parsed.result.unwrap_or_else(|| json!({})));
    }
}

async fn run_mcp_session<T, F, Fut>(
    server: &McpClientServerConfig,
    action: F,
) -> Result<T, String>
where
    F: FnOnce(tokio::process::ChildStdin, BufReader<tokio::process::ChildStdout>) -> Fut,
    Fut: std::future::Future<Output = Result<T, String>>,
{
    let mut cmd = configure_command(server)?;
    let mut child = cmd
        .spawn()
        .map_err(|e| format!("failed to spawn MCP server `{}` (`{}`): {e}", server.name, server.command))?;

    let mut stdin = child
        .stdin
        .take()
        .ok_or_else(|| "failed to capture MCP child stdin".to_string())?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "failed to capture MCP child stdout".to_string())?;
    let mut reader = BufReader::new(stdout);

    send_rpc_line(
        &mut stdin,
        &JsonRpcRequest {
            jsonrpc: "2.0",
            id: Some(1),
            method: "initialize".to_string(),
            params: Some(json!({
                "protocolVersion": "2025-03-26",
                "capabilities": {},
                "clientInfo": {
                    "name": "mach-terminal-mcp-client",
                    "version": env!("CARGO_PKG_VERSION")
                }
            })),
        },
    )
    .await?;

    let _init_result = read_rpc_response(&mut reader, 1).await?;

    send_rpc_line(
        &mut stdin,
        &JsonRpcRequest {
            jsonrpc: "2.0",
            id: None,
            method: "notifications/initialized".to_string(),
            params: Some(json!({})),
        },
    )
    .await?;

    let result = action(stdin, reader).await;
    let _ = child.kill().await;
    result
}

pub async fn discover_server_tools(
    server: &McpClientServerConfig,
) -> Result<Vec<McpClientToolDescriptor>, String> {
    let server_id = server.id.clone();
    let server_name = server.name.clone();

    run_mcp_session(server, |mut stdin, mut reader| async move {
        send_rpc_line(
            &mut stdin,
            &JsonRpcRequest {
                jsonrpc: "2.0",
                id: Some(2),
                method: "tools/list".to_string(),
                params: Some(json!({})),
            },
        )
        .await?;

        let list_result = read_rpc_response(&mut reader, 2).await?;
        let tools_arr = list_result
            .get("tools")
            .and_then(|t| t.as_array())
            .cloned()
            .unwrap_or_default();

        let mut descriptors = Vec::with_capacity(tools_arr.len());
        for raw_tool in tools_arr {
            let Some(name) = raw_tool.get("name").and_then(|v| v.as_str()).map(str::trim) else {
                continue;
            };
            if name.is_empty() {
                continue;
            }
            let description = raw_tool
                .get("description")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .trim()
                .to_string();
            let input_schema = raw_tool
                .get("inputSchema")
                .cloned()
                .unwrap_or_else(|| json!({"type": "object", "properties": {}}));
            descriptors.push(McpClientToolDescriptor {
                server_id: server_id.clone(),
                server_name: server_name.clone(),
                tool_name: name.to_string(),
                qualified_name: build_qualified_tool_name(&server_id, name),
                description,
                input_schema,
            });
        }
        Ok(descriptors)
    })
    .await
}

pub async fn call_server_tool(
    server: &McpClientServerConfig,
    tool_name: &str,
    arguments: Value,
) -> Result<McpClientToolCallResult, String> {
    let tool_name_owned = tool_name.to_string();
    let server_id = server.id.clone();

    run_mcp_session(server, |mut stdin, mut reader| async move {
        send_rpc_line(
            &mut stdin,
            &JsonRpcRequest {
                jsonrpc: "2.0",
                id: Some(2),
                method: "tools/call".to_string(),
                params: Some(json!({
                    "name": tool_name_owned,
                    "arguments": arguments,
                })),
            },
        )
        .await?;

        let call_result = read_rpc_response(&mut reader, 2).await?;
        let is_error = call_result
            .get("isError")
            .and_then(|v| v.as_bool())
            .unwrap_or(false);

        let mut text_parts: Vec<String> = Vec::new();
        if let Some(content_arr) = call_result.get("content").and_then(|c| c.as_array()) {
            for item in content_arr {
                if let Some(text) = item.get("text").and_then(|t| t.as_str()) {
                    text_parts.push(text.to_string());
                } else {
                    text_parts.push(item.to_string());
                }
            }
        } else {
            text_parts.push(
                serde_json::to_string_pretty(&call_result)
                    .unwrap_or_else(|_| call_result.to_string()),
            );
        }

        Ok(McpClientToolCallResult {
            server_id,
            tool_name: tool_name_owned,
            output: text_parts.join("\n"),
            is_error,
        })
    })
    .await
}

pub fn find_enabled_server_by_id_or_sanitized<'a>(
    servers: &'a [McpClientServerConfig],
    id_or_sanitized: &str,
) -> Option<&'a McpClientServerConfig> {
    let sanitized_target = sanitize_mcp_identifier(id_or_sanitized);
    servers.iter().find(|s| {
        s.enabled
            && (s.id == id_or_sanitized || sanitize_mcp_identifier(&s.id) == sanitized_target)
    })
}

pub fn validate_mcp_client_servers(servers: &[McpClientServerConfig]) -> Result<(), String> {
    let mut seen: HashMap<String, String> = HashMap::new();
    for server in servers {
        if server.id.trim().is_empty() {
            return Err("MCP server id is required".to_string());
        }
        if server.name.trim().is_empty() {
            return Err("MCP server name is required".to_string());
        }
        if server.command.trim().is_empty() {
            return Err(format!("MCP server `{}` command is required", server.name));
        }
        let sanitized = sanitize_mcp_identifier(&server.id);
        if let Some(existing) = seen.insert(sanitized, server.id.clone()) {
            return Err(format!(
                "duplicate or colliding MCP server id `{}` (collides with `{existing}`)",
                server.id
            ));
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn qualifies_and_parses_mcp_tool_names() {
        let q = build_qualified_tool_name("mach_triage", "list_tickets");
        assert_eq!(q, "mcp__mach-triage__list_tickets");
        let parsed = parse_qualified_tool_name(&q).unwrap();
        assert_eq!(parsed.0, "mach-triage");
        assert_eq!(parsed.1, "list_tickets");
        assert!(parse_qualified_tool_name("list_command_runs").is_none());
    }

    #[test]
    fn validates_duplicate_or_colliding_server_ids() {
        let servers = vec![
            McpClientServerConfig {
                id: "mach-triage".into(),
                name: "Mach Triage".into(),
                command: "mach-triage-mcp".into(),
                args: vec![],
                env: HashMap::new(),
                enabled: true,
            },
            McpClientServerConfig {
                id: "mach_triage".into(),
                name: "Mach Triage 2".into(),
                command: "mach-triage-mcp".into(),
                args: vec![],
                env: HashMap::new(),
                enabled: true,
            },
        ];
        let err = validate_mcp_client_servers(&servers).unwrap_err();
        assert!(err.contains("duplicate or colliding"));
    }
}
