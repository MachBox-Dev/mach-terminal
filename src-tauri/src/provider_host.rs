use crate::models::{
    AiExecuteRequest, AiExecuteResponse, AppSettings, ProviderDescriptor, ProviderRoutingSettings,
    ProviderSettings,
};
use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::time::Duration;
use tracing::{info, instrument, warn};

#[derive(Debug, Serialize)]
struct OllamaGenerateRequest {
    model: String,
    prompt: String,
    stream: bool,
}

#[derive(Debug, Deserialize)]
struct OllamaGenerateResponse {
    response: String,
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
            status: if provider.enabled {
                "available".to_string()
            } else {
                "disabled".to_string()
            },
        })
        .collect()
}

fn resolve_provider(settings: &AppSettings, requested: Option<&str>) -> Result<ProviderSettings, String> {
    let route_to = requested.unwrap_or(&settings.provider_routing.default_provider);
    settings
        .providers
        .iter()
        .find(|provider| provider.id == route_to)
        .cloned()
        .ok_or_else(|| format!("provider `{route_to}` is not configured"))
}

#[instrument(skip(client, provider, routing, prompt))]
async fn run_ollama(
    client: &Client,
    provider: &ProviderSettings,
    routing: &ProviderRoutingSettings,
    prompt: &str,
) -> Result<String, String> {
    let endpoint = provider
        .endpoint
        .clone()
        .unwrap_or_else(|| "http://127.0.0.1:11434".to_string());
    let request = OllamaGenerateRequest {
        model: routing.ollama_model.clone(),
        prompt: prompt.to_string(),
        stream: false,
    };

    let response = client
        .post(format!("{endpoint}/api/generate"))
        .json(&request)
        .send()
        .await
        .map_err(|error| format!("ollama request failed: {error}"))?;

    let response = response
        .error_for_status()
        .map_err(|error| format!("ollama returned error status: {error}"))?;

    response
        .json::<OllamaGenerateResponse>()
        .await
        .map(|payload| payload.response)
        .map_err(|error| format!("failed to decode ollama response: {error}"))
}

pub async fn execute_ai_request(
    client: &Client,
    settings: &AppSettings,
    request: &AiExecuteRequest,
) -> Result<AiExecuteResponse, String> {
    if !settings.provider_routing.ai_feature_enabled {
        return Err("AI routing is disabled. Enable it in provider routing settings first.".to_string());
    }

    let provider = resolve_provider(settings, request.provider_id.as_deref())?;
    if !provider.enabled {
        return Err(format!(
            "Provider `{}` is disabled. Enable it before sending AI requests.",
            provider.id
        ));
    }

    info!(provider_id = provider.id, "executing ai request");
    let output = match provider.id.as_str() {
        "ollama" => run_ollama(client, &provider, &settings.provider_routing, &request.prompt).await?,
        _ => {
            warn!(provider_id = provider.id, "provider configured without execution adapter");
            return Err(format!(
                "Provider `{}` is configured but has no execution adapter yet.",
                provider.id
            ))
        }
    };

    Ok(AiExecuteResponse {
        provider_id: provider.id,
        output,
    })
}

pub fn default_runtime_client() -> Result<Client, String> {
    Client::builder()
        .connect_timeout(Duration::from_secs(4))
        .timeout(Duration::from_secs(20))
        .pool_idle_timeout(Duration::from_secs(30))
        .build()
        .map_err(|error| format!("failed to configure runtime http client: {error}"))
}
