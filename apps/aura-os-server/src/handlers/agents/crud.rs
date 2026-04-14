use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::Json;
use futures_util::future::join_all;
use serde::Serialize;
use std::time::Duration;

use aura_os_core::{effective_auth_source, Agent, AgentId, AgentRuntimeConfig, HarnessMode};
use aura_os_network::{NetworkAgent, NetworkClient};

use crate::dto::{CreateAgentRequest, UpdateAgentRequest};
use crate::error::{map_network_error, map_storage_error, ApiError, ApiResult};
use crate::handlers::projects;
use crate::state::{AppState, AuthJwt};

use super::conversions::agent_from_network;
use tracing::{info, warn};

const SWARM_AGENT_READY_POLL_INTERVAL: Duration = Duration::from_secs(2);
const SWARM_AGENT_READY_TIMEOUT: Duration = Duration::from_secs(90);

fn agent_name_has_supported_format(value: &str) -> bool {
    !value.is_empty()
        && value
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || ch == '-' || ch == '_')
}

fn ensure_supported_agent_name(name: &str) -> ApiResult<()> {
    if agent_name_has_supported_format(name) {
        Ok(())
    } else {
        Err(ApiError::bad_request(
            "agent name must use only letters, numbers, hyphens, or underscores",
        ))
    }
}

fn normalize_environment(
    adapter_type: &str,
    environment: Option<String>,
    machine_type: Option<String>,
) -> ApiResult<String> {
    let resolved = environment.unwrap_or_else(|| match machine_type.as_deref() {
        Some("remote") => "swarm_microvm".to_string(),
        _ => "local_host".to_string(),
    });

    match resolved.as_str() {
        "local_host" => Ok(resolved),
        "swarm_microvm" if adapter_type == "aura_harness" => Ok(resolved),
        "swarm_microvm" => Err(ApiError::bad_request(format!(
            "adapter `{adapter_type}` currently supports only local_host"
        ))),
        _ => Err(ApiError::bad_request(format!(
            "unsupported environment `{resolved}`"
        ))),
    }
}

fn build_runtime_config(
    adapter_type: Option<String>,
    environment: Option<String>,
    auth_source: Option<String>,
    integration_id: Option<String>,
    default_model: Option<String>,
    machine_type: Option<String>,
) -> ApiResult<AgentRuntimeConfig> {
    let adapter_type = adapter_type.unwrap_or_else(|| "aura_harness".to_string());
    match adapter_type.as_str() {
        "aura_harness" | "claude_code" | "codex" | "gemini_cli" | "opencode" | "cursor" => {}
        other => {
            return Err(ApiError::bad_request(format!(
                "unsupported adapter `{other}`"
            )))
        }
    }

    let environment = normalize_environment(&adapter_type, environment, machine_type)?;
    let auth_source = effective_auth_source(
        &adapter_type,
        auth_source.as_deref(),
        integration_id.as_deref(),
    );

    match (adapter_type.as_str(), auth_source.as_str()) {
        ("aura_harness", "aura_managed" | "org_integration") => {}
        (
            "claude_code" | "codex" | "gemini_cli" | "opencode",
            "local_cli_auth" | "org_integration",
        ) => {}
        ("cursor", "local_cli_auth") => {}
        ("aura_harness", other) => {
            return Err(ApiError::bad_request(format!(
                "adapter `{adapter_type}` does not support auth source `{other}`"
            )))
        }
        (_, other) => {
            return Err(ApiError::bad_request(format!(
                "adapter `{adapter_type}` does not support auth source `{other}`"
            )))
        }
    }

    if auth_source == "org_integration"
        && integration_id
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .is_none()
    {
        return Err(ApiError::bad_request(
            "auth source `org_integration` requires an attached integration",
        ));
    }

    let integration_id = if auth_source == "org_integration" {
        integration_id.and_then(|value| {
            let trimmed = value.trim().to_string();
            (!trimmed.is_empty()).then_some(trimmed)
        })
    } else {
        None
    };

    Ok(AgentRuntimeConfig {
        adapter_type,
        environment,
        auth_source,
        integration_id,
        default_model,
    })
}

pub(crate) struct ReprovisionedRemoteAgent {
    pub agent: Agent,
    pub status: String,
}

pub(crate) async fn reprovision_remote_agent(
    state: &AppState,
    client: &NetworkClient,
    jwt: &str,
    net_agent: &NetworkAgent,
) -> ApiResult<ReprovisionedRemoteAgent> {
    let swarm_base_url = state.swarm_base_url.as_deref().ok_or_else(|| {
        ApiError::service_unavailable(
            "swarm gateway is not configured (SWARM_BASE_URL); cannot create remote agent",
        )
    })?;

    let provisioned = provision_swarm_agent(
        client.http_client(),
        swarm_base_url,
        jwt,
        &net_agent.id,
        &net_agent.name,
    )
    .await?;

    let update_req = aura_os_network::UpdateAgentRequest {
        name: None,
        role: None,
        personality: None,
        system_prompt: None,
        skills: None,
        icon: None,
        harness: None,
        machine_type: None,
        vm_id: Some(provisioned.vm_id.clone()),
    };

    let updated_net_agent = client
        .update_agent(&net_agent.id, jwt, &update_req)
        .await
        .map_err(|e| {
            warn!(
                agent_id = %net_agent.id,
                error = %e,
                "Failed to persist vm_id to aura-network after swarm provisioning"
            );
            ApiError::bad_gateway(format!(
                "VM provisioned but failed to update agent record: {e}"
            ))
        })?;

    let mut agent = agent_from_network(&updated_net_agent);
    state
        .agent_service
        .apply_runtime_config(&mut agent)
        .map_err(|e| ApiError::internal(format!("applying agent runtime config: {e}")))?;
    let _ = state.agent_service.save_agent_shadow(&agent);

    info!(
        agent_id = %net_agent.id,
        vm_id = %provisioned.vm_id,
        "Swarm VM provisioned for remote agent"
    );

    if !matches!(provisioned.status.as_str(), "running" | "idle") {
        spawn_swarm_readiness_check(
            client.http_client().clone(),
            swarm_base_url.to_owned(),
            jwt.to_string(),
            provisioned.agent_id.clone(),
            provisioned.vm_id.clone(),
            net_agent.id.clone(),
        );
    }

    Ok(ReprovisionedRemoteAgent {
        agent,
        status: provisioned.status,
    })
}

pub(crate) async fn create_agent(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    Json(body): Json<CreateAgentRequest>,
) -> ApiResult<Json<Agent>> {
    ensure_supported_agent_name(body.name.trim())?;
    let client = state.require_network_client()?;
    let runtime_config = build_runtime_config(
        body.adapter_type.clone(),
        body.environment.clone(),
        body.auth_source.clone(),
        body.integration_id.clone(),
        body.default_model.clone(),
        body.machine_type.clone(),
    )?;
    let machine_type = Some(if runtime_config.environment == "swarm_microvm" {
        "remote".to_string()
    } else {
        "local".to_string()
    });

    let net_req = aura_os_network::CreateAgentRequest {
        org_id: body.org_id.map(|id| id.to_string()),
        name: body.name.trim().to_string(),
        role: Some(body.role),
        personality: Some(body.personality),
        system_prompt: Some(body.system_prompt),
        skills: Some(body.skills),
        icon: body.icon,
        machine_type: machine_type.clone(),
        harness: None,
    };

    let net_agent = client
        .create_agent(&jwt, &net_req)
        .await
        .map_err(map_network_error)?;

    let mut agent = agent_from_network(&net_agent);
    state
        .agent_service
        .save_agent_runtime_config(&agent.agent_id, &runtime_config)
        .map_err(|e| ApiError::internal(format!("saving agent runtime config: {e}")))?;
    state
        .agent_service
        .apply_runtime_config(&mut agent)
        .map_err(|e| ApiError::internal(format!("applying agent runtime config: {e}")))?;
    let _ = state.agent_service.save_agent_shadow(&agent);

    let is_remote = HarnessMode::from_machine_type(machine_type.as_deref().unwrap_or("remote"))
        == HarnessMode::Swarm;

    if is_remote {
        let reprovisioned = reprovision_remote_agent(&state, client, &jwt, &net_agent).await?;
        agent = reprovisioned.agent;
    }

    let _ = state.agent_service.save_agent_shadow(&agent);
    Ok(Json(agent))
}

async fn provision_swarm_agent(
    http: &reqwest::Client,
    swarm_base_url: &str,
    jwt: &str,
    agent_id: &str,
    agent_name: &str,
) -> ApiResult<ProvisionedSwarmAgent> {
    let url = format!("{}/v1/agents", swarm_base_url);
    let provision_name = sanitize_swarm_agent_name(agent_name, agent_id);

    let body = serde_json::json!({
        "name": provision_name,
        "agent_id": agent_id,
    });

    let resp = http
        .post(&url)
        .header("Authorization", format!("Bearer {jwt}"))
        .header("Content-Type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| {
            ApiError::bad_gateway(format!(
                "swarm gateway unreachable during agent provisioning: {e}"
            ))
        })?;

    if !resp.status().is_success() {
        let status = resp.status().as_u16();
        let resp_body = resp.text().await.unwrap_or_default();
        return Err(match status {
            401 => ApiError::unauthorized("swarm gateway rejected auth token"),
            409 => ApiError::conflict(format!("swarm agent already exists: {resp_body}")),
            _ => ApiError::bad_gateway(format!(
                "swarm gateway returned {status} during agent provisioning: {resp_body}"
            )),
        });
    }

    let swarm_resp: aura_os_link::CreateAgentResponse = resp.json().await.map_err(|e| {
        ApiError::internal(format!(
            "failed to parse swarm gateway agent creation response: {e}"
        ))
    })?;

    Ok(ProvisionedSwarmAgent {
        agent_id: swarm_resp.agent_id.clone(),
        vm_id: swarm_resp
            .pod_id
            .unwrap_or_else(|| swarm_resp.agent_id.clone()),
        status: swarm_resp.status,
    })
}

struct ProvisionedSwarmAgent {
    agent_id: String,
    vm_id: String,
    status: String,
}

fn spawn_swarm_readiness_check(
    http: reqwest::Client,
    swarm_base_url: String,
    jwt: String,
    provisioned_agent_id: String,
    vm_id: String,
    agent_id: String,
) {
    tokio::spawn(async move {
        match wait_for_swarm_agent_ready(&http, &swarm_base_url, &jwt, &provisioned_agent_id).await
        {
            Ok(()) => {
                info!(
                    agent_id = %agent_id,
                    vm_id = %vm_id,
                    "Remote agent reached ready state in background"
                );
            }
            Err(SwarmAgentReadyError::Timeout) => {
                warn!(
                    agent_id = %agent_id,
                    vm_id = %vm_id,
                    "Remote agent still provisioning after background readiness timeout"
                );
            }
            Err(SwarmAgentReadyError::ErrorState) => {
                warn!(
                    agent_id = %agent_id,
                    vm_id = %vm_id,
                    "Remote agent entered error state during background readiness check"
                );
            }
            Err(SwarmAgentReadyError::Transport(msg)) => {
                warn!(
                    agent_id = %agent_id,
                    vm_id = %vm_id,
                    error = %msg,
                    "Background readiness check transport error"
                );
            }
            Err(SwarmAgentReadyError::Parse(msg)) => {
                warn!(
                    agent_id = %agent_id,
                    vm_id = %vm_id,
                    error = %msg,
                    "Background readiness check parse error"
                );
            }
        }
    });
}

fn sanitize_swarm_agent_name(agent_name: &str, agent_id: &str) -> String {
    let mut sanitized = String::with_capacity(agent_name.len());
    let mut last_was_separator = false;

    for ch in agent_name.chars() {
        if ch.is_ascii_alphanumeric() || ch == '_' || ch == '-' {
            sanitized.push(ch.to_ascii_lowercase());
            last_was_separator = false;
        } else if !last_was_separator {
            sanitized.push('-');
            last_was_separator = true;
        }
    }

    let sanitized = sanitized.trim_matches('-').trim_matches('_').to_string();
    if !sanitized.is_empty() {
        return sanitized;
    }

    let fallback = agent_id
        .chars()
        .filter(|ch| ch.is_ascii_alphanumeric())
        .take(12)
        .collect::<String>()
        .to_ascii_lowercase();

    if fallback.is_empty() {
        "aura-agent".to_string()
    } else {
        format!("aura-agent-{fallback}")
    }
}

#[derive(serde::Deserialize)]
struct SwarmAgentStateResponse {
    state: String,
}

async fn wait_for_swarm_agent_ready(
    http: &reqwest::Client,
    swarm_base_url: &str,
    jwt: &str,
    agent_id: &str,
) -> Result<(), SwarmAgentReadyError> {
    let url = format!("{}/v1/agents/{agent_id}/state", swarm_base_url);
    let deadline = tokio::time::Instant::now() + SWARM_AGENT_READY_TIMEOUT;

    loop {
        tokio::time::sleep(SWARM_AGENT_READY_POLL_INTERVAL).await;

        if tokio::time::Instant::now() >= deadline {
            return Err(SwarmAgentReadyError::Timeout);
        }

        let resp = http
            .get(&url)
            .header("Authorization", format!("Bearer {jwt}"))
            .send()
            .await
            .map_err(|e| SwarmAgentReadyError::Transport(e.to_string()))?;

        if !resp.status().is_success() {
            let status = resp.status().as_u16();
            let body = resp.text().await.unwrap_or_default();
            warn!(agent_id = %agent_id, status, body, "Swarm agent state check returned non-success");
            continue;
        }

        let state = resp
            .json::<SwarmAgentStateResponse>()
            .await
            .map_err(|e| SwarmAgentReadyError::Parse(e.to_string()))?;

        match state.state.as_str() {
            "running" | "idle" => return Ok(()),
            "error" => {
                return Err(SwarmAgentReadyError::ErrorState);
            }
            other => {
                info!(agent_id = %agent_id, state = %other, "Waiting for remote agent provisioning");
            }
        }
    }
}

enum SwarmAgentReadyError {
    Timeout,
    ErrorState,
    Transport(String),
    Parse(String),
}

pub(crate) async fn list_agents(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
) -> ApiResult<Json<Vec<Agent>>> {
    if let Some(ref client) = state.network_client {
        let net_agents = client.list_agents(&jwt).await.map_err(map_network_error)?;
        let agents: Vec<Agent> = net_agents
            .iter()
            .map(|na| {
                let mut agent = agent_from_network(na);
                let _ = state.agent_service.apply_runtime_config(&mut agent);
                if agent.icon.is_none() {
                    if let Ok(shadow) = state.agent_service.get_agent_local(&agent.agent_id) {
                        agent.icon = shadow.icon;
                    }
                }
                let _ = state.agent_service.save_agent_shadow(&agent);
                agent
            })
            .collect();
        return Ok(Json(agents));
    }

    let agents = state
        .agent_service
        .list_agents()
        .map_err(|e| ApiError::internal(format!("listing agents: {e}")))?;
    Ok(Json(agents))
}

pub(crate) async fn get_agent(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    Path(agent_id): Path<AgentId>,
) -> ApiResult<Json<Agent>> {
    if let Some(ref client) = state.network_client {
        let net_agent = client
            .get_agent(&agent_id.to_string(), &jwt)
            .await
            .map_err(map_network_error)?;
        let mut agent = agent_from_network(&net_agent);
        let _ = state.agent_service.apply_runtime_config(&mut agent);
        if agent.icon.is_none() {
            if let Ok(shadow) = state.agent_service.get_agent_local(&agent.agent_id) {
                agent.icon = shadow.icon;
            }
        }
        let _ = state.agent_service.save_agent_shadow(&agent);
        return Ok(Json(agent));
    }

    let agent = state
        .agent_service
        .get_agent_local(&agent_id)
        .map_err(|e| match e {
            aura_os_agents::AgentError::NotFound => ApiError::not_found("agent not found"),
            _ => ApiError::internal(format!("fetching agent: {e}")),
        })?;
    Ok(Json(agent))
}

pub(crate) async fn update_agent(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    Path(agent_id): Path<AgentId>,
    Json(body): Json<UpdateAgentRequest>,
) -> ApiResult<Json<Agent>> {
    let client = state.require_network_client()?;
    let existing = state
        .agent_service
        .get_agent_async("", &agent_id)
        .await
        .or_else(|_| state.agent_service.get_agent_local(&agent_id))
        .map_err(|e| ApiError::not_found(format!("agent not found: {e}")))?;
    if let Some(name) = body.name.as_ref() {
        let trimmed = name.trim();
        if trimmed != existing.name {
            ensure_supported_agent_name(trimmed)?;
        }
    }
    let merged_machine_type = body
        .machine_type
        .clone()
        .unwrap_or_else(|| existing.machine_type.clone());
    let runtime_config = build_runtime_config(
        body.adapter_type
            .clone()
            .or_else(|| Some(existing.adapter_type.clone())),
        body.environment
            .clone()
            .or_else(|| Some(existing.environment.clone())),
        body.auth_source
            .clone()
            .or_else(|| Some(existing.auth_source.clone())),
        match body.integration_id {
            Some(value) => value,
            None => existing.integration_id.clone(),
        },
        match body.default_model {
            Some(value) => value,
            None => existing.default_model.clone(),
        },
        Some(merged_machine_type.clone()),
    )?;
    let submitted_icon = match &body.icon {
        Some(Some(url)) => Some(url.clone()),
        _ => None,
    };
    let net_req = aura_os_network::UpdateAgentRequest {
        name: body.name.map(|value| value.trim().to_string()),
        role: body.role,
        personality: body.personality,
        system_prompt: body.system_prompt,
        skills: body.skills,
        icon: match body.icon {
            Some(Some(url)) => Some(url),
            Some(None) => Some(String::new()),
            None => None,
        },
        machine_type: Some(if runtime_config.environment == "swarm_microvm" {
            "remote".to_string()
        } else {
            "local".to_string()
        }),
        harness: None,
        vm_id: None,
    };
    let net_agent = client
        .update_agent(&agent_id.to_string(), &jwt, &net_req)
        .await
        .map_err(map_network_error)?;
    state
        .agent_service
        .save_agent_runtime_config(&agent_id, &runtime_config)
        .map_err(|e| ApiError::internal(format!("saving agent runtime config: {e}")))?;
    let mut agent = agent_from_network(&net_agent);
    state
        .agent_service
        .apply_runtime_config(&mut agent)
        .map_err(|e| ApiError::internal(format!("applying agent runtime config: {e}")))?;
    if agent.icon.is_none() {
        agent.icon = submitted_icon.or_else(|| {
            state
                .agent_service
                .get_agent_local(&agent.agent_id)
                .ok()
                .and_then(|s| s.icon)
        });
    }
    let _ = state.agent_service.save_agent_shadow(&agent);
    Ok(Json(agent))
}

pub(crate) async fn delete_agent(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    Path(agent_id): Path<AgentId>,
) -> ApiResult<Json<()>> {
    let client = state.require_network_client()?;

    if let Some(ref storage) = state.storage_client {
        let bindings = resolve_agent_project_bindings(&state, storage, &jwt, &agent_id).await?;
        if !bindings.is_empty() {
            return Err(agent_delete_conflict(&bindings));
        }
    }

    client
        .delete_agent(&agent_id.to_string(), &jwt)
        .await
        .map_err(map_network_error)?;
    let _ = state.agent_service.delete_agent_runtime_config(&agent_id);
    let _ = state.agent_service.delete_agent_shadow(&agent_id);
    Ok(Json(()))
}

#[cfg(test)]
mod tests {
    use super::{
        agent_name_has_supported_format, build_runtime_config, format_agent_binding_details,
        sanitize_swarm_agent_name, AgentProjectBinding,
    };

    #[test]
    fn aura_defaults_to_aura_managed() {
        let config = build_runtime_config(
            Some("aura_harness".to_string()),
            Some("local_host".to_string()),
            None,
            None,
            None,
            Some("local".to_string()),
        )
        .expect("runtime config");

        assert_eq!(config.auth_source, "aura_managed");
        assert_eq!(config.integration_id, None);
    }

    #[test]
    fn cli_defaults_to_local_cli_auth_without_integration() {
        let config = build_runtime_config(
            Some("claude_code".to_string()),
            Some("local_host".to_string()),
            None,
            None,
            None,
            Some("local".to_string()),
        )
        .expect("runtime config");

        assert_eq!(config.auth_source, "local_cli_auth");
        assert_eq!(config.integration_id, None);
    }

    #[test]
    fn integration_attachment_implies_org_integration_for_cli_adapters() {
        let config = build_runtime_config(
            Some("codex".to_string()),
            Some("local_host".to_string()),
            None,
            Some("int-openai".to_string()),
            None,
            Some("local".to_string()),
        )
        .expect("runtime config");

        assert_eq!(config.auth_source, "org_integration");
        assert_eq!(config.integration_id.as_deref(), Some("int-openai"));
    }

    #[test]
    fn gemini_cli_supports_org_integration() {
        let config = build_runtime_config(
            Some("gemini_cli".to_string()),
            Some("local_host".to_string()),
            None,
            Some("int-gemini".to_string()),
            Some("gemini-2.5-pro".to_string()),
            Some("local".to_string()),
        )
        .expect("runtime config");

        assert_eq!(config.auth_source, "org_integration");
        assert_eq!(config.integration_id.as_deref(), Some("int-gemini"));
        assert_eq!(config.default_model.as_deref(), Some("gemini-2.5-pro"));
    }

    #[test]
    fn opencode_supports_org_integration_for_multi_provider_connections() {
        let config = build_runtime_config(
            Some("opencode".to_string()),
            Some("local_host".to_string()),
            None,
            Some("int-openrouter".to_string()),
            Some("openrouter/openai/gpt-4.1-mini".to_string()),
            Some("local".to_string()),
        )
        .expect("runtime config");

        assert_eq!(config.auth_source, "org_integration");
        assert_eq!(config.integration_id.as_deref(), Some("int-openrouter"));
        assert_eq!(
            config.default_model.as_deref(),
            Some("openrouter/openai/gpt-4.1-mini")
        );
    }

    #[test]
    fn cursor_allows_only_local_cli_auth() {
        let error = build_runtime_config(
            Some("cursor".to_string()),
            Some("local_host".to_string()),
            Some("org_integration".to_string()),
            Some("int-openai".to_string()),
            None,
            Some("local".to_string()),
        )
        .expect_err("cursor org integration should fail");

        assert!(format!("{error:?}").contains("does not support auth source"));
    }

    #[test]
    fn org_integration_requires_integration_id() {
        let error = build_runtime_config(
            Some("claude_code".to_string()),
            Some("local_host".to_string()),
            Some("org_integration".to_string()),
            None,
            None,
            Some("local".to_string()),
        )
        .expect_err("missing integration should fail");

        assert!(format!("{error:?}").contains("requires an attached integration"));
    }

    #[test]
    fn swarm_agent_name_is_sanitized_for_gateway() {
        assert_eq!(
            sanitize_swarm_agent_name("Aura Swarm Validation", "12345678-1234"),
            "aura-swarm-validation"
        );
        assert_eq!(
            sanitize_swarm_agent_name("Team's Builder #1", "12345678-1234"),
            "team-s-builder-1"
        );
    }

    #[test]
    fn swarm_agent_name_falls_back_to_agent_id_when_display_name_is_symbols() {
        assert_eq!(
            sanitize_swarm_agent_name("!!!", "ABCDEF12-3456-7890"),
            "aura-agent-abcdef123456"
        );
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

    #[test]
    fn binding_details_list_unique_project_names() {
        let details = format_agent_binding_details(&[
            AgentProjectBinding {
                project_agent_id: "pa-1".to_string(),
                project_id: "p-1".to_string(),
                project_name: "General".to_string(),
            },
            AgentProjectBinding {
                project_agent_id: "pa-2".to_string(),
                project_id: "p-2".to_string(),
                project_name: "General".to_string(),
            },
            AgentProjectBinding {
                project_agent_id: "pa-3".to_string(),
                project_id: "p-3".to_string(),
                project_name: "Workspace".to_string(),
            },
        ]);

        assert_eq!(
            details.as_deref(),
            Some("Still added to: General, Workspace.")
        );
    }

    #[test]
    fn binding_details_summarize_long_project_lists() {
        let details = format_agent_binding_details(&[
            AgentProjectBinding {
                project_agent_id: "pa-1".to_string(),
                project_id: "p-1".to_string(),
                project_name: "Alpha".to_string(),
            },
            AgentProjectBinding {
                project_agent_id: "pa-2".to_string(),
                project_id: "p-2".to_string(),
                project_name: "Beta".to_string(),
            },
            AgentProjectBinding {
                project_agent_id: "pa-3".to_string(),
                project_id: "p-3".to_string(),
                project_name: "Gamma".to_string(),
            },
            AgentProjectBinding {
                project_agent_id: "pa-4".to_string(),
                project_id: "p-4".to_string(),
                project_name: "Delta".to_string(),
            },
        ]);

        assert_eq!(
            details.as_deref(),
            Some("Still added to: Alpha, Beta, Delta and 1 more.")
        );
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub(crate) struct AgentProjectBinding {
    pub project_agent_id: String,
    pub project_id: String,
    pub project_name: String,
}

async fn resolve_agent_project_bindings(
    state: &AppState,
    storage: &aura_os_storage::StorageClient,
    jwt: &str,
    agent_id: &AgentId,
) -> ApiResult<Vec<AgentProjectBinding>> {
    let all_projects = projects::list_all_projects_from_network(state, jwt).await?;
    let agent_id_str = agent_id.to_string();
    let project_ids: Vec<String> = all_projects
        .iter()
        .map(|project| project.project_id.to_string())
        .collect();
    let requests: Vec<_> = project_ids
        .iter()
        .map(|project_id| storage.list_project_agents(project_id, jwt))
        .collect();
    let results = join_all(requests).await;

    let mut bindings = Vec::new();
    for (result, project) in results.into_iter().zip(all_projects.iter()) {
        let agents = result.map_err(map_storage_error)?;
        bindings.extend(
            agents
                .into_iter()
                .filter(|project_agent| project_agent.agent_id.as_deref() == Some(&agent_id_str))
                .map(|project_agent| AgentProjectBinding {
                    project_agent_id: project_agent.id,
                    project_id: project.project_id.to_string(),
                    project_name: project.name.clone(),
                }),
        );
    }

    Ok(bindings)
}

fn format_agent_binding_details(bindings: &[AgentProjectBinding]) -> Option<String> {
    let mut project_names: Vec<&str> = bindings
        .iter()
        .map(|binding| binding.project_name.trim())
        .filter(|name| !name.is_empty())
        .collect();
    project_names.sort_unstable();
    project_names.dedup();

    if project_names.is_empty() {
        return None;
    }

    let preview = project_names.iter().take(3).copied().collect::<Vec<_>>();
    let remaining = project_names.len().saturating_sub(preview.len());
    let suffix = if remaining > 0 {
        format!(" and {remaining} more")
    } else {
        String::new()
    };

    Some(format!("Still added to: {}{}.", preview.join(", "), suffix))
}

fn agent_delete_conflict(bindings: &[AgentProjectBinding]) -> (StatusCode, Json<ApiError>) {
    (
        StatusCode::CONFLICT,
        Json(ApiError {
            error: "Cannot delete agent while it is added to projects. Remove it from all projects first.".to_string(),
            code: "conflict".to_string(),
            details: format_agent_binding_details(bindings),
        }),
    )
}

pub(crate) async fn list_agent_project_bindings(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    Path(agent_id): Path<AgentId>,
) -> ApiResult<Json<Vec<AgentProjectBinding>>> {
    let storage = state.require_storage_client()?;
    let bindings = resolve_agent_project_bindings(&state, storage, &jwt, &agent_id).await?;
    Ok(Json(bindings))
}

pub(crate) async fn remove_agent_project_binding(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    Path((_agent_id, project_agent_id)): Path<(AgentId, String)>,
) -> ApiResult<Json<()>> {
    let storage = state.require_storage_client()?;
    storage
        .delete_project_agent(&project_agent_id, &jwt)
        .await
        .map_err(|e| ApiError::internal(format!("failed to remove binding: {e}")))?;
    Ok(Json(()))
}
