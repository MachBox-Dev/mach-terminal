use keyring::Entry;
use std::fmt;

const PROVIDER_SECRET_SERVICE: &str = "com.whobs.machterminal.providers";

#[derive(Debug)]
pub enum ProviderSecretError {
    InvalidProviderId,
    InvalidApiKey,
    KeyringUnavailable(String),
    KeyringWriteFailure(String),
    KeyringReadFailure(String),
}

impl fmt::Display for ProviderSecretError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            ProviderSecretError::InvalidProviderId => write!(f, "provider id cannot be empty"),
            ProviderSecretError::InvalidApiKey => write!(f, "api key cannot be empty"),
            ProviderSecretError::KeyringUnavailable(message) => {
                write!(f, "secure key storage is unavailable. {message}")
            }
            ProviderSecretError::KeyringWriteFailure(message) => {
                write!(f, "failed to update secure provider key. {message}")
            }
            ProviderSecretError::KeyringReadFailure(message) => {
                write!(f, "failed to read secure provider key. {message}")
            }
        }
    }
}

impl std::error::Error for ProviderSecretError {}

fn provider_entry(provider_id: &str) -> Result<Entry, ProviderSecretError> {
    if provider_id.trim().is_empty() {
        return Err(ProviderSecretError::InvalidProviderId);
    }
    Entry::new(PROVIDER_SECRET_SERVICE, provider_id.trim())
        .map_err(|error| ProviderSecretError::KeyringUnavailable(error.to_string()))
}

pub fn set_provider_api_key(provider_id: &str, api_key: &str) -> Result<(), ProviderSecretError> {
    let trimmed = api_key.trim();
    if trimmed.is_empty() {
        return Err(ProviderSecretError::InvalidApiKey);
    }
    let entry = provider_entry(provider_id)?;
    entry
        .set_password(trimmed)
        .map_err(|error| ProviderSecretError::KeyringWriteFailure(error.to_string()))
}

pub fn clear_provider_api_key(provider_id: &str) -> Result<(), ProviderSecretError> {
    let entry = provider_entry(provider_id)?;
    match entry.delete_credential() {
        Ok(()) => Ok(()),
        Err(error) if format!("{error:?}").to_lowercase().contains("noentry") => Ok(()),
        Err(error) => Err(ProviderSecretError::KeyringWriteFailure(error.to_string())),
    }
}

pub fn has_provider_api_key(provider_id: &str) -> Result<bool, ProviderSecretError> {
    let entry = provider_entry(provider_id)?;
    match entry.get_password() {
        Ok(secret) => Ok(!secret.trim().is_empty()),
        Err(error) if format!("{error:?}").to_lowercase().contains("noentry") => Ok(false),
        Err(error) => Err(ProviderSecretError::KeyringReadFailure(error.to_string())),
    }
}

pub fn provider_api_key(provider_id: &str) -> Result<Option<String>, ProviderSecretError> {
    let entry = provider_entry(provider_id)?;
    match entry.get_password() {
        Ok(secret) => {
            if secret.trim().is_empty() {
                Ok(None)
            } else {
                Ok(Some(secret))
            }
        }
        Err(error) if format!("{error:?}").to_lowercase().contains("noentry") => Ok(None),
        Err(error) => Err(ProviderSecretError::KeyringReadFailure(error.to_string())),
    }
}

#[cfg(test)]
mod tests {
    use super::{set_provider_api_key, ProviderSecretError};

    #[test]
    fn rejects_empty_provider_id_before_keyring_access() {
        let error = set_provider_api_key("   ", "sk-test").expect_err("empty provider id should reject");
        assert!(matches!(error, ProviderSecretError::InvalidProviderId));
        assert_eq!(error.to_string(), "provider id cannot be empty");
    }

    #[test]
    fn rejects_empty_api_key_before_keyring_access() {
        let error = set_provider_api_key("openai", "   ").expect_err("empty api key should reject");
        assert!(matches!(error, ProviderSecretError::InvalidApiKey));
        assert_eq!(error.to_string(), "api key cannot be empty");
    }

    #[test]
    fn keeps_keyring_unavailable_error_prefix_stable() {
        let error = ProviderSecretError::KeyringUnavailable("service unavailable".to_string());
        assert!(error
            .to_string()
            .starts_with("secure key storage is unavailable."));
    }
}
