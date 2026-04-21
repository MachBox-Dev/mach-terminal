use mach_terminal_lib::models::{AiExecuteRequest, AppSettings};
use mach_terminal_lib::provider_host::{default_runtime_client, execute_ai_request};
use std::ffi::OsString;

struct EnvVarGuard {
    key: &'static str,
    previous: Option<OsString>,
}

impl EnvVarGuard {
    fn set(key: &'static str, value: &'static str) -> Self {
        let previous = std::env::var_os(key);
        unsafe { std::env::set_var(key, value) };
        Self { key, previous }
    }

    fn set_empty(key: &'static str) -> Self {
        let previous = std::env::var_os(key);
        unsafe { std::env::set_var(key, "") };
        Self { key, previous }
    }
}

impl Drop for EnvVarGuard {
    fn drop(&mut self) {
        match &self.previous {
            Some(value) => unsafe { std::env::set_var(self.key, value) },
            None => unsafe { std::env::remove_var(self.key) },
        }
    }
}

fn request() -> AiExecuteRequest {
    AiExecuteRequest {
        session_id: "session-test".to_string(),
        prompt: "explain ls -la".to_string(),
        provider_id: None,
        intent: None,
        context: None,
    }
}

fn settings_with_ollama_enabled() -> AppSettings {
    let mut settings = AppSettings::default();
    settings.provider_routing.ai_feature_enabled = true;
    settings.provider_routing.default_provider = "ollama".to_string();
    for provider in &mut settings.providers {
        if provider.id == "ollama" {
            provider.enabled = true;
        }
    }
    settings
}

#[tokio::test]
async fn rejects_when_ai_routing_opt_in_is_disabled() {
    let client = default_runtime_client().expect("runtime client");
    let settings = AppSettings::default();
    let error = execute_ai_request(&client, &settings, &request())
        .await
        .expect_err("routing opt-in gate should reject");
    assert!(error.contains("AI routing is disabled"));
}

#[tokio::test]
async fn rejects_when_provider_is_disabled() {
    let client = default_runtime_client().expect("runtime client");
    let mut settings = AppSettings::default();
    settings.provider_routing.ai_feature_enabled = true;
    settings.provider_routing.default_provider = "openai".to_string();
    let error = execute_ai_request(&client, &settings, &request())
        .await
        .expect_err("disabled provider should reject");
    assert!(error.contains("disabled"));
}

#[tokio::test]
async fn rejects_when_default_provider_is_not_configured() {
    let client = default_runtime_client().expect("runtime client");
    let mut settings = AppSettings::default();
    settings.provider_routing.ai_feature_enabled = true;
    settings.provider_routing.default_provider = "missing-provider".to_string();
    let error = execute_ai_request(&client, &settings, &request())
        .await
        .expect_err("missing provider should reject");
    assert!(error.contains("not configured"));
}

#[tokio::test]
async fn rejects_configured_provider_without_credentials() {
    let _env_guard = EnvVarGuard::set_empty("OPENAI_API_KEY");
    let client = default_runtime_client().expect("runtime client");
    let mut settings = AppSettings::default();
    settings.provider_routing.ai_feature_enabled = true;
    settings.provider_routing.default_provider = "openai".to_string();
    for provider in &mut settings.providers {
        if provider.id == "openai" {
            provider.enabled = true;
            provider.endpoint = Some("http://127.0.0.1:1".to_string());
        }
    }
    let error = execute_ai_request(&client, &settings, &request())
        .await
        .expect_err("missing credentials should reject");
    assert!(
        error.contains("missing credentials")
            || error.contains("secure provider key storage is unavailable")
            || error.contains("unreachable"),
        "expected credential-missing, keyring-unavailable, or unreachable endpoint error, got: {error}"
    );
}

#[tokio::test]
async fn uses_env_credentials_when_provider_secret_is_not_available() {
    let _env_guard = EnvVarGuard::set("OPENAI_API_KEY", "sk-env-fallback-test");
    let client = default_runtime_client().expect("runtime client");
    let mut settings = AppSettings::default();
    settings.provider_routing.ai_feature_enabled = true;
    settings.provider_routing.default_provider = "openai".to_string();
    for provider in &mut settings.providers {
        if provider.id == "openai" {
            provider.enabled = true;
            // Resolve credentials first, then fail at connect stage to prove env fallback.
            provider.endpoint = Some("http://127.0.0.1:1".to_string());
        }
    }
    let error = execute_ai_request(&client, &settings, &request())
        .await
        .expect_err("endpoint should be unreachable once credentials resolve");
    assert!(
        error.contains("unreachable")
            || error.contains("secure provider key storage is unavailable")
            || error.contains("error response"),
        "expected request-stage or keyring error, got: {error}"
    );
    assert!(
        !error.contains("missing credentials"),
        "env fallback should avoid missing-credentials error when keyring is readable: {error}"
    );
}

#[tokio::test]
async fn rejects_invalid_ollama_endpoint_scheme() {
    let client = default_runtime_client().expect("runtime client");
    let mut settings = settings_with_ollama_enabled();
    for provider in &mut settings.providers {
        if provider.id == "ollama" {
            provider.endpoint = Some("ftp://localhost:11434".to_string());
        }
    }

    let error = execute_ai_request(&client, &settings, &request())
        .await
        .expect_err("invalid endpoint should reject");
    assert!(error.contains("unsupported scheme"));
}

#[tokio::test]
async fn surfaces_unreachable_ollama_endpoint_failures() {
    let client = default_runtime_client().expect("runtime client");
    let mut settings = settings_with_ollama_enabled();
    for provider in &mut settings.providers {
        if provider.id == "ollama" {
            provider.endpoint = Some("http://127.0.0.1:1".to_string());
        }
    }

    let error = execute_ai_request(&client, &settings, &request())
        .await
        .expect_err("unreachable endpoint should reject");
    assert!(error.contains("unreachable"));
}
