use axum::extract::{Path, State};
use axum::Json;

use aura_os_agents::{merge_agent_instance, AgentInstanceService};
use aura_os_core::{AgentInstance, AgentInstanceId, AgentStatus, ProjectId};

use crate::dto::{CreateAgentInstanceRequest, UpdateAgentInstanceRequest};
use crate::error::{map_storage_error, ApiError, ApiResult};
use crate::state::AppState;

use super::conversions::{get_user_id, resolve_network_agents, resolve_single_agent};

pub(crate) async fn create_agent_instance(
    State(state): State<AppState>,
    Path(project_id): Path<ProjectId>,
    Json(body): Json<CreateAgentInstanceRequest>,
) -> ApiResult<Json<AgentInstance>> {
    let storage = state.require_storage_client()?;
    let user_id = get_user_id(&state)?;

    let agent = state
        .agent_service
        .get_agent_async(&user_id, &body.agent_id)
        .await
        .map_err(|e| match &e {
            aura_os_agents::AgentError::NotFound => ApiError::not_found("agent template not found"),
            _ => ApiError::internal(format!("looking up agent template: {e}")),
        })?;

    let req = aura_os_storage::CreateProjectAgentRequest {
        agent_id: body.agent_id.to_string(),
        name: agent.name.clone(),
        role: Some(agent.role.clone()),
        personality: Some(agent.personality.clone()),
        system_prompt: Some(agent.system_prompt.clone()),
        skills: Some(agent.skills.clone()),
        icon: agent.icon.clone(),
        harness: None,
    };
    let jwt = state.get_jwt()?;
    let storage_agent = storage
        .create_project_agent(&project_id.to_string(), &jwt, &req)
        .await
        .map_err(map_storage_error)?;

    let instance = merge_agent_instance(&storage_agent, Some(&agent), None);
    Ok(Json(instance))
}

pub(crate) async fn list_agent_instances(
    State(state): State<AppState>,
    Path(project_id): Path<ProjectId>,
) -> ApiResult<Json<Vec<AgentInstance>>> {
    let storage = state.require_storage_client()?;
    let jwt = state.get_jwt()?;
    let storage_agents = storage
        .list_project_agents(&project_id.to_string(), &jwt)
        .await
        .map_err(map_storage_error)?;

    let agent_map = resolve_network_agents(&state, &jwt).await;

    let instances: Vec<AgentInstance> = storage_agents
        .iter()
        .map(|spa| {
            let agent = spa.agent_id.as_deref().and_then(|aid| agent_map.get(aid));
            merge_agent_instance(spa, agent, None)
        })
        .collect();
    Ok(Json(instances))
}

pub(crate) async fn get_agent_instance(
    State(state): State<AppState>,
    Path((_project_id, agent_instance_id)): Path<(ProjectId, AgentInstanceId)>,
) -> ApiResult<Json<AgentInstance>> {
    let storage = state.require_storage_client()?;
    let jwt = state.get_jwt()?;
    let storage_agent = storage
        .get_project_agent(&agent_instance_id.to_string(), &jwt)
        .await
        .map_err(|e| match &e {
            aura_os_storage::StorageError::Server { status: 404, .. } => {
                ApiError::not_found("agent instance not found")
            }
            _ => map_storage_error(e),
        })?;

    let agent = if let Some(ref aid) = storage_agent.agent_id {
        resolve_single_agent(&state, &jwt, aid).await
    } else {
        None
    };
    let instance = merge_agent_instance(&storage_agent, agent.as_ref(), None);
    Ok(Json(instance))
}

pub(crate) async fn update_agent_instance(
    State(state): State<AppState>,
    Path((_project_id, agent_instance_id)): Path<(ProjectId, AgentInstanceId)>,
    Json(body): Json<UpdateAgentInstanceRequest>,
) -> ApiResult<Json<AgentInstance>> {
    let storage = state.require_storage_client()?;
    let jwt = state.get_jwt()?;

    if let Some(ref status_str) = body.status {
        let target = aura_os_agents::parse_agent_status(status_str);

        let current_spa = storage
            .get_project_agent(&agent_instance_id.to_string(), &jwt)
            .await
            .map_err(map_storage_error)?;
        let current = current_spa
            .status
            .as_deref()
            .map(aura_os_agents::parse_agent_status)
            .unwrap_or(AgentStatus::Idle);

        AgentInstanceService::validate_transition(current, target)
            .map_err(|e| ApiError::bad_request(format!("validating agent status transition: {e}")))?;

        let req = aura_os_storage::UpdateProjectAgentRequest {
            status: status_str.clone(),
        };
        storage
            .update_project_agent_status(&agent_instance_id.to_string(), &jwt, &req)
            .await
            .map_err(map_storage_error)?;
    }

    let storage_agent = storage
        .get_project_agent(&agent_instance_id.to_string(), &jwt)
        .await
        .map_err(map_storage_error)?;

    let agent = if let Some(ref aid) = storage_agent.agent_id {
        resolve_single_agent(&state, &jwt, aid).await
    } else {
        None
    };
    let instance = merge_agent_instance(&storage_agent, agent.as_ref(), None);
    Ok(Json(instance))
}

pub(crate) async fn delete_agent_instance(
    State(state): State<AppState>,
    Path((_project_id, agent_instance_id)): Path<(ProjectId, AgentInstanceId)>,
) -> ApiResult<Json<()>> {
    let storage = state.require_storage_client()?;
    let jwt = state.get_jwt()?;
    storage
        .delete_project_agent(&agent_instance_id.to_string(), &jwt)
        .await
        .map_err(|e| {
            if let aura_os_storage::StorageError::Server { status, body } = &e {
                let url = format!(
                    "{}/api/project-agents/{}",
                    storage.base_url(),
                    agent_instance_id
                );
                tracing::error!(
                    request_url = %url,
                    storage_status = %status,
                    storage_body = %body,
                    "aura-storage DELETE /api/project-agents/:id failed — full remote error above"
                );
            }
            match &e {
                aura_os_storage::StorageError::Server { status: 404, .. } => {
                    ApiError::not_found("agent instance not found")
                }
                _ => map_storage_error(e),
            }
        })?;
    Ok(Json(()))
}
