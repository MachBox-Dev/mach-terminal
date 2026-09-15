use crate::models::{
    AiChatTurn, AiExecuteRequest, AiExecuteResponse, AiPromptContext, AiProviderMessage, AiToolCall,
    AppSettings, ProviderDescriptor, ProviderRoutingSettings, ProviderSettings,
};
use crate::provider_secrets;
use reqwest::{Client, Url};
use serde::{Deserialize, Serialize};
use std::env;
use std::fmt;
use std::time::Duration;
use tracing::{info, instrument, warn};

#[derive(Debug, Serialize)]
struct OllamaChatRequest {
    model: String,
    messages: Vec<OpenAiCompatibleMessage>,
    stream: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    tools: Option<serde_json::Value>,
}

#[derive(Debug, Deserialize)]
struct OllamaChatResponse {
    message: OllamaChatResponseMessage,
}

#[derive(Debug, Deserialize)]
struct OllamaChatResponseMessage {
    #[serde(default)]
    content: String,
    #[serde(default)]
    tool_calls: Option<Vec<OpenAiToolCallResponse>>,
}

#[derive(Debug, Clone, Serialize)]
struct OpenAiToolCallFunctionPayload {
    name: String,
    arguments: String,
}

#[derive(Debug, Clone, Serialize)]
struct OpenAiToolCallPayload {
    id: String,
    #[serde(rename = "type")]
    kind: String,
    function: OpenAiToolCallFunctionPayload,
}

#[derive(Debug, Clone, Serialize)]
pub(crate) struct OpenAiCompatibleMessage {
    role: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    content: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    tool_call_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    tool_calls: Option<Vec<OpenAiToolCallPayload>>,
}

#[derive(Debug, Serialize)]
struct OpenAiCompatibleChatRequest {
    model: String,
    messages: Vec<OpenAiCompatibleMessage>,
    stream: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    tools: Option<serde_json::Value>,
}

#[derive(Debug, Deserialize)]
struct OpenAiCompatibleChatResponse {
    choices: Vec<OpenAiCompatibleChoice>,
}

#[derive(Debug, Deserialize)]
struct OpenAiCompatibleChoice {
    message: OpenAiCompatibleChoiceMessage,
    #[serde(default)]
    finish_reason: Option<String>,
}

#[derive(Debug, Deserialize)]
struct OpenAiCompatibleChoiceMessage {
    #[serde(default)]
    content: serde_json::Value,
    #[serde(default)]
    tool_calls: Option<Vec<OpenAiToolCallResponse>>,
}

#[derive(Debug, Deserialize)]
struct OpenAiToolCallResponse {
    id: String,
    function: OpenAiToolCallFunctionResponse,
}

#[derive(Debug, Deserialize)]
struct OpenAiToolCallFunctionResponse {
    name: String,
    arguments: String,
}

struct OpenAiChatResult {
    output: String,
    tool_calls: Option<Vec<AiToolCall>>,
    finish_reason: Option<String>,
}

#[derive(Debug, Serialize)]
struct AnthropicToolDefinition {
    name: String,
    description: String,
    input_schema: serde_json::Value,
}

#[derive(Debug, Serialize)]
struct AnthropicMessagesRequest {
    model: String,
    max_tokens: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    system: Option<String>,
    messages: Vec<AnthropicInputMessage>,
    #[serde(skip_serializing_if = "Option::is_none")]
    tools: Option<Vec<AnthropicToolDefinition>>,
}

#[derive(Debug, Serialize)]
struct AnthropicInputMessage {
    role: String,
    content: serde_json::Value,
}

#[derive(Debug, Deserialize)]
struct AnthropicMessagesResponse {
    content: Vec<AnthropicContentBlock>,
    #[serde(default)]
    stop_reason: Option<String>,
}

#[derive(Debug, Deserialize)]
struct AnthropicContentBlock {
    #[serde(rename = "type")]
    kind: String,
    #[serde(default)]
    text: Option<String>,
    #[serde(default)]
    id: Option<String>,
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    input: Option<serde_json::Value>,
}

fn provider_name(provider_id: &str) -> &'static str {
    match provider_id {
        "openai" => "OpenAI",
        "anthropic" => "Anthropic",
        "ollama" => "Ollama (localhost)",
        "custom-openai" => "Custom OpenAI-compatible",
        _ => "Unknown provider",
    }
}

fn provider_kind(provider_id: &str) -> &'static str {
    match provider_id {
        "ollama" => "local",
        "custom-openai" => "custom",
        _ => "cloud",
    }
}

#[instrument(skip(providers))]
pub fn provider_descriptors(providers: &[ProviderSettings]) -> Vec<ProviderDescriptor> {
    providers
        .iter()
        .map(|provider| ProviderDescriptor {
            id: provider.id.clone(),
            name: provider_name(&provider.id).to_string(),
            kind: provider_kind(&provider.id).to_string(),
            enabled: provider.enabled,
            endpoint: provider.endpoint.clone(),
            env_hint: provider.api_key_env.clone(),
            status: if provider.enabled {
                "available".to_string()
            } else {
                "disabled".to_string()
            },
            has_stored_key: false,
        })
        .collect()
}

fn resolve_provider(settings: &AppSettings, requested: Option<&str>) -> Result<ProviderSettings, String> {
    let route_to = requested
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(settings.provider_routing.default_provider.as_str());
    settings
        .providers
        .iter()
        .find(|provider| provider.id == route_to)
        .cloned()
        .ok_or_else(|| AiExecutionError::ProviderNotConfigured(route_to.to_string()).to_string())
}

#[derive(Debug)]
enum AiExecutionError {
    RoutingDisabled,
    ProviderNotConfigured(String),
    ProviderDisabled(String),
    ProviderAuthMissing(String),
    ProviderSecretUnavailable(String),
    ProviderAdapterMissing(String),
    InvalidEndpoint(String),
    EndpointUnreachable(String),
    UpstreamStatus(String),
    DecodeFailure(String),
}

impl fmt::Display for AiExecutionError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            AiExecutionError::RoutingDisabled => write!(
                f,
                "AI routing is disabled. Enable AI opt-in in provider routing settings before sending AI requests."
            ),
            AiExecutionError::ProviderNotConfigured(provider_id) => {
                write!(f, "Provider `{provider_id}` is not configured.")
            }
            AiExecutionError::ProviderDisabled(provider_id) => write!(
                f,
                "Provider `{provider_id}` is disabled. Enable it in settings before sending AI requests."
            ),
            AiExecutionError::ProviderAuthMissing(provider_id) => write!(
                f,
                "Provider `{provider_id}` is missing credentials. Set an API key in settings or configure its environment variable."
            ),
            AiExecutionError::ProviderSecretUnavailable(message) => {
                write!(f, "Secure provider key storage is unavailable. {message}")
            }
            AiExecutionError::ProviderAdapterMissing(provider_id) => write!(
                f,
                "Provider `{provider_id}` is configured but has no execution adapter yet."
            ),
            AiExecutionError::InvalidEndpoint(message) => {
                write!(f, "Provider endpoint is invalid. {message}")
            }
            AiExecutionError::EndpointUnreachable(message) => {
                write!(f, "Provider endpoint is unreachable. {message}")
            }
            AiExecutionError::UpstreamStatus(message) => {
                write!(f, "Provider returned an error response. {message}")
            }
            AiExecutionError::DecodeFailure(message) => {
                write!(f, "Provider response could not be decoded. {message}")
            }
        }
    }
}

fn normalize_http_base_url(
    endpoint: Option<&str>,
    default_endpoint: Option<&str>,
) -> Result<Url, AiExecutionError> {
    let raw = endpoint
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .or(default_endpoint)
        .ok_or_else(|| AiExecutionError::InvalidEndpoint("endpoint is required".to_string()))?;
    let parsed = Url::parse(raw)
        .map_err(|error| AiExecutionError::InvalidEndpoint(format!("`{raw}` ({error})")))?;
    match parsed.scheme() {
        "http" | "https" => Ok(parsed),
        scheme => Err(AiExecutionError::InvalidEndpoint(format!(
            "`{raw}` uses unsupported scheme `{scheme}` (expected http or https)"
        ))),
    }
}

fn normalize_ollama_base_url(provider: &ProviderSettings) -> Result<Url, AiExecutionError> {
    normalize_http_base_url(provider.endpoint.as_deref(), Some("http://127.0.0.1:11434"))
}

fn provider_join_endpoint(base_url: Url, suffix: &str) -> Result<Url, AiExecutionError> {
    let base = base_url.as_str().trim_end_matches('/');
    let suffix = suffix.trim_start_matches('/');
    let endpoint = if base.ends_with(suffix) {
        base.to_string()
    } else if base.ends_with("/v1") && suffix.starts_with("v1/") {
        format!("{base}/{}", suffix.trim_start_matches("v1/"))
    } else if base.ends_with("/v1/") && suffix.starts_with("v1/") {
        format!("{}{}", base.trim_end_matches('/'), &suffix[2..])
    } else {
        format!("{base}/{suffix}")
    };
    Url::parse(&endpoint).map_err(|error| {
        AiExecutionError::InvalidEndpoint(format!("failed to construct provider endpoint `{endpoint}` ({error})"))
    })
}

fn normalize_openai_chat_url(provider: &ProviderSettings) -> Result<Url, AiExecutionError> {
    let default_endpoint = if provider.id == "custom-openai" {
        None
    } else {
        Some("https://api.openai.com")
    };
    let base_url = normalize_http_base_url(provider.endpoint.as_deref(), default_endpoint)?;
    provider_join_endpoint(base_url, "v1/chat/completions")
}

fn normalize_anthropic_messages_url(provider: &ProviderSettings) -> Result<Url, AiExecutionError> {
    let base_url = normalize_http_base_url(provider.endpoint.as_deref(), Some("https://api.anthropic.com"))?;
    provider_join_endpoint(base_url, "v1/messages")
}

fn resolve_provider_api_key(provider: &ProviderSettings) -> Result<String, AiExecutionError> {
    if let Some(secret) = provider_secrets::provider_api_key(&provider.id)
        .map_err(|error| AiExecutionError::ProviderSecretUnavailable(error.to_string()))?
        .filter(|value| !value.trim().is_empty())
    {
        return Ok(secret);
    }

    if let Some(env_key_name) = provider
        .api_key_env
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        if let Some(value) = env::var(env_key_name).ok().filter(|value| !value.trim().is_empty()) {
            return Ok(value);
        }
    }

    Err(AiExecutionError::ProviderAuthMissing(provider.id.clone()))
}

fn parse_openai_tool_calls(raw: Option<&[OpenAiToolCallResponse]>) -> Option<Vec<AiToolCall>> {
    let calls: Vec<AiToolCall> = raw
        .unwrap_or_default()
        .iter()
        .map(|call| AiToolCall {
            id: call.id.clone(),
            name: call.function.name.clone(),
            arguments: call.function.arguments.clone(),
        })
        .collect();
    if calls.is_empty() {
        None
    } else {
        Some(calls)
    }
}

fn provider_message_to_openai(msg: &AiProviderMessage) -> OpenAiCompatibleMessage {
    let tool_calls = msg.tool_calls.as_ref().map(|calls| {
        calls
            .iter()
            .map(|call| OpenAiToolCallPayload {
                id: call.id.clone(),
                kind: "function".to_string(),
                function: OpenAiToolCallFunctionPayload {
                    name: call.name.clone(),
                    arguments: call.arguments.clone(),
                },
            })
            .collect()
    });
    OpenAiCompatibleMessage {
        role: msg.role.clone(),
        content: msg.content.clone(),
        tool_call_id: msg.tool_call_id.clone(),
        name: msg.name.clone(),
        tool_calls,
    }
}

fn resolve_messages(
    request: &AiExecuteRequest,
    routing: &ProviderRoutingSettings,
) -> Vec<OpenAiCompatibleMessage> {
    if request.use_provider_messages {
        if let Some(provider_messages) = &request.provider_messages {
            let system = routing.system_prompt.trim();
            let mut messages: Vec<OpenAiCompatibleMessage> = Vec::new();
            if !system.is_empty() {
                messages.push(OpenAiCompatibleMessage {
                    role: "system".to_string(),
                    content: Some(system.to_string()),
                    tool_call_id: None,
                    name: None,
                    tool_calls: None,
                });
            }
            for message in provider_messages {
                messages.push(provider_message_to_openai(message));
            }
            return messages;
        }
    }
    build_provider_messages(request, routing)
}

fn finish_reason_for_result(
    tool_calls: &Option<Vec<AiToolCall>>,
    upstream: Option<&str>,
) -> Option<String> {
    if tool_calls.as_ref().is_some_and(|calls| !calls.is_empty()) {
        return Some("tool_calls".to_string());
    }
    upstream
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .or(Some("stop".to_string()))
}

fn openai_chat_result_from_choice(choice: &OpenAiCompatibleChoice) -> Result<OpenAiChatResult, String> {
    let tool_calls = parse_openai_tool_calls(choice.message.tool_calls.as_deref());
    let output = parse_openai_message_content(&choice.message.content).unwrap_or_default();
    if output.is_empty() && tool_calls.is_none() {
        return Err(
            AiExecutionError::DecodeFailure("missing response text or tool calls in provider payload".to_string())
                .to_string(),
        );
    }
    Ok(OpenAiChatResult {
        output,
        tool_calls: tool_calls.clone(),
        finish_reason: finish_reason_for_result(&tool_calls, choice.finish_reason.as_deref()),
    })
}

fn parse_openai_message_content(value: &serde_json::Value) -> Option<String> {
    match value {
        serde_json::Value::String(text) => Some(text.trim().to_string()),
        serde_json::Value::Array(parts) => {
            let mut out: Vec<String> = Vec::new();
            for part in parts {
                if let Some(text) = part
                    .get("text")
                    .and_then(serde_json::Value::as_str)
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                {
                    out.push(text.to_string());
                }
            }
            if out.is_empty() {
                None
            } else {
                Some(out.join("\n"))
            }
        }
        _ => None,
    }
}

fn parse_anthropic_text(blocks: &[AnthropicContentBlock]) -> Option<String> {
    let text: Vec<String> = blocks
        .iter()
        .filter(|block| block.kind == "text")
        .filter_map(|block| block.text.as_deref())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .collect();
    if text.is_empty() {
        None
    } else {
        Some(text.join("\n"))
    }
}

fn openai_tools_to_anthropic(tools: &serde_json::Value) -> Option<Vec<AnthropicToolDefinition>> {
    let entries = tools.as_array()?;
    let mut out: Vec<AnthropicToolDefinition> = Vec::new();
    for entry in entries {
        let function = entry.get("function")?;
        let name = function.get("name")?.as_str()?.trim();
        if name.is_empty() {
            continue;
        }
        let description = function
            .get("description")
            .and_then(serde_json::Value::as_str)
            .unwrap_or("")
            .trim()
            .to_string();
        let input_schema = function
            .get("parameters")
            .cloned()
            .unwrap_or_else(|| serde_json::json!({"type": "object", "properties": {}}));
        out.push(AnthropicToolDefinition {
            name: name.to_string(),
            description,
            input_schema,
        });
    }
    if out.is_empty() {
        None
    } else {
        Some(out)
    }
}

fn flush_anthropic_tool_results(
    pending: &mut Vec<serde_json::Value>,
    out: &mut Vec<AnthropicInputMessage>,
) {
    if pending.is_empty() {
        return;
    }
    out.push(AnthropicInputMessage {
        role: "user".to_string(),
        content: serde_json::Value::Array(pending.drain(..).collect()),
    });
}

fn openai_messages_to_anthropic(messages: &[OpenAiCompatibleMessage]) -> Vec<AnthropicInputMessage> {
    let mut out: Vec<AnthropicInputMessage> = Vec::new();
    let mut pending_tool_results: Vec<serde_json::Value> = Vec::new();

    for message in messages {
        if message.role == "system" {
            continue;
        }
        if message.role == "tool" {
            let tool_call_id = message.tool_call_id.clone().unwrap_or_default();
            let content = message.content.as_deref().unwrap_or("");
            pending_tool_results.push(serde_json::json!({
                "type": "tool_result",
                "tool_use_id": tool_call_id,
                "content": content,
            }));
            continue;
        }
        flush_anthropic_tool_results(&mut pending_tool_results, &mut out);

        if message.role == "user" {
            let content = message.content.as_deref().unwrap_or("").trim();
            if !content.is_empty() {
                out.push(AnthropicInputMessage {
                    role: "user".to_string(),
                    content: serde_json::Value::String(content.to_string()),
                });
            }
        } else if message.role == "assistant" {
            if let Some(tool_calls) = &message.tool_calls {
                let mut blocks: Vec<serde_json::Value> = Vec::new();
                if let Some(text) = message
                    .content
                    .as_deref()
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                {
                    blocks.push(serde_json::json!({ "type": "text", "text": text }));
                }
                for call in tool_calls {
                    let input = serde_json::from_str::<serde_json::Value>(&call.function.arguments)
                        .unwrap_or_else(|_| serde_json::json!({}));
                    blocks.push(serde_json::json!({
                        "type": "tool_use",
                        "id": call.id,
                        "name": call.function.name,
                        "input": input,
                    }));
                }
                if !blocks.is_empty() {
                    out.push(AnthropicInputMessage {
                        role: "assistant".to_string(),
                        content: serde_json::Value::Array(blocks),
                    });
                }
            } else if let Some(content) = message
                .content
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
            {
                out.push(AnthropicInputMessage {
                    role: "assistant".to_string(),
                    content: serde_json::Value::String(content.to_string()),
                });
            }
        }
    }
    flush_anthropic_tool_results(&mut pending_tool_results, &mut out);
    out
}

fn parse_anthropic_chat_result(
    blocks: &[AnthropicContentBlock],
    stop_reason: Option<&str>,
) -> Result<OpenAiChatResult, String> {
    let mut text_parts: Vec<String> = Vec::new();
    let mut tool_calls: Vec<AiToolCall> = Vec::new();

    for block in blocks {
        match block.kind.as_str() {
            "text" => {
                if let Some(text) = block.text.as_deref().map(str::trim).filter(|value| !value.is_empty()) {
                    text_parts.push(text.to_string());
                }
            }
            "tool_use" => {
                let id = block.id.clone().unwrap_or_default();
                let name = block.name.clone().unwrap_or_default();
                if id.is_empty() || name.is_empty() {
                    continue;
                }
                let arguments = block
                    .input
                    .as_ref()
                    .map(|input| serde_json::to_string(input).unwrap_or_else(|_| "{}".to_string()))
                    .unwrap_or_else(|| "{}".to_string());
                tool_calls.push(AiToolCall { id, name, arguments });
            }
            _ => {}
        }
    }

    let output = text_parts.join("\n");
    let tool_calls_opt = if tool_calls.is_empty() {
        None
    } else {
        Some(tool_calls)
    };

    if output.is_empty() && tool_calls_opt.is_none() {
        return Err(
            AiExecutionError::DecodeFailure("missing text or tool_use blocks in Anthropic payload".to_string())
                .to_string(),
        );
    }

    let finish_reason = if tool_calls_opt.is_some() || stop_reason == Some("tool_use") {
        Some("tool_calls".to_string())
    } else {
        finish_reason_for_result(&tool_calls_opt, stop_reason)
    };

    Ok(OpenAiChatResult {
        output,
        tool_calls: tool_calls_opt,
        finish_reason,
    })
}

/// Hard cap on scrollback excerpt characters (per-field ceiling).
const MAX_CONTEXT_EXCERPT_CHARS: usize = 6000;

/// Keep the **trailing** `max_chars` characters (matches frontend scrollback tail policy).
fn truncate_chars(value: &str, max_chars: usize) -> String {
    let count = value.chars().count();
    if count <= max_chars {
        return value.to_string();
    }
    let skip = count - max_chars;
    value.chars().skip(skip).collect()
}

fn char_count(value: &str) -> usize {
    value.chars().count()
}

fn history_char_count(history: Option<&[AiChatTurn]>) -> usize {
    history
        .map(|turns| turns.iter().map(|turn| char_count(&turn.content)).sum())
        .unwrap_or(0)
}

fn excerpt_budget_for_request(request: &AiExecuteRequest, routing: &ProviderRoutingSettings) -> usize {
    let total_budget = routing.ai_context_budget_chars.max(4_000);
    let prompt_chars = char_count(request.prompt.trim());
    let history_chars = history_char_count(request.history.as_deref());
    let reserved = prompt_chars.saturating_add(history_chars).saturating_add(800);
    total_budget
        .saturating_sub(reserved)
        .min(MAX_CONTEXT_EXCERPT_CHARS)
}

fn session_context_lines(ctx: &AiPromptContext, excerpt_budget: usize) -> Vec<String> {
    let mut lines: Vec<String> = Vec::new();
    if let Some(cwd) = ctx.cwd.as_ref().filter(|value| !value.trim().is_empty()) {
        lines.push(format!("cwd: {cwd}"));
    }
    if let Some(shell) = ctx.shell.as_ref().filter(|value| !value.trim().is_empty()) {
        lines.push(format!("shell: {shell}"));
    }
    if let Some(branch) = ctx.git_branch.as_ref().filter(|value| !value.trim().is_empty()) {
        lines.push(format!("git_branch: {branch}"));
    }
    if let Some(cmd) = ctx.command_text.as_ref().filter(|value| !value.trim().is_empty()) {
        lines.push(format!("command_text:\n{cmd}"));
    }
    if let Some(excerpt) = ctx.output_excerpt.as_ref().filter(|value| !value.trim().is_empty()) {
        let clipped = truncate_chars(excerpt, excerpt_budget.max(256));
        lines.push(format!("recent_terminal_output_tail:\n{clipped}"));
    }
    lines
}

/// User message body: optional session context block + the current prompt.
pub(crate) fn assemble_user_content(request: &AiExecuteRequest, routing: &ProviderRoutingSettings) -> String {
    let excerpt_budget = excerpt_budget_for_request(request, routing);
    let mut sections: Vec<String> = Vec::new();
    if let Some(ctx) = &request.context {
        let lines = session_context_lines(ctx, excerpt_budget);
        if !lines.is_empty() {
            sections.push(format!("Session context:\n{}", lines.join("\n")));
        }
    }
    let mut out = sections.join("\n\n");
    if !out.is_empty() {
        out.push_str("\n\n---\n\n");
    }
    out.push_str(request.prompt.trim());
    out
}

/// Legacy single-string prompt (context + user message) for tests and Ollama fallback.
pub(crate) fn assemble_prompt(request: &AiExecuteRequest) -> String {
    assemble_user_content(
        request,
        &ProviderRoutingSettings {
            ai_context_budget_chars: MAX_CONTEXT_EXCERPT_CHARS,
            ..ProviderRoutingSettings::default()
        },
    )
}

pub(crate) fn build_provider_messages(
    request: &AiExecuteRequest,
    routing: &ProviderRoutingSettings,
) -> Vec<OpenAiCompatibleMessage> {
    let mut messages: Vec<OpenAiCompatibleMessage> = Vec::new();
    let system = routing.system_prompt.trim();
    if !system.is_empty() {
        messages.push(OpenAiCompatibleMessage {
            role: "system".to_string(),
            content: Some(system.to_string()),
            tool_call_id: None,
            name: None,
            tool_calls: None,
        });
    }
    if let Some(history) = &request.history {
        for turn in history {
            let role = turn.role.as_str();
            if role == "user" || role == "assistant" {
                let content = turn.content.trim();
                if !content.is_empty() {
                    messages.push(OpenAiCompatibleMessage {
                        role: role.to_string(),
                        content: Some(content.to_string()),
                        tool_call_id: None,
                        name: None,
                        tool_calls: None,
                    });
                }
            }
        }
    }
    messages.push(OpenAiCompatibleMessage {
        role: "user".to_string(),
        content: Some(assemble_user_content(request, routing)),
        tool_call_id: None,
        name: None,
        tool_calls: None,
    });
    messages
}

#[instrument(skip(client, provider, routing, messages, tools))]
async fn run_ollama(
    client: &Client,
    provider: &ProviderSettings,
    routing: &ProviderRoutingSettings,
    messages: &[OpenAiCompatibleMessage],
    tools: Option<&serde_json::Value>,
) -> Result<OpenAiChatResult, String> {
    let base_url = normalize_ollama_base_url(provider).map_err(|error| error.to_string())?;
    let chat_url = base_url
        .join("/api/chat")
        .map_err(|error| {
            AiExecutionError::InvalidEndpoint(format!("failed to construct Ollama chat endpoint ({error})"))
        })
        .map_err(|error| error.to_string())?;
    let request = OllamaChatRequest {
        model: routing.ollama_model.clone(),
        messages: messages.to_vec(),
        stream: false,
        tools: tools.cloned(),
    };

    let response = client
        .post(chat_url)
        .json(&request)
        .send()
        .await
        .map_err(|error| {
            if error.is_connect() || error.is_timeout() {
                AiExecutionError::EndpointUnreachable(error.to_string()).to_string()
            } else {
                AiExecutionError::UpstreamStatus(error.to_string()).to_string()
            }
        })?;

    let response = response
        .error_for_status()
        .map_err(|error| AiExecutionError::UpstreamStatus(error.to_string()).to_string())?;

    let payload = response
        .json::<OllamaChatResponse>()
        .await
        .map_err(|error| AiExecutionError::DecodeFailure(error.to_string()).to_string())?;
    let tool_calls = parse_openai_tool_calls(payload.message.tool_calls.as_deref());
    let output = payload.message.content.trim().to_string();
    if output.is_empty() && tool_calls.is_none() {
        return Err(
            AiExecutionError::DecodeFailure("missing response text or tool calls in Ollama payload".to_string())
                .to_string(),
        );
    }
    Ok(OpenAiChatResult {
        output,
        tool_calls: tool_calls.clone(),
        finish_reason: finish_reason_for_result(&tool_calls, None),
    })
}

fn routing_model_for_provider(provider_id: &str, routing: &ProviderRoutingSettings) -> String {
    match provider_id {
        "openai" => routing.openai_model.clone(),
        "anthropic" => routing.anthropic_model.clone(),
        "custom-openai" => routing.custom_openai_model.clone(),
        _ => routing.ollama_model.clone(),
    }
}

#[instrument(skip(client, provider, routing, messages, tools))]
async fn run_openai_compatible(
    client: &Client,
    provider: &ProviderSettings,
    routing: &ProviderRoutingSettings,
    messages: &[OpenAiCompatibleMessage],
    tools: Option<&serde_json::Value>,
) -> Result<OpenAiChatResult, String> {
    let endpoint = normalize_openai_chat_url(provider).map_err(|error| error.to_string())?;
    let api_key = resolve_provider_api_key(provider).map_err(|error| error.to_string())?;
    let request = OpenAiCompatibleChatRequest {
        model: routing_model_for_provider(provider.id.as_str(), routing),
        messages: messages.to_vec(),
        stream: false,
        tools: tools.cloned(),
    };
    let response = client
        .post(endpoint)
        .bearer_auth(api_key)
        .json(&request)
        .send()
        .await
        .map_err(|error| {
            if error.is_connect() || error.is_timeout() {
                AiExecutionError::EndpointUnreachable(error.to_string()).to_string()
            } else {
                AiExecutionError::UpstreamStatus(error.to_string()).to_string()
            }
        })?
        .error_for_status()
        .map_err(|error| AiExecutionError::UpstreamStatus(error.to_string()).to_string())?;

    let payload = response
        .json::<OpenAiCompatibleChatResponse>()
        .await
        .map_err(|error| AiExecutionError::DecodeFailure(error.to_string()).to_string())?;
    payload
        .choices
        .first()
        .ok_or_else(|| {
            AiExecutionError::DecodeFailure("missing choices in provider payload".to_string()).to_string()
        })
        .and_then(|choice| openai_chat_result_from_choice(choice))
}

#[instrument(skip(client, provider, routing, messages, system_prompt, tools))]
async fn run_anthropic(
    client: &Client,
    provider: &ProviderSettings,
    routing: &ProviderRoutingSettings,
    messages: &[OpenAiCompatibleMessage],
    system_prompt: Option<&str>,
    tools: Option<&serde_json::Value>,
) -> Result<OpenAiChatResult, String> {
    let endpoint = normalize_anthropic_messages_url(provider).map_err(|error| error.to_string())?;
    let api_key = resolve_provider_api_key(provider).map_err(|error| error.to_string())?;
    let anthropic_messages = openai_messages_to_anthropic(messages);
    let anthropic_tools = tools.and_then(openai_tools_to_anthropic);
    let request = AnthropicMessagesRequest {
        model: routing_model_for_provider("anthropic", routing),
        max_tokens: 1024,
        system: system_prompt
            .filter(|value| !value.trim().is_empty())
            .map(|value| value.to_string()),
        messages: anthropic_messages,
        tools: anthropic_tools,
    };
    let response = client
        .post(endpoint)
        .header("x-api-key", api_key)
        .header("anthropic-version", "2023-06-01")
        .json(&request)
        .send()
        .await
        .map_err(|error| {
            if error.is_connect() || error.is_timeout() {
                AiExecutionError::EndpointUnreachable(error.to_string()).to_string()
            } else {
                AiExecutionError::UpstreamStatus(error.to_string()).to_string()
            }
        })?
        .error_for_status()
        .map_err(|error| AiExecutionError::UpstreamStatus(error.to_string()).to_string())?;

    let payload = response
        .json::<AnthropicMessagesResponse>()
        .await
        .map_err(|error| AiExecutionError::DecodeFailure(error.to_string()).to_string())?;
    parse_anthropic_chat_result(&payload.content, payload.stop_reason.as_deref())
}

/// TER audit 2026-06 (CRITICAL): `AiExecuteRequest` came from the IPC boundary with no
/// size limits on `prompt`, `history`, or `provider_messages`, so a compromised/buggy
/// frontend (or a crafted deep-link payload) could hand the provider client an
/// arbitrarily large request. These caps are generous for real usage — a human-typed
/// prompt or a `history[]` built from actual chat turns is nowhere close — and exist
/// only to reject a pathological single call before it reaches the provider dispatch.
const AI_EXECUTE_MAX_PROMPT_BYTES: usize = 32 * 1024;
const AI_EXECUTE_MAX_HISTORY_TURNS: usize = 50;
const AI_EXECUTE_MAX_TURN_BYTES: usize = 32 * 1024;
const AI_EXECUTE_MAX_PROVIDER_MESSAGES_BYTES: usize = 256 * 1024;

pub fn validate_ai_execute_request(request: &AiExecuteRequest) -> Result<(), String> {
    if request.prompt.len() > AI_EXECUTE_MAX_PROMPT_BYTES {
        return Err(format!(
            "ai_execute prompt too large ({} bytes, max {AI_EXECUTE_MAX_PROMPT_BYTES})",
            request.prompt.len()
        ));
    }
    if let Some(history) = &request.history {
        if history.len() > AI_EXECUTE_MAX_HISTORY_TURNS {
            return Err(format!(
                "ai_execute history has too many turns ({}, max {AI_EXECUTE_MAX_HISTORY_TURNS})",
                history.len()
            ));
        }
        if let Some(oversize) = history.iter().find(|turn| turn.content.len() > AI_EXECUTE_MAX_TURN_BYTES) {
            return Err(format!(
                "ai_execute history turn too large ({} bytes, max {AI_EXECUTE_MAX_TURN_BYTES})",
                oversize.content.len()
            ));
        }
    }
    if let Some(provider_messages) = &request.provider_messages {
        let serialized_len = serde_json::to_string(provider_messages).map(|s| s.len()).unwrap_or(usize::MAX);
        if serialized_len > AI_EXECUTE_MAX_PROVIDER_MESSAGES_BYTES {
            return Err(format!(
                "ai_execute provider_messages too large ({serialized_len} bytes, max {AI_EXECUTE_MAX_PROVIDER_MESSAGES_BYTES})"
            ));
        }
    }
    Ok(())
}

pub async fn execute_ai_request(
    client: &Client,
    settings: &AppSettings,
    request: &AiExecuteRequest,
) -> Result<AiExecuteResponse, String> {
    validate_ai_execute_request(request)?;
    if !settings.provider_routing.ai_feature_enabled {
        return Err(AiExecutionError::RoutingDisabled.to_string());
    }

    let provider = resolve_provider(settings, request.provider_id.as_deref())?;
    if !provider.enabled {
        return Err(AiExecutionError::ProviderDisabled(provider.id.clone()).to_string());
    }

    info!(
        provider_id = provider.id,
        intent = ?request.intent,
        has_context = request.context.is_some(),
        history_turns = request.history.as_ref().map(|history| history.len()).unwrap_or(0),
        enable_tools = request.enable_tools,
        use_provider_messages = request.use_provider_messages,
        "executing ai request"
    );
    let routing = &settings.provider_routing;
    let messages = resolve_messages(request, routing);
    let tools = if request.enable_tools {
        request.tools.as_ref()
    } else {
        None
    };
    let system_prompt = routing.system_prompt.trim();
    let anthropic_system = if system_prompt.is_empty() {
        None
    } else {
        Some(system_prompt)
    };
    match provider.id.as_str() {
        "ollama" => {
            let result = run_ollama(client, &provider, routing, &messages, tools).await?;
            Ok(AiExecuteResponse {
                provider_id: provider.id,
                output: result.output,
                tool_calls: result.tool_calls,
                finish_reason: result.finish_reason,
            })
        }
        "openai" | "custom-openai" => {
            let result = run_openai_compatible(client, &provider, routing, &messages, tools).await?;
            Ok(AiExecuteResponse {
                provider_id: provider.id,
                output: result.output,
                tool_calls: result.tool_calls,
                finish_reason: result.finish_reason,
            })
        }
        "anthropic" => {
            let result = run_anthropic(client, &provider, routing, &messages, anthropic_system, tools).await?;
            Ok(AiExecuteResponse {
                provider_id: provider.id,
                output: result.output,
                tool_calls: result.tool_calls,
                finish_reason: result.finish_reason,
            })
        }
        _ => {
            warn!(provider_id = provider.id, "provider configured without execution adapter");
            Err(AiExecutionError::ProviderAdapterMissing(provider.id).to_string())
        }
    }
}

#[cfg(test)]
mod assemble_tests {
    use crate::models::{AiChatTurn, AiExecuteRequest, AiPromptContext, ProviderRoutingSettings};
    use crate::provider_host::{
        assemble_prompt, build_provider_messages, openai_messages_to_anthropic, openai_tools_to_anthropic,
        parse_anthropic_chat_result, parse_anthropic_text, parse_openai_message_content,
        routing_model_for_provider, AnthropicContentBlock, OpenAiCompatibleMessage, OpenAiToolCallFunctionPayload,
        OpenAiToolCallPayload,
    };
    use serde_json::json;

    #[test]
    fn prepends_bounded_session_context_sections() {
        let excerpt = format!("{}{}", "x".repeat(7000), "tail-marker");
        let request = AiExecuteRequest {
            session_id: "sid".into(),
            prompt: "Explain the error.".into(),
            intent: Some("explain_command".into()),
            context: Some(AiPromptContext {
                cwd: Some("/tmp/project".into()),
                shell: Some("/bin/bash".into()),
                git_branch: Some("main".into()),
                command_text: Some("cargo build".into()),
                output_excerpt: Some(excerpt),
            }),
            ..Default::default()
        };
        let built = assemble_prompt(&request);
        assert!(built.contains("cwd: /tmp/project"));
        assert!(built.contains("shell: /bin/bash"));
        assert!(built.contains("git_branch: main"));
        assert!(built.contains("command_text:\ncargo build"));
        assert!(built.ends_with("Explain the error."));
        assert!(
            built.contains("tail-marker"),
            "tail of long excerpt should be preserved after clipping"
        );
    }

    #[test]
    fn build_provider_messages_includes_system_history_and_user_context() {
        let routing = ProviderRoutingSettings {
            system_prompt: "You are a terse ops assistant.".into(),
            ..ProviderRoutingSettings::default()
        };
        let request = AiExecuteRequest {
            session_id: "sid".into(),
            prompt: "What next?".into(),
            context: Some(AiPromptContext {
                cwd: Some("/tmp".into()),
                shell: None,
                git_branch: None,
                command_text: None,
                output_excerpt: None,
            }),
            history: Some(vec![
                AiChatTurn {
                    role: "user".into(),
                    content: "prior question".into(),
                },
                AiChatTurn {
                    role: "assistant".into(),
                    content: "prior answer".into(),
                },
            ]),
            ..Default::default()
        };
        let messages = build_provider_messages(&request, &routing);
        assert_eq!(messages.len(), 4);
        assert_eq!(messages[0].role, "system");
        assert_eq!(messages[1].content.as_deref(), Some("prior question"));
        assert!(messages[3].content.as_deref().unwrap_or("").contains("What next?"));
        assert!(messages[3].content.as_deref().unwrap_or("").contains("cwd: /tmp"));
    }

    #[test]
    fn parses_openai_text_content_from_string_and_array() {
        let string_payload = json!("single response");
        let array_payload = json!([
            { "type": "text", "text": "line one" },
            { "type": "text", "text": "line two" }
        ]);
        assert_eq!(
            parse_openai_message_content(&string_payload).as_deref(),
            Some("single response")
        );
        assert_eq!(
            parse_openai_message_content(&array_payload).as_deref(),
            Some("line one\nline two")
        );
    }

    #[test]
    fn parses_anthropic_text_blocks_only() {
        let blocks = vec![
            AnthropicContentBlock {
                kind: "text".to_string(),
                text: Some("first".to_string()),
                id: None,
                name: None,
                input: None,
            },
            AnthropicContentBlock {
                kind: "tool_use".to_string(),
                text: None,
                id: Some("toolu_1".to_string()),
                name: Some("list_command_runs".to_string()),
                input: Some(json!({ "limit": 5 })),
            },
            AnthropicContentBlock {
                kind: "text".to_string(),
                text: Some("second".to_string()),
                id: None,
                name: None,
                input: None,
            },
        ];
        assert_eq!(parse_anthropic_text(&blocks).as_deref(), Some("first\nsecond"));
    }

    #[test]
    fn converts_openai_tools_to_anthropic_schema() {
        let tools = json!([{
            "type": "function",
            "function": {
                "name": "get_command_output",
                "description": "Fetch output",
                "parameters": { "type": "object", "properties": { "run_id": { "type": "string" } } }
            }
        }]);
        let converted = openai_tools_to_anthropic(&tools).expect("tools");
        assert_eq!(converted.len(), 1);
        assert_eq!(converted[0].name, "get_command_output");
        assert_eq!(converted[0].description, "Fetch output");
        assert_eq!(converted[0].input_schema["type"], "object");
    }

    #[test]
    fn converts_openai_tool_messages_to_anthropic_blocks() {
        let messages = vec![
            OpenAiCompatibleMessage {
                role: "user".to_string(),
                content: Some("What failed?".to_string()),
                tool_call_id: None,
                name: None,
                tool_calls: None,
            },
            OpenAiCompatibleMessage {
                role: "assistant".to_string(),
                content: None,
                tool_call_id: None,
                name: None,
                tool_calls: Some(vec![OpenAiToolCallPayload {
                    id: "call_1".to_string(),
                    kind: "function".to_string(),
                    function: OpenAiToolCallFunctionPayload {
                        name: "list_command_runs".to_string(),
                        arguments: "{\"limit\":3}".to_string(),
                    },
                }]),
            },
            OpenAiCompatibleMessage {
                role: "tool".to_string(),
                content: Some("s1:1 npm test".to_string()),
                tool_call_id: Some("call_1".to_string()),
                name: Some("list_command_runs".to_string()),
                tool_calls: None,
            },
        ];
        let anthropic = openai_messages_to_anthropic(&messages);
        assert_eq!(anthropic.len(), 3);
        assert_eq!(anthropic[0].role, "user");
        assert_eq!(anthropic[1].role, "assistant");
        assert_eq!(anthropic[2].role, "user");
        let tool_results = anthropic[2].content.as_array().expect("tool results");
        assert_eq!(tool_results[0]["type"], "tool_result");
        assert_eq!(tool_results[0]["tool_use_id"], "call_1");
    }

    #[test]
    fn parses_anthropic_tool_use_into_chat_result() {
        let blocks = vec![AnthropicContentBlock {
            kind: "tool_use".to_string(),
            text: None,
            id: Some("toolu_abc".to_string()),
            name: Some("get_command_output".to_string()),
            input: Some(json!({ "run_id": "s1:2" })),
        }];
        let result = parse_anthropic_chat_result(&blocks, Some("tool_use")).expect("result");
        assert_eq!(result.finish_reason.as_deref(), Some("tool_calls"));
        assert_eq!(result.tool_calls.as_ref().map(|calls| calls.len()), Some(1));
        assert_eq!(result.tool_calls.as_ref().unwrap()[0].name, "get_command_output");
        assert!(result.tool_calls.as_ref().unwrap()[0].arguments.contains("s1:2"));
    }

    #[test]
    fn resolves_routing_model_by_provider() {
        let routing = ProviderRoutingSettings {
            default_provider: "openai".to_string(),
            ollama_model: "llama3.2".to_string(),
            openai_model: "gpt-4o-mini".to_string(),
            anthropic_model: "claude-3-5-haiku-latest".to_string(),
            custom_openai_model: "qwen2.5-coder".to_string(),
            ai_feature_enabled: true,
            system_prompt: String::new(),
            ai_context_budget_chars: 28_000,
        };
        assert_eq!(routing_model_for_provider("openai", &routing), "gpt-4o-mini");
        assert_eq!(
            routing_model_for_provider("anthropic", &routing),
            "claude-3-5-haiku-latest"
        );
        assert_eq!(
            routing_model_for_provider("custom-openai", &routing),
            "qwen2.5-coder"
        );
        assert_eq!(routing_model_for_provider("ollama", &routing), "llama3.2");
    }
}

#[cfg(test)]
mod validate_ai_execute_request_tests {
    use crate::models::{AiChatTurn, AiExecuteRequest, AiProviderMessage};
    use crate::provider_host::validate_ai_execute_request;

    #[test]
    fn accepts_a_normal_request() {
        let request = AiExecuteRequest {
            prompt: "Explain the error.".into(),
            history: Some(vec![AiChatTurn {
                role: "user".into(),
                content: "hello".into(),
            }]),
            ..Default::default()
        };
        assert!(validate_ai_execute_request(&request).is_ok());
    }

    #[test]
    fn rejects_oversize_prompt() {
        let request = AiExecuteRequest {
            prompt: "x".repeat(33 * 1024),
            ..Default::default()
        };
        assert!(validate_ai_execute_request(&request).is_err());
    }

    #[test]
    fn rejects_too_many_history_turns() {
        let request = AiExecuteRequest {
            prompt: "hi".into(),
            history: Some(
                (0..51)
                    .map(|_| AiChatTurn {
                        role: "user".into(),
                        content: "hi".into(),
                    })
                    .collect(),
            ),
            ..Default::default()
        };
        assert!(validate_ai_execute_request(&request).is_err());
    }

    #[test]
    fn rejects_oversize_history_turn() {
        let request = AiExecuteRequest {
            prompt: "hi".into(),
            history: Some(vec![AiChatTurn {
                role: "user".into(),
                content: "x".repeat(33 * 1024),
            }]),
            ..Default::default()
        };
        assert!(validate_ai_execute_request(&request).is_err());
    }

    #[test]
    fn rejects_oversize_provider_messages() {
        let request = AiExecuteRequest {
            prompt: "hi".into(),
            provider_messages: Some(vec![AiProviderMessage {
                role: "user".into(),
                content: Some("x".repeat(300 * 1024)),
                tool_call_id: None,
                name: None,
                tool_calls: None,
            }]),
            ..Default::default()
        };
        assert!(validate_ai_execute_request(&request).is_err());
    }
}

pub fn default_runtime_client() -> Result<Client, String> {
    Client::builder()
        .connect_timeout(Duration::from_secs(4))
        .timeout(Duration::from_secs(20))
        .pool_idle_timeout(Duration::from_secs(30))
        .build()
        .map_err(|error| format!("failed to configure runtime http client: {error}"))
}
