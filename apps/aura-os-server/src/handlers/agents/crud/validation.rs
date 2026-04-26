use aura_os_core::{effective_auth_source, AgentRuntimeConfig};

use crate::error::{ApiError, ApiResult};

pub(super) fn agent_name_has_supported_format(value: &str) -> bool {
    !value.is_empty()
        && value
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || ch == '-' || ch == '_')
}

pub(super) fn ensure_supported_agent_name(name: &str) -> ApiResult<()> {
    if agent_name_has_supported_format(name) {
        Ok(())
    } else {
        Err(ApiError::bad_request(
            "agent name must use only letters, numbers, hyphens, or underscores",
        ))
    }
}

/// Inputs to [`build_runtime_config`]. Keeps the function under the 5-param
/// rule while preserving the original semantics — every field is optional and
/// resolved via the same fallbacks the legacy positional API used.
pub(super) struct RuntimeConfigInputs {
    pub adapter_type: Option<String>,
    pub environment: Option<String>,
    pub auth_source: Option<String>,
    pub integration_id: Option<String>,
    pub default_model: Option<String>,
    pub machine_type: Option<String>,
}

fn normalize_environment(
    environment: Option<String>,
    machine_type: Option<String>,
) -> ApiResult<String> {
    let resolved = environment.unwrap_or_else(|| match machine_type.as_deref() {
        Some("remote") => "swarm_microvm".to_string(),
        _ => "local_host".to_string(),
    });

    match resolved.as_str() {
        "local_host" | "swarm_microvm" => Ok(resolved),
        _ => Err(ApiError::bad_request(format!(
            "unsupported environment `{resolved}`"
        ))),
    }
}

pub(super) fn build_runtime_config(inputs: RuntimeConfigInputs) -> ApiResult<AgentRuntimeConfig> {
    let adapter_type = ensure_supported_adapter(inputs.adapter_type)?;
    let environment = normalize_environment(inputs.environment, inputs.machine_type)?;
    let auth_source = effective_auth_source(
        &adapter_type,
        inputs.auth_source.as_deref(),
        inputs.integration_id.as_deref(),
    );
    ensure_supported_auth_source(&adapter_type, &auth_source)?;
    let integration_id = resolve_integration_id(&auth_source, inputs.integration_id)?;

    Ok(AgentRuntimeConfig {
        adapter_type,
        environment,
        auth_source,
        integration_id,
        default_model: inputs.default_model,
    })
}

fn ensure_supported_adapter(adapter_type: Option<String>) -> ApiResult<String> {
    let adapter_type = adapter_type.unwrap_or_else(|| "aura_harness".to_string());
    if adapter_type != "aura_harness" {
        return Err(ApiError::bad_request(format!(
            "unsupported adapter `{adapter_type}`; only `aura_harness` is supported"
        )));
    }
    Ok(adapter_type)
}

fn ensure_supported_auth_source(adapter_type: &str, auth_source: &str) -> ApiResult<()> {
    match auth_source {
        "aura_managed" | "org_integration" => Ok(()),
        other => Err(ApiError::bad_request(format!(
            "adapter `{adapter_type}` does not support auth source `{other}`"
        ))),
    }
}

fn resolve_integration_id(
    auth_source: &str,
    integration_id: Option<String>,
) -> ApiResult<Option<String>> {
    if auth_source != "org_integration" {
        return Ok(None);
    }
    let trimmed = integration_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_owned);
    trimmed
        .ok_or_else(|| {
            ApiError::bad_request("auth source `org_integration` requires an attached integration")
        })
        .map(Some)
}

#[cfg(test)]
mod tests {
    use super::{agent_name_has_supported_format, build_runtime_config, RuntimeConfigInputs};

    fn aura_harness_inputs() -> RuntimeConfigInputs {
        RuntimeConfigInputs {
            adapter_type: Some("aura_harness".to_string()),
            environment: Some("local_host".to_string()),
            auth_source: None,
            integration_id: None,
            default_model: None,
            machine_type: Some("local".to_string()),
        }
    }

    #[test]
    fn aura_defaults_to_aura_managed() {
        let config = build_runtime_config(aura_harness_inputs()).expect("runtime config");

        assert_eq!(config.auth_source, "aura_managed");
        assert_eq!(config.integration_id, None);
    }

    #[test]
    fn aura_harness_accepts_org_integration_auth() {
        let config = build_runtime_config(RuntimeConfigInputs {
            auth_source: Some("org_integration".to_string()),
            integration_id: Some("int-anthropic".to_string()),
            default_model: Some("claude-opus-4-6".to_string()),
            ..aura_harness_inputs()
        })
        .expect("aura_harness org integration should be allowed");

        assert_eq!(config.auth_source, "org_integration");
        assert_eq!(config.integration_id.as_deref(), Some("int-anthropic"));
    }

    #[test]
    fn external_adapters_are_rejected() {
        let error = build_runtime_config(RuntimeConfigInputs {
            adapter_type: Some("claude_code".to_string()),
            ..aura_harness_inputs()
        })
        .expect_err("external adapters should be rejected");

        assert!(format!("{error:?}").contains("only `aura_harness` is supported"));
    }

    #[test]
    fn org_integration_requires_integration_id() {
        let error = build_runtime_config(RuntimeConfigInputs {
            auth_source: Some("org_integration".to_string()),
            ..aura_harness_inputs()
        })
        .expect_err("missing integration should fail");

        assert!(format!("{error:?}").contains("requires an attached integration"));
    }

    #[test]
    fn agent_name_rule_accepts_ascii_slug_names() {
        assert!(agent_name_has_supported_format("Aura_Local"));
        assert!(agent_name_has_supported_format("aura-swarm-01"));
    }

    #[test]
    fn agent_name_rule_rejects_spaces_and_symbols() {
        assert!(!agent_name_has_supported_format("Aura Local"));
        assert!(!agent_name_has_supported_format("Aura!"));
        assert!(!agent_name_has_supported_format(""));
    }
}
