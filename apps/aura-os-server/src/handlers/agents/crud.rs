use axum::extract::{Path, State};
use axum::Json;
use futures_util::future::join_all;
use serde::Serialize;
use std::time::Duration;

use aura_os_core::{Agent, AgentId, HarnessMode};

use crate::dto::{CreateAgentRequest, UpdateAgentRequest};
use crate::error::{map_network_error, ApiError, ApiResult};
use crate::handlers::projects;
use crate::state::{AppState, AuthJwt};

use super::conversions::agent_from_network;
use tracing::{info, warn};

const SWARM_AGENT_READY_POLL_INTERVAL: Duration = Duration::from_secs(2);
const SWARM_AGENT_READY_TIMEOUT: Duration = Duration::from_secs(90);

pub(crate) async fn create_agent(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    Json(body): Json<CreateAgentRequest>,
) -> ApiResult<Json<Agent>> {
    let client = state.require_network_client()?;

    let machine_type = body.machine_type.clone();

    let net_req = aura_os_network::CreateAgentRequest {
        name: body.name,
        role: Some(body.role),
        personality: Some(body.personality),
        system_prompt: Some(body.system_prompt),
        skills: Some(body.skills),
        icon: body.icon,
        machine_type: machine_type.clone(),
        harness: None,
        org_id: None,
    };

    let net_agent = client
        .create_agent(&jwt, &net_req)
        .await
        .map_err(map_network_error)?;

    let agent_id_str = net_agent.id.clone();
    let mut agent = agent_from_network(&net_agent);

    let is_remote = HarnessMode::from_machine_type(machine_type.as_deref().unwrap_or("remote"))
        == HarnessMode::Swarm;

    if is_remote {
        let swarm_base_url = state.swarm_base_url.as_deref().ok_or_else(|| {
            ApiError::service_unavailable(
                "swarm gateway is not configured (SWARM_BASE_URL); cannot create remote agent",
            )
        })?;

        let provisioned = provision_swarm_agent(
            client.http_client(),
            swarm_base_url,
            &jwt,
            &agent_id_str,
            &agent.name,
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
            .update_agent(&agent_id_str, &jwt, &update_req)
            .await
            .map_err(|e| {
                warn!(
                    agent_id = %agent_id_str,
                    error = %e,
                    "Failed to persist vm_id to aura-network after swarm provisioning"
                );
                ApiError::bad_gateway(format!(
                    "VM provisioned but failed to update agent record: {e}"
                ))
            })?;

        agent = agent_from_network(&updated_net_agent);

        info!(
            agent_id = %agent_id_str,
            vm_id = %provisioned.vm_id,
            "Swarm VM provisioned for remote agent"
        );

        if !matches!(provisioned.status.as_str(), "running" | "idle") {
            let bg_http = client.http_client().clone();
            let bg_swarm_url = swarm_base_url.to_owned();
            let bg_jwt = jwt.clone();
            let bg_prov_agent_id = provisioned.agent_id.clone();
            let bg_vm_id = provisioned.vm_id.clone();
            let bg_agent_id_str = agent_id_str.clone();

            tokio::spawn(async move {
                match wait_for_swarm_agent_ready(
                    &bg_http,
                    &bg_swarm_url,
                    &bg_jwt,
                    &bg_prov_agent_id,
                )
                .await
                {
                    Ok(()) => {
                        info!(
                            agent_id = %bg_agent_id_str,
                            vm_id = %bg_vm_id,
                            "Remote agent reached ready state in background"
                        );
                    }
                    Err(SwarmAgentReadyError::Timeout) => {
                        warn!(
                            agent_id = %bg_agent_id_str,
                            vm_id = %bg_vm_id,
                            "Remote agent still provisioning after background readiness timeout"
                        );
                    }
                    Err(SwarmAgentReadyError::ErrorState) => {
                        warn!(
                            agent_id = %bg_agent_id_str,
                            vm_id = %bg_vm_id,
                            "Remote agent entered error state during background readiness check"
                        );
                    }
                    Err(SwarmAgentReadyError::Transport(msg)) => {
                        warn!(
                            agent_id = %bg_agent_id_str,
                            vm_id = %bg_vm_id,
                            error = %msg,
                            "Background readiness check transport error"
                        );
                    }
                    Err(SwarmAgentReadyError::Parse(msg)) => {
                        warn!(
                            agent_id = %bg_agent_id_str,
                            vm_id = %bg_vm_id,
                            error = %msg,
                            "Background readiness check parse error"
                        );
                    }
                }
            });
        }
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

    let body = serde_json::json!({
        "name": agent_name,
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
                let agent = agent_from_network(na);
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
        let agent = agent_from_network(&net_agent);
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
    let net_req = aura_os_network::UpdateAgentRequest {
        name: body.name,
        role: body.role,
        personality: body.personality,
        system_prompt: body.system_prompt,
        skills: body.skills,
        icon: match body.icon {
            Some(Some(url)) => Some(url),
            Some(None) => Some(String::new()),
            None => None,
        },
        machine_type: body.machine_type,
        harness: None,
        vm_id: None,
    };
    let net_agent = client
        .update_agent(&agent_id.to_string(), &jwt, &net_req)
        .await
        .map_err(map_network_error)?;
    let agent = agent_from_network(&net_agent);
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
        let projects = projects::list_all_projects_from_network(&state, &jwt).await?;
        let agent_id_str = agent_id.to_string();
        for project in &projects {
            if let Ok(agents) = storage
                .list_project_agents(&project.project_id.to_string(), &jwt)
                .await
            {
                let has_match = agents
                    .iter()
                    .any(|a| a.agent_id.as_deref() == Some(&agent_id_str));
                if has_match {
                    return Err(ApiError::conflict(
                        "Cannot delete agent while it is added to projects. Remove it from all projects first.",
                    ));
                }
            }
        }
    }

    client
        .delete_agent(&agent_id.to_string(), &jwt)
        .await
        .map_err(map_network_error)?;
    let _ = state.agent_service.delete_agent_shadow(&agent_id);
    Ok(Json(()))
}

#[derive(Serialize)]
pub(crate) struct AgentProjectBinding {
    pub project_agent_id: String,
    pub project_id: String,
    pub project_name: String,
}

pub(crate) async fn list_agent_project_bindings(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    Path(agent_id): Path<AgentId>,
) -> ApiResult<Json<Vec<AgentProjectBinding>>> {
    let storage = state.require_storage_client()?;
    let all_projects = projects::list_all_projects_from_network(&state, &jwt).await?;
    let agent_id_str = agent_id.to_string();

    let project_ids: Vec<String> = all_projects
        .iter()
        .map(|p| p.project_id.to_string())
        .collect();
    let futs: Vec<_> = project_ids
        .iter()
        .map(|pid| storage.list_project_agents(pid, &jwt))
        .collect();
    let results = join_all(futs).await;

    let mut bindings = Vec::new();
    for (result, project) in results.into_iter().zip(all_projects.iter()) {
        if let Ok(agents) = result {
            for pa in agents {
                if pa.agent_id.as_deref() == Some(&agent_id_str) {
                    bindings.push(AgentProjectBinding {
                        project_agent_id: pa.id.clone(),
                        project_id: project.project_id.to_string(),
                        project_name: project.name.clone(),
                    });
                }
            }
        }
    }

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
