use std::collections::HashSet;

use axum::extract::{Path, State};
use axum::Json;
use chrono::Utc;

use aura_os_agents::{merge_agent_instance, AgentInstanceService, AgentService};
use aura_os_core::{
    Agent, AgentId, AgentInstance, AgentInstanceId, AgentRuntimeConfig, AgentStatus, ProjectId,
};

use crate::dto::{CreateAgentInstanceRequest, UpdateAgentInstanceRequest};
use crate::error::{map_storage_error, ApiError, ApiResult};
use crate::handlers::projects_helpers::ensure_canonical_workspace_dir;
use crate::state::{AppState, AuthJwt, AuthSession};

use super::conversions::{
    get_user_id, resolve_merge_agents_for_ids, resolve_single_agent, resolve_workspace_path,
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
        listing_status: Default::default(),
        expertise: Vec::new(),
        jobs: 0,
        revenue_usd: 0.0,
        reputation: 0.0,
        local_workspace_path: None,
        permissions: aura_os_core::AgentPermissions::empty(),
        intent_classifier: None,
        created_at: now,
        updated_at: now,
    }
}

/// If a project-local general agent's shadow name has been lost (empty after
/// trim), restore it to the canonical `"New Agent"` default and persist the
/// repaired shadow. This lets the UI's first-message rename flow
/// (`maybeRenameFromFirstPrompt`) trigger the same way it does for freshly
/// created generic project agents, whose rename guard checks for the exact
/// string `"New Agent"`.
///
/// Returns `true` when the agent was mutated and a save was attempted.
pub(super) fn repair_general_agent_name_in_place(
    agent_service: &AgentService,
    agent: &mut Agent,
) -> bool {
    let is_general = agent
        .tags
        .iter()
        .any(|tag| tag == PROJECT_LOCAL_GENERAL_AGENT_TAG);
    if !is_general || !agent.name.trim().is_empty() {
        return false;
    }
    agent.name = GENERAL_AGENT_NAME.to_string();
    agent.updated_at = Utc::now();
    if let Err(e) = agent_service.save_agent_shadow(agent) {
        tracing::warn!(
            error = %e,
            agent_id = %agent.agent_id,
            "failed to repair missing project-local general agent name",
        );
    }
    true
}

fn repair_general_agent_name_if_missing(
    agent_service: &AgentService,
    agent: Option<Agent>,
) -> Option<Agent> {
    let mut agent = agent?;
    repair_general_agent_name_in_place(agent_service, &mut agent);
    Some(agent)
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
    project: Option<&aura_os_core::Project>,
    instance: &mut AgentInstance,
) {
    let project_local_path = project.and_then(|p| p.local_workspace_path.as_deref());
    let project_name = project.map(|p| p.name.as_str()).unwrap_or("");
    // Load the agent template shadow so we can apply its `local_workspace_path`
    // override when resolving for a local instance. Falls back gracefully when
    // the template isn't cached locally.
    let agent_local_path = if instance.machine_type == "local" {
        state
            .agent_service
            .get_agent_local(&instance.agent_id)
            .ok()
            .and_then(|a| a.local_workspace_path)
    } else {
        None
    };
    instance.workspace_path = Some(resolve_workspace_path(
        &instance.machine_type,
        project_id,
        &state.data_dir,
        project_name,
        project_local_path,
        agent_local_path.as_deref(),
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

    if agent.machine_type == "local" {
        ensure_canonical_workspace_dir(&state.data_dir, &project_id)?;
    }

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
        permissions: Some(agent.permissions.clone()),
        intent_classifier: agent.intent_classifier.clone(),
    };
    let storage_agent = storage
        .create_project_agent(&project_id.to_string(), &jwt, &req)
        .await
        .map_err(map_storage_error)?;

    let mut instance = merge_agent_instance(&storage_agent, Some(&agent), None);
    attach_workspace_path(&state, &project_id, project.as_ref(), &mut instance);
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

    let needed_agent_ids: HashSet<String> = storage_agents
        .iter()
        .filter_map(|spa| spa.agent_id.clone())
        .collect();

    let mut agent_map = resolve_merge_agents_for_ids(&state, &jwt, &needed_agent_ids).await;
    for agent in agent_map.values_mut() {
        repair_general_agent_name_in_place(&state.agent_service, agent);
    }

    let project = state.project_service.get_project(&project_id).ok();

    let instances: Vec<AgentInstance> = storage_agents
        .iter()
        .map(|spa| {
            let agent = spa.agent_id.as_deref().and_then(|aid| agent_map.get(aid));
            let mut instance = merge_agent_instance(spa, agent, None);
            attach_workspace_path(&state, &project_id, project.as_ref(), &mut instance);
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

    let resolved = if let Some(ref aid) = storage_agent.agent_id {
        resolve_single_agent(&state, &jwt, aid).await
    } else {
        None
    };
    let agent = repair_general_agent_name_if_missing(&state.agent_service, resolved);
    let mut instance = merge_agent_instance(&storage_agent, agent.as_ref(), None);
    let proj_id_str = storage_agent.project_id.clone().unwrap_or_default();
    let project = proj_id_str
        .parse::<aura_os_core::ProjectId>()
        .ok()
        .and_then(|pid| state.project_service.get_project(&pid).ok());
    let resolved_project_id = proj_id_str
        .parse::<aura_os_core::ProjectId>()
        .unwrap_or_else(|_| aura_os_core::ProjectId::nil());
    attach_workspace_path(&state, &resolved_project_id, project.as_ref(), &mut instance);
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
    attach_workspace_path(&state, &resolved_project_id, project.as_ref(), &mut instance);
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

#[cfg(test)]
mod tests {
    use super::*;
    use aura_os_store::SettingsStore;
    use std::sync::Arc;

    fn make_agent(name: &str, tags: Vec<String>) -> Agent {
        let now = Utc::now();
        Agent {
            agent_id: AgentId::new(),
            user_id: "u1".to_string(),
            org_id: None,
            name: name.to_string(),
            role: "general".to_string(),
            personality: String::new(),
            system_prompt: String::new(),
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
            tags,
            is_pinned: false,
            listing_status: Default::default(),
            expertise: Vec::new(),
            jobs: 0,
            revenue_usd: 0.0,
            reputation: 0.0,
            local_workspace_path: None,
            permissions: aura_os_core::AgentPermissions::empty(),
            intent_classifier: None,
            created_at: now,
            updated_at: now,
        }
    }

    fn make_service() -> (AgentService, tempfile::TempDir) {
        let dir = tempfile::tempdir().unwrap();
        let store = Arc::new(SettingsStore::open(dir.path()).unwrap());
        (AgentService::new(store, None), dir)
    }

    #[test]
    fn repairs_empty_name_on_general_agent_and_persists_shadow() {
        let (service, _dir) = make_service();
        let agent = make_agent("", vec![PROJECT_LOCAL_GENERAL_AGENT_TAG.to_string()]);
        let agent_id = agent.agent_id.clone();
        service.save_agent_shadow(&agent).unwrap();

        let repaired =
            repair_general_agent_name_if_missing(&service, Some(agent)).expect("repaired agent");
        assert_eq!(repaired.name, GENERAL_AGENT_NAME);

        let reloaded = service.get_agent_local(&agent_id).unwrap();
        assert_eq!(reloaded.name, GENERAL_AGENT_NAME);
    }

    #[test]
    fn repairs_whitespace_only_name_on_general_agent() {
        let (service, _dir) = make_service();
        let agent = make_agent("   ", vec![PROJECT_LOCAL_GENERAL_AGENT_TAG.to_string()]);
        let agent_id = agent.agent_id.clone();
        service.save_agent_shadow(&agent).unwrap();

        let repaired = repair_general_agent_name_if_missing(&service, Some(agent)).unwrap();
        assert_eq!(repaired.name, GENERAL_AGENT_NAME);

        let reloaded = service.get_agent_local(&agent_id).unwrap();
        assert_eq!(reloaded.name, GENERAL_AGENT_NAME);
    }

    #[test]
    fn preserves_existing_name_on_general_agent() {
        let (service, _dir) = make_service();
        let agent = make_agent(
            "My Named Agent",
            vec![PROJECT_LOCAL_GENERAL_AGENT_TAG.to_string()],
        );
        let agent_id = agent.agent_id.clone();
        service.save_agent_shadow(&agent).unwrap();

        let repaired = repair_general_agent_name_if_missing(&service, Some(agent)).unwrap();
        assert_eq!(repaired.name, "My Named Agent");

        let reloaded = service.get_agent_local(&agent_id).unwrap();
        assert_eq!(reloaded.name, "My Named Agent");
    }

    #[test]
    fn does_not_touch_non_general_agents_with_empty_name() {
        let (service, _dir) = make_service();
        let agent = make_agent("", Vec::new());
        let agent_id = agent.agent_id.clone();
        service.save_agent_shadow(&agent).unwrap();

        let passthrough = repair_general_agent_name_if_missing(&service, Some(agent)).unwrap();
        assert_eq!(passthrough.name, "");

        let reloaded = service.get_agent_local(&agent_id).unwrap();
        assert_eq!(reloaded.name, "");
    }

    #[test]
    fn returns_none_when_input_is_none() {
        let (service, _dir) = make_service();
        assert!(repair_general_agent_name_if_missing(&service, None).is_none());
    }

    #[test]
    fn agent_deserializes_with_missing_name_key_as_empty_string() {
        let original = make_agent(
            "Ignored",
            vec![PROJECT_LOCAL_GENERAL_AGENT_TAG.to_string()],
        );
        let mut value = serde_json::to_value(&original).unwrap();
        value
            .as_object_mut()
            .expect("agent json object")
            .remove("name");
        let agent: Agent =
            serde_json::from_value(value).expect("missing name key should deserialize to default");
        assert_eq!(agent.name, "");
    }

    #[test]
    fn repair_runs_on_agent_whose_stored_json_had_no_name_key() {
        let (service, _dir) = make_service();
        let original = make_agent(
            "placeholder",
            vec![PROJECT_LOCAL_GENERAL_AGENT_TAG.to_string()],
        );
        let agent_id = original.agent_id.clone();

        let mut value = serde_json::to_value(&original).unwrap();
        value
            .as_object_mut()
            .expect("agent json object")
            .remove("name");
        let reloaded: Agent = serde_json::from_value(value).unwrap();
        assert_eq!(reloaded.name, "");
        service.save_agent_shadow(&reloaded).unwrap();

        let repaired = repair_general_agent_name_if_missing(&service, Some(reloaded)).unwrap();
        assert_eq!(repaired.name, GENERAL_AGENT_NAME);

        let disk = service.get_agent_local(&agent_id).unwrap();
        assert_eq!(disk.name, GENERAL_AGENT_NAME);
    }
}
