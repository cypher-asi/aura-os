use axum::extract::{Path, State};
use axum::Json;

use aura_os_core::{Agent, AgentId, HarnessMode};

use crate::dto::{CreateAgentRequest, UpdateAgentRequest};
use crate::error::{map_network_error, ApiError, ApiResult};
use crate::handlers::projects;
use crate::state::AppState;

use super::conversions::agent_from_network;
use tracing::{info, warn};

pub(crate) async fn create_agent(
    State(state): State<AppState>,
    Json(body): Json<CreateAgentRequest>,
) -> ApiResult<Json<Agent>> {
    let client = state.require_network_client()?;
    let jwt = state.get_jwt()?;

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

        let vm_id = provision_swarm_agent(
            client.http_client(),
            swarm_base_url,
            &jwt,
            &agent_id_str,
            &agent.name,
        )
        .await?;

        info!(
            agent_id = %agent_id_str,
            vm_id = %vm_id,
            "Swarm VM provisioned for remote agent"
        );

        let update_req = aura_os_network::UpdateAgentRequest {
            name: None,
            role: None,
            personality: None,
            system_prompt: None,
            skills: None,
            icon: None,
            harness: None,
            machine_type: None,
            vm_id: Some(vm_id.clone()),
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
    }

    Ok(Json(agent))
}

async fn provision_swarm_agent(
    http: &reqwest::Client,
    swarm_base_url: &str,
    jwt: &str,
    agent_id: &str,
    agent_name: &str,
) -> ApiResult<String> {
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

    let vm_id = swarm_resp
        .pod_id
        .unwrap_or_else(|| swarm_resp.agent_id.clone());

    Ok(vm_id)
}

pub(crate) async fn list_agents(State(state): State<AppState>) -> ApiResult<Json<Vec<Agent>>> {
    let client = state.require_network_client()?;
    let jwt = state.get_jwt()?;
    let net_agents = client.list_agents(&jwt).await.map_err(map_network_error)?;
    let agents: Vec<Agent> = net_agents.iter().map(agent_from_network).collect();
    Ok(Json(agents))
}

pub(crate) async fn get_agent(
    State(state): State<AppState>,
    Path(agent_id): Path<AgentId>,
) -> ApiResult<Json<Agent>> {
    let client = state.require_network_client()?;
    let jwt = state.get_jwt()?;
    let net_agent = client
        .get_agent(&agent_id.to_string(), &jwt)
        .await
        .map_err(map_network_error)?;
    let agent = agent_from_network(&net_agent);
    Ok(Json(agent))
}

pub(crate) async fn update_agent(
    State(state): State<AppState>,
    Path(agent_id): Path<AgentId>,
    Json(body): Json<UpdateAgentRequest>,
) -> ApiResult<Json<Agent>> {
    let client = state.require_network_client()?;
    let jwt = state.get_jwt()?;
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
    Ok(Json(agent))
}

pub(crate) async fn delete_agent(
    State(state): State<AppState>,
    Path(agent_id): Path<AgentId>,
) -> ApiResult<Json<()>> {
    let client = state.require_network_client()?;
    let jwt = state.get_jwt()?;

    if let Some(ref storage) = state.storage_client {
        let projects = projects::list_all_projects_from_network(&state).await?;
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
    Ok(Json(()))
}
