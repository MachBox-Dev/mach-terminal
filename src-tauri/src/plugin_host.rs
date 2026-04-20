use crate::models::{
    PluginExecutionResult, PluginGrantRequest, PluginGrantSnapshot, PluginMetricsSnapshot, PluginPolicyDecision,
};
use std::collections::{HashMap, HashSet};
use std::sync::Mutex;
use std::time::Instant;
use tracing::{info, warn};

const KNOWN_PLUGIN_CAPABILITIES: &[(&str, &[&str])] = &[
    ("history-tools", &["command-history.read", "command-history.search"]),
    ("session-restore", &["sessions.read", "sessions.write"]),
    ("provider-router", &["provider-host.read", "provider-host.route"]),
];

#[derive(Default)]
struct PluginMetricsState {
    grants_total: u64,
    execution_allowed_total: u64,
    execution_denied_total: u64,
    execution_error_total: u64,
    execution_total: u64,
    cumulative_execution_ms: u64,
    last_execution_ms: Option<u64>,
}

#[derive(Default)]
pub struct PluginHost {
    grants: Mutex<HashMap<String, HashSet<String>>>,
    metrics: Mutex<PluginMetricsState>,
}

fn capability_map_for_plugin(plugin_id: &str) -> Option<&'static [&'static str]> {
    KNOWN_PLUGIN_CAPABILITIES
        .iter()
        .find(|(known_id, _)| *known_id == plugin_id)
        .map(|(_, capabilities)| *capabilities)
}

fn build_decision(accepted: bool, reason_code: &str, message: impl Into<String>) -> PluginPolicyDecision {
    PluginPolicyDecision {
        accepted,
        reason_code: reason_code.to_string(),
        message: message.into(),
    }
}

fn build_execution_result(
    plugin_id: &str,
    capability: &str,
    payload_bytes: Option<usize>,
    decision: PluginPolicyDecision,
) -> PluginExecutionResult {
    PluginExecutionResult {
        plugin_id: plugin_id.to_string(),
        capability: capability.to_string(),
        accepted: decision.accepted,
        message: decision.message.clone(),
        reason_code: decision.reason_code.clone(),
        payload_bytes,
        decision: Some(decision),
    }
}

impl PluginHost {
    pub fn grant_capability_request(&self, request: &PluginGrantRequest) -> Result<PluginPolicyDecision, String> {
        self.grant_capability(&request.plugin_id, &request.capability)
    }

    pub fn grant_capability(&self, plugin_id: &str, capability: &str) -> Result<PluginPolicyDecision, String> {
        let plugin_id = plugin_id.trim();
        let capability = capability.trim();
        let declared = capability_map_for_plugin(plugin_id);

        if declared.is_none() {
            let decision = build_decision(
                false,
                "invalid_plugin_id",
                format!("Plugin `{plugin_id}` is not registered in the runtime policy."),
            );
            warn!(plugin_id, capability, reason_code = decision.reason_code, "plugin capability grant denied");
            return Ok(decision);
        }

        if !declared.is_some_and(|values| values.contains(&capability)) {
            let decision = build_decision(
                false,
                "capability_not_declared",
                format!("Capability `{capability}` is not declared for plugin `{plugin_id}`."),
            );
            warn!(plugin_id, capability, reason_code = decision.reason_code, "plugin capability grant denied");
            return Ok(decision);
        }

        let mut grants = self
            .grants
            .lock()
            .map_err(|error| format!("failed to lock plugin host grants: {error}"))?;
        let set = grants.entry(plugin_id.to_string()).or_default();
        let inserted = set.insert(capability.to_string());
        drop(grants);

        if inserted {
            let mut metrics = self
                .metrics
                .lock()
                .map_err(|error| format!("failed to lock plugin host metrics: {error}"))?;
            metrics.grants_total = metrics.grants_total.saturating_add(1);
        }

        let decision = build_decision(
            true,
            "grant_applied",
            format!("Granted capability `{capability}` for plugin `{plugin_id}`."),
        );
        info!(plugin_id, capability, "plugin capability grant applied");
        Ok(decision)
    }

    fn record_execution_metrics(&self, accepted: bool, elapsed_ms: u64) -> Result<(), String> {
        let mut metrics = self
            .metrics
            .lock()
            .map_err(|error| format!("failed to lock plugin host metrics: {error}"))?;
        metrics.execution_total = metrics.execution_total.saturating_add(1);
        metrics.cumulative_execution_ms = metrics.cumulative_execution_ms.saturating_add(elapsed_ms);
        metrics.last_execution_ms = Some(elapsed_ms);
        if accepted {
            metrics.execution_allowed_total = metrics.execution_allowed_total.saturating_add(1);
        } else {
            metrics.execution_denied_total = metrics.execution_denied_total.saturating_add(1);
        }
        Ok(())
    }

    pub fn execute(&self, plugin_id: &str, capability: &str, payload: &str) -> Result<PluginExecutionResult, String> {
        let started = Instant::now();
        let plugin_id = plugin_id.trim();
        let capability = capability.trim();

        if capability_map_for_plugin(plugin_id).is_none() {
            let decision = build_decision(
                false,
                "invalid_plugin_id",
                format!("Plugin `{plugin_id}` is not registered in the runtime policy."),
            );
            let elapsed = started.elapsed().as_millis() as u64;
            self.record_execution_metrics(false, elapsed)?;
            return Ok(build_execution_result(plugin_id, capability, Some(payload.len()), decision));
        }

        if !capability_map_for_plugin(plugin_id).is_some_and(|values| values.contains(&capability)) {
            let decision = build_decision(
                false,
                "capability_not_declared",
                format!("Capability `{capability}` is not declared for plugin `{plugin_id}`."),
            );
            let elapsed = started.elapsed().as_millis() as u64;
            self.record_execution_metrics(false, elapsed)?;
            return Ok(build_execution_result(plugin_id, capability, Some(payload.len()), decision));
        }

        let grants = self
            .grants
            .lock()
            .map_err(|error| format!("failed to lock plugin host grants: {error}"))?;
        let allowed = grants
            .get(plugin_id)
            .map(|set| set.contains(capability))
            .unwrap_or(false);
        drop(grants);

        let elapsed = started.elapsed().as_millis() as u64;
        if !allowed {
            let decision = build_decision(
                false,
                "policy_denied_missing_grant",
                "Denied by policy. Grant capability explicitly before execution.",
            );
            self.record_execution_metrics(false, elapsed)?;
            warn!(
                plugin_id,
                capability,
                payload_bytes = payload.len(),
                reason_code = decision.reason_code,
                "plugin execution denied"
            );
            return Ok(build_execution_result(plugin_id, capability, Some(payload.len()), decision));
        }

        self.record_execution_metrics(true, elapsed)?;
        info!(
            plugin_id,
            capability,
            payload_bytes = payload.len(),
            elapsed_ms = elapsed,
            "plugin execution accepted"
        );
        let decision = build_decision(
            true,
            "policy_allowed",
            format!("Executed with payload bytes={}", payload.len()),
        );
        Ok(build_execution_result(plugin_id, capability, Some(payload.len()), decision))
    }

    pub fn metrics_snapshot(&self) -> Result<PluginMetricsSnapshot, String> {
        let metrics = self
            .metrics
            .lock()
            .map_err(|error| format!("failed to lock plugin host metrics: {error}"))?;
        let grants = self
            .grants
            .lock()
            .map_err(|error| format!("failed to lock plugin host grants: {error}"))?;
        Ok(PluginMetricsSnapshot {
            grants_total: metrics.grants_total,
            execution_allowed_total: metrics.execution_allowed_total,
            execution_denied_total: metrics.execution_denied_total,
            execution_error_total: metrics.execution_error_total,
            execution_total: metrics.execution_total,
            cumulative_execution_ms: metrics.cumulative_execution_ms,
            last_execution_ms: metrics.last_execution_ms,
            granted_plugin_count: grants.len() as u64,
        })
    }

    pub fn grants_snapshot(&self) -> Result<Vec<PluginGrantSnapshot>, String> {
        let grants = self
            .grants
            .lock()
            .map_err(|error| format!("failed to lock plugin host grants: {error}"))?;
        let mut out: Vec<PluginGrantSnapshot> = grants
            .iter()
            .map(|(plugin_id, caps)| {
                let mut capabilities: Vec<String> = caps.iter().cloned().collect();
                capabilities.sort();
                PluginGrantSnapshot {
                    plugin_id: plugin_id.clone(),
                    capabilities,
                }
            })
            .collect();
        out.sort_by(|a, b| a.plugin_id.cmp(&b.plugin_id));
        Ok(out)
    }
}

#[cfg(test)]
mod tests {
    use super::PluginHost;
    use crate::models::PluginGrantRequest;

    #[test]
    fn denies_unknown_plugin_grants() {
        let host = PluginHost::default();
        let decision = host
            .grant_capability("missing-plugin", "command-history.read")
            .expect("grant decision");
        assert!(!decision.accepted);
        assert_eq!(decision.reason_code, "invalid_plugin_id");
    }

    #[test]
    fn denies_execution_without_grant() {
        let host = PluginHost::default();
        let result = host
            .execute("history-tools", "command-history.read", "{}")
            .expect("execution result");
        assert!(!result.accepted);
        assert_eq!(result.reason_code, "policy_denied_missing_grant");
    }

    #[test]
    fn allows_execution_after_grant() {
        let host = PluginHost::default();
        let request = PluginGrantRequest {
            plugin_id: "history-tools".to_string(),
            capability: "command-history.read".to_string(),
        };
        let grant = host.grant_capability_request(&request).expect("grant");
        assert!(grant.accepted);
        let result = host
            .execute("history-tools", "command-history.read", "{\"scope\":\"active\"}")
            .expect("execution");
        assert!(result.accepted);
        assert_eq!(result.reason_code, "policy_allowed");
        assert_eq!(result.payload_bytes, Some("{\"scope\":\"active\"}".len()));
    }

    #[test]
    fn records_metrics_for_grants_and_executions() {
        let host = PluginHost::default();
        let _ = host
            .grant_capability("history-tools", "command-history.read")
            .expect("grant");
        let _ = host
            .execute("history-tools", "command-history.read", "{}")
            .expect("execute");
        let _ = host
            .execute("history-tools", "command-history.search", "{}")
            .expect("execute denied");
        let metrics = host.metrics_snapshot().expect("metrics");
        assert_eq!(metrics.grants_total, 1);
        assert_eq!(metrics.execution_allowed_total, 1);
        assert_eq!(metrics.execution_denied_total, 1);
        assert_eq!(metrics.execution_total, 2);
        assert_eq!(metrics.granted_plugin_count, 1);
    }
}
