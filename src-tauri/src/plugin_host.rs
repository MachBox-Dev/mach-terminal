use serde::Serialize;
use std::collections::{HashMap, HashSet};
use std::sync::Mutex;

#[derive(Debug, Clone, Serialize)]
pub struct PluginExecutionResult {
    pub plugin_id: String,
    pub capability: String,
    pub accepted: bool,
    pub message: String,
}

#[derive(Default)]
pub struct PluginHost {
    grants: Mutex<HashMap<String, HashSet<String>>>,
}

impl PluginHost {
    pub fn grant_capability(&self, plugin_id: &str, capability: &str) -> Result<(), String> {
        let mut grants = self
            .grants
            .lock()
            .map_err(|error| format!("failed to lock plugin host: {error}"))?;
        let set = grants.entry(plugin_id.to_string()).or_default();
        set.insert(capability.to_string());
        Ok(())
    }

    pub fn execute(&self, plugin_id: &str, capability: &str, payload: &str) -> Result<PluginExecutionResult, String> {
        let grants = self
            .grants
            .lock()
            .map_err(|error| format!("failed to lock plugin host: {error}"))?;
        let allowed = grants
            .get(plugin_id)
            .map(|set| set.contains(capability))
            .unwrap_or(false);

        if !allowed {
            return Ok(PluginExecutionResult {
                plugin_id: plugin_id.to_string(),
                capability: capability.to_string(),
                accepted: false,
                message: "Denied by policy. Grant capability explicitly before execution.".to_string(),
            });
        }

        Ok(PluginExecutionResult {
            plugin_id: plugin_id.to_string(),
            capability: capability.to_string(),
            accepted: true,
            message: format!("Executed with payload bytes={}", payload.len()),
        })
    }
}
