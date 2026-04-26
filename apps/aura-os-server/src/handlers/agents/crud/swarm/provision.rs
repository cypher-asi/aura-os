use aura_os_core::Agent;
use aura_os_network::{NetworkAgent, NetworkClient};
use tracing::{info, warn};

use crate::error::{ApiError, ApiResult};
use crate::handlers::agents::conversions::agent_from_network;
use crate::state::AppState;

use super::readiness::spawn_swarm_readiness_check;
use super::{ProvisionedSwarmAgent, ReprovisionedRemoteAgent};

/// Provision a brand-new Swarm machine for an agent (used by `create_agent`).
/// Does NOT delete an existing machine first.
pub(in crate::handlers::agents::crud) async fn provision_remote_agent(
    state: &AppState,
    client: &NetworkClient,
    jwt: &str,
    net_agent: &NetworkAgent,
) -> ApiResult<ReprovisionedRemoteAgent> {
    let previous_vm_id = net_agent.vm_id.clone();
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

    let agent = persist_vm_id(state, client, jwt, net_agent, &provisioned.vm_id).await?;

    info!(
        agent_id = %net_agent.id,
        vm_id = %provisioned.vm_id,
        "Swarm VM provisioned for new remote agent"
    );

    if !matches!(provisioned.status.as_str(), "running" | "idle") {
        spawn_swarm_readiness_check(super::readiness::BackgroundReadinessTask {
            http: client.http_client().clone(),
            swarm_base_url: swarm_base_url.to_owned(),
            jwt: jwt.to_string(),
            provisioned_agent_id: provisioned.agent_id.clone(),
            vm_id: provisioned.vm_id.clone(),
            agent_id: net_agent.id.clone(),
        });
    }

    Ok(ReprovisionedRemoteAgent {
        agent,
        status: provisioned.status,
        previous_vm_id,
    })
}

pub(super) async fn persist_vm_id(
    state: &AppState,
    client: &NetworkClient,
    jwt: &str,
    net_agent: &NetworkAgent,
    vm_id: &str,
) -> ApiResult<Agent> {
    let update_req = aura_os_network::UpdateAgentRequest {
        name: None,
        role: None,
        personality: None,
        system_prompt: None,
        skills: None,
        icon: None,
        harness: None,
        machine_type: None,
        vm_id: Some(vm_id.to_string()),
        tags: None,
        listing_status: None,
        expertise: None,
        permissions: None,
        intent_classifier: None,
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
    Ok(agent)
}

pub(super) async fn provision_swarm_agent(
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

    let swarm_resp: aura_os_harness::CreateAgentResponse = resp.json().await.map_err(|e| {
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

#[cfg(test)]
mod tests {
    use super::sanitize_swarm_agent_name;

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
}
