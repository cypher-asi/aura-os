use axum::extract::{Path, State};
use axum::Json;
use chrono::Utc;

use aura_os_agents::{merge_agent_instance, AgentInstanceService};
use aura_os_core::{
    Agent, AgentId, AgentInstance, AgentInstanceId, AgentRuntimeConfig, AgentStatus, ProjectId,
};

use crate::dto::{CreateAgentInstanceRequest, UpdateAgentInstanceRequest};
use crate::error::{map_storage_error, ApiError, ApiResult};
use crate::state::{AppState, AuthJwt, AuthSession};

use super::conversions::{
    get_user_id, resolve_network_agents, resolve_single_agent, resolve_workspace_path,
};

const GENERAL_AGENT_KIND: &str = "general";
const GENERAL_AGENT_NAME: &str = "New Agent";
const PROJECT_LOCAL_GENERAL_AGENT_TAG: &str = "project_local_general";
const GENERAL_AGENT_SYSTEM_PROMPT: &str =
    "You are a helpful general-purpose agent working inside this project. Assist with planning, implementation, debugging, research, and execution as needed.";

fn build_general_agent(user_id: &str, project: Option<&aura_os_core::Project>) -> Agent {
    let now = Utc::now();
    Agent {
        agent_id: AgentId::new(),
        user_id: user_id.to_string(),
        org_id: project.map(|entry| entry.org_id.clone()),
        name: GENERAL_AGENT_NAME.to_string(),
        role: "general".to_string(),
        personality: String::new(),
        system_prompt: GENERAL_AGENT_SYSTEM_PROMPT.to_string(),
        skills: Vec::new(),
        icon: None,
        machine_type: "local".to_string(),
        adapter_type: "aura_harness".to_string(),
        environment: "local_host".to_string(),
        auth_source: "aura_managed".to_string(),
        integration_id: None,
        default_model: None,
        vm_id: None,
        network_agent_id: None,
        profile_id: None,
        tags: vec![PROJECT_LOCAL_GENERAL_AGENT_TAG.to_string()],
        is_pinned: false,
        created_at: now,
        updated_at: now,
    }
}

fn general_agent_runtime_config() -> AgentRuntimeConfig {
    AgentRuntimeConfig {
        adapter_type: "aura_harness".to_string(),
        environment: "local_host".to_string(),
        auth_source: "aura_managed".to_string(),
        integration_id: None,
        default_model: None,
    }
}

fn attach_workspace_path(
    state: &AppState,
    project_id: &ProjectId,
    project_name: &str,
    instance: &mut AgentInstance,
) {
    instance.workspace_path = Some(resolve_workspace_path(
        &instance.machine_type,
        project_id,
        &state.data_dir,
        project_name,
    ));
}

pub(crate) async fn create_agent_instance(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    AuthSession(session): AuthSession,
    Path(project_id): Path<ProjectId>,
    Json(body): Json<CreateAgentInstanceRequest>,
) -> ApiResult<Json<AgentInstance>> {
    let storage = state.require_storage_client()?;
    let user_id = get_user_id(&session);
    let project = state.project_service.get_project(&project_id).ok();

    let agent = match (body.agent_id, body.kind.as_deref()) {
        (Some(agent_id), None) => state
            .agent_service
            .get_agent_async(&user_id, &agent_id)
            .await
            .map_err(|e| match &e {
                aura_os_agents::AgentError::NotFound => {
                    ApiError::not_found("agent template not found")
                }
                _ => ApiError::internal(format!("looking up agent template: {e}")),
            })?,
        (None, Some(GENERAL_AGENT_KIND)) => {
            let agent = build_general_agent(&user_id, project.as_ref());
            state.agent_service.save_agent_shadow(&agent).map_err(|e| {
                ApiError::internal(format!("saving project-local agent shadow: {e}"))
            })?;
            state
                .agent_service
                .save_agent_runtime_config(&agent.agent_id, &general_agent_runtime_config())
                .map_err(|e| {
                    ApiError::internal(format!("saving project-local agent runtime config: {e}"))
                })?;
            agent
        }
        (None, Some(other)) => {
            return Err(ApiError::bad_request(format!(
                "unsupported agent kind `{other}`"
            )));
        }
        (Some(_), Some(_)) => {
            return Err(ApiError::bad_request(
                "provide either agent_id or kind when creating a project agent",
            ));
        }
        (None, None) => {
            return Err(ApiError::bad_request(
                "agent_id or kind is required when creating a project agent",
            ));
        }
    };

    let req = aura_os_storage::CreateProjectAgentRequest {
        agent_id: agent.agent_id.to_string(),
        name: agent.name.clone(),
        org_id: project.as_ref().map(|entry| entry.org_id.to_string()),
        role: Some(agent.role.clone()),
        personality: Some(agent.personality.clone()),
        system_prompt: Some(agent.system_prompt.clone()),
        skills: Some(agent.skills.clone()),
        icon: agent.icon.clone(),
        harness: None,
    };
    let storage_agent = storage
        .create_project_agent(&project_id.to_string(), &jwt, &req)
        .await
        .map_err(map_storage_error)?;

    let mut instance = merge_agent_instance(&storage_agent, Some(&agent), None);
    attach_workspace_path(
        &state,
        &project_id,
        project
            .as_ref()
            .map(|entry| entry.name.as_str())
            .unwrap_or(""),
        &mut instance,
    );
    Ok(Json(instance))
}

pub(crate) async fn list_agent_instances(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    Path(project_id): Path<ProjectId>,
) -> ApiResult<Json<Vec<AgentInstance>>> {
    let storage = state.require_storage_client()?;
    let storage_agents = storage
        .list_project_agents(&project_id.to_string(), &jwt)
        .await
        .map_err(map_storage_error)?;

    let agent_map = resolve_network_agents(&state, &jwt).await;

    let project = state.project_service.get_project(&project_id).ok();
    let project_name = project.as_ref().map(|p| p.name.clone()).unwrap_or_default();

    let instances: Vec<AgentInstance> = storage_agents
        .iter()
        .map(|spa| {
            let agent = spa.agent_id.as_deref().and_then(|aid| agent_map.get(aid));
            let mut instance = merge_agent_instance(spa, agent, None);
            attach_workspace_path(&state, &project_id, &project_name, &mut instance);
            instance
        })
        .collect();
    Ok(Json(instances))
}

pub(crate) async fn get_agent_instance(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    Path((_project_id, agent_instance_id)): Path<(ProjectId, AgentInstanceId)>,
) -> ApiResult<Json<AgentInstance>> {
    let storage = state.require_storage_client()?;
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
    let mut instance = merge_agent_instance(&storage_agent, agent.as_ref(), None);
    let proj_id_str = storage_agent.project_id.clone().unwrap_or_default();
    let project = proj_id_str
        .parse::<aura_os_core::ProjectId>()
        .ok()
        .and_then(|pid| state.project_service.get_project(&pid).ok());
    let resolved_project_id = proj_id_str
        .parse::<aura_os_core::ProjectId>()
        .unwrap_or_else(|_| aura_os_core::ProjectId::nil());
    attach_workspace_path(
        &state,
        &resolved_project_id,
        project.as_ref().map(|p| p.name.as_str()).unwrap_or(""),
        &mut instance,
    );
    Ok(Json(instance))
}

pub(crate) async fn update_agent_instance(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    Path((_project_id, agent_instance_id)): Path<(ProjectId, AgentInstanceId)>,
    Json(body): Json<UpdateAgentInstanceRequest>,
) -> ApiResult<Json<AgentInstance>> {
    let storage = state.require_storage_client()?;
    let mut storage_agent = storage
        .get_project_agent(&agent_instance_id.to_string(), &jwt)
        .await
        .map_err(map_storage_error)?;

    if let Some(ref submitted_name) = body.name {
        let trimmed = submitted_name.trim();
        if trimmed.is_empty() {
            return Err(ApiError::bad_request("agent name cannot be empty"));
        }

        let raw_agent_id = storage_agent
            .agent_id
            .as_deref()
            .ok_or_else(|| ApiError::bad_request("agent instance cannot be renamed"))?;
        let parsed_agent_id = raw_agent_id
            .parse::<AgentId>()
            .map_err(|_| ApiError::bad_request("agent instance has an invalid agent_id"))?;
        let mut local_agent = state
            .agent_service
            .get_agent_local(&parsed_agent_id)
            .map_err(|_| ApiError::bad_request("agent instance cannot be renamed"))?;

        if !local_agent
            .tags
            .iter()
            .any(|tag| tag == PROJECT_LOCAL_GENERAL_AGENT_TAG)
        {
            return Err(ApiError::bad_request(
                "only project-local general agents can be renamed",
            ));
        }

        if local_agent.name != trimmed {
            local_agent.name = trimmed.to_string();
            local_agent.updated_at = Utc::now();
            state
                .agent_service
                .save_agent_shadow(&local_agent)
                .map_err(|e| {
                    ApiError::internal(format!("saving project-local agent rename: {e}"))
                })?;
        }
    }

    if let Some(ref status_str) = body.status {
        let target = aura_os_agents::parse_agent_status(status_str);
        let current = storage_agent
            .status
            .as_deref()
            .map(aura_os_agents::parse_agent_status)
            .unwrap_or(AgentStatus::Idle);

        AgentInstanceService::validate_transition(current, target).map_err(|e| {
            ApiError::bad_request(format!("validating agent status transition: {e}"))
        })?;

        let req = aura_os_storage::UpdateProjectAgentRequest {
            status: status_str.clone(),
        };
        storage
            .update_project_agent_status(&agent_instance_id.to_string(), &jwt, &req)
            .await
            .map_err(map_storage_error)?;
        storage_agent = storage
            .get_project_agent(&agent_instance_id.to_string(), &jwt)
            .await
            .map_err(map_storage_error)?;
    }

    let agent = if let Some(ref aid) = storage_agent.agent_id {
        resolve_single_agent(&state, &jwt, aid).await
    } else {
        None
    };
    let mut instance = merge_agent_instance(&storage_agent, agent.as_ref(), None);
    let proj_id_str = storage_agent.project_id.clone().unwrap_or_default();
    let project = proj_id_str
        .parse::<aura_os_core::ProjectId>()
        .ok()
        .and_then(|pid| state.project_service.get_project(&pid).ok());
    let resolved_project_id = proj_id_str
        .parse::<aura_os_core::ProjectId>()
        .unwrap_or_else(|_| aura_os_core::ProjectId::nil());
    attach_workspace_path(
        &state,
        &resolved_project_id,
        project.as_ref().map(|p| p.name.as_str()).unwrap_or(""),
        &mut instance,
    );
    Ok(Json(instance))
}

pub(crate) async fn delete_agent_instance(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    Path((_project_id, agent_instance_id)): Path<(ProjectId, AgentInstanceId)>,
) -> ApiResult<Json<()>> {
    let storage = state.require_storage_client()?;
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
