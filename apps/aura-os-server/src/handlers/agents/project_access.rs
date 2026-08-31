//! Agent-callable project creation and handoff endpoints.
//!
//! These routes are deliberately scoped to the agent named in the path and
//! gated by its project permissions. They do more than proxy `POST /projects`:
//! the calling agent is idempotently bound to the target project and, when the
//! current storage session is supplied by the server-installed tool, the
//! conversation is copied into a project-scoped session that can be continued
//! immediately.

use aura_os_agents::merge_agent_instance;
use aura_os_core::{
    Agent, AgentId, AgentInstance, AgentInstanceId, Capability, OrgId, Project, ProjectId,
};
use aura_os_storage::{CreateSessionEventRequest, CreateSessionRequest, StorageClient};
use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::Json;
use serde::{Deserialize, Serialize};
use tracing::{info, warn};

use crate::dto::CreateProjectRequest;
use crate::error::{map_storage_error, ApiError, ApiResult};
use crate::handlers::projects::{create_project_impl, get_project_impl};
use crate::handlers::projects_helpers::slugify;
use crate::state::{AppState, AuthJwt, AuthSession};

#[derive(Debug, Default, Deserialize)]
pub(crate) struct AgentProjectQuery {
    #[serde(default)]
    org_id: Option<OrgId>,
    #[serde(default)]
    source_session_id: Option<String>,
}

#[derive(Debug, Deserialize)]
pub(crate) struct AgentCreateProjectRequest {
    name: String,
    #[serde(default)]
    description: String,
    #[serde(default)]
    build_command: Option<String>,
    #[serde(default)]
    test_command: Option<String>,
    #[serde(default = "default_move_conversation")]
    move_current_conversation: bool,
}

#[derive(Debug, Deserialize)]
pub(crate) struct AgentAccessProjectRequest {
    project_id: ProjectId,
    #[serde(default = "default_move_conversation")]
    move_current_conversation: bool,
}

const fn default_move_conversation() -> bool {
    true
}

const MAX_PROJECT_HANDOFF_EVENTS: u32 = 1_000;

#[derive(Debug, Serialize)]
pub(crate) struct AgentProjectAccessResponse {
    project_id: ProjectId,
    agent_instance_id: AgentInstanceId,
    project: Project,
    agent_instance: AgentInstance,
    session_id: Option<String>,
    copied_event_count: usize,
    conversation_moved: bool,
    chat_route: String,
    project_route: String,
}

pub(crate) async fn create_project_for_agent(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    AuthSession(session): AuthSession,
    Path(agent_id): Path<AgentId>,
    Query(query): Query<AgentProjectQuery>,
    Json(body): Json<AgentCreateProjectRequest>,
) -> ApiResult<(StatusCode, Json<AgentProjectAccessResponse>)> {
    let agent = load_authorized_agent(&state, &jwt, &session.user_id, &agent_id).await?;
    let name = body.name.trim();
    if name.is_empty() {
        return Err(ApiError::bad_request("name must not be empty"));
    }
    let org_id = query
        .org_id
        .or(agent.org_id)
        .ok_or_else(|| ApiError::bad_request("org_id is required to create a project"))?;
    let request = CreateProjectRequest {
        org_id,
        name: name.to_string(),
        description: body.description.trim().to_string(),
        build_command: body.build_command,
        test_command: body.test_command,
        git_repo_url: None,
        git_branch: None,
        orbit_base_url: None,
        orbit_owner: None,
        orbit_repo: None,
        local_workspace_path: None,
    };
    let (_, Json(project)) =
        create_project_impl(&state, &request, Some(slugify(name)), &jwt).await?;
    let response = prepare_project_access(
        &state,
        &jwt,
        &agent,
        project,
        query.source_session_id.as_deref(),
        body.move_current_conversation,
    )
    .await?;

    Ok((StatusCode::CREATED, Json(response)))
}

pub(crate) async fn access_project_for_agent(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    AuthSession(session): AuthSession,
    Path(agent_id): Path<AgentId>,
    Query(query): Query<AgentProjectQuery>,
    Json(body): Json<AgentAccessProjectRequest>,
) -> ApiResult<Json<AgentProjectAccessResponse>> {
    let agent = load_authorized_agent(&state, &jwt, &session.user_id, &agent_id).await?;
    let project = get_project_impl(&state, &jwt, body.project_id).await?;
    let response = prepare_project_access(
        &state,
        &jwt,
        &agent,
        project,
        query.source_session_id.as_deref(),
        body.move_current_conversation,
    )
    .await?;

    Ok(Json(response))
}

async fn load_authorized_agent(
    state: &AppState,
    jwt: &str,
    caller_user_id: &str,
    agent_id: &AgentId,
) -> ApiResult<Agent> {
    let mut agent = if state.network_client.is_some() {
        state
            .agent_service
            .get_agent_with_jwt(jwt, agent_id)
            .await
            .map_err(|error| match error {
                aura_os_agents::AgentError::NotFound => ApiError::not_found("agent not found"),
                other => ApiError::internal(format!("loading agent: {other}")),
            })?
    } else {
        let agent = state
            .agent_service
            .get_agent_local(agent_id)
            .map_err(|error| match error {
                aura_os_agents::AgentError::NotFound => ApiError::not_found("agent not found"),
                other => ApiError::internal(format!("loading local agent: {other}")),
            })?;
        if agent.user_id != caller_user_id {
            return Err(ApiError::not_found("agent not found"));
        }
        agent
    };
    let permissions = agent
        .permissions
        .clone()
        .normalized_for_identity(&agent.name, Some(agent.role.as_str()));
    if !permissions
        .capabilities
        .contains(&Capability::WriteAllProjects)
    {
        return Err(ApiError::forbidden(
            "agent requires WriteAllProjects to create or access arbitrary projects",
        ));
    }
    // Persist the same normalized bundle on a newly-created binding. This is
    // especially important for legacy CEO rows whose stored permissions are
    // empty and are repaired at read time.
    agent.permissions = permissions;
    Ok(agent)
}

async fn prepare_project_access(
    state: &AppState,
    jwt: &str,
    agent: &Agent,
    project: Project,
    source_session_id: Option<&str>,
    move_current_conversation: bool,
) -> ApiResult<AgentProjectAccessResponse> {
    let storage = state.require_storage_client()?;
    let binding = get_or_create_project_binding(storage, jwt, agent, &project).await?;
    let agent_instance = merge_agent_instance(&binding, Some(agent), None);
    let (session_id, copied_event_count) = if move_current_conversation {
        match source_session_id.filter(|value| !value.trim().is_empty()) {
            Some(source_session_id) => {
                let moved = copy_conversation_to_project(
                    storage,
                    jwt,
                    source_session_id,
                    &binding.id,
                    &project,
                )
                .await?;
                (Some(moved.0), moved.1)
            }
            None => (None, 0),
        }
    } else {
        (None, 0)
    };
    let (chat_route, project_route) = project_routes(
        &project.project_id,
        &binding.id,
        &agent.agent_id,
        session_id.as_deref(),
    );

    info!(
        agent_id = %agent.agent_id,
        project_id = %project.project_id,
        project_agent_id = %binding.id,
        source_session_id,
        target_session_id = session_id.as_deref(),
        copied_event_count,
        "agent project access prepared"
    );

    Ok(AgentProjectAccessResponse {
        project_id: project.project_id,
        agent_instance_id: agent_instance.agent_instance_id,
        project,
        agent_instance,
        conversation_moved: session_id.is_some(),
        session_id,
        copied_event_count,
        chat_route,
        project_route,
    })
}

async fn get_or_create_project_binding(
    storage: &StorageClient,
    jwt: &str,
    agent: &Agent,
    project: &Project,
) -> ApiResult<aura_os_storage::StorageProjectAgent> {
    let project_id = project.project_id.to_string();
    let agent_id = agent.agent_id.to_string();
    let bindings = storage
        .list_project_agents(&project_id, jwt)
        .await
        .map_err(map_storage_error)?;
    if let Some(existing) = bindings.into_iter().find(|binding| {
        binding.agent_id.as_deref() == Some(agent_id.as_str())
            && (binding.instance_role.as_deref()
                == Some(aura_os_core::AgentInstanceRole::Chat.as_wire_str())
                || (binding.instance_role.is_none()
                    && binding.source.as_deref()
                        != Some(aura_os_core::AgentInstanceSource::System.as_wire_str())))
    }) {
        return Ok(existing);
    }

    let request = aura_os_storage::CreateProjectAgentRequest {
        agent_id,
        name: agent.name.clone(),
        org_id: Some(project.org_id.to_string()),
        role: Some(agent.role.clone()),
        personality: Some(agent.personality.clone()),
        system_prompt: Some(agent.system_prompt.clone()),
        skills: Some(agent.skills.clone()),
        icon: agent.icon.clone(),
        harness: None,
        instance_role: Some(
            aura_os_core::AgentInstanceRole::Chat
                .as_wire_str()
                .to_string(),
        ),
        // The user explicitly requested this project handoff in chat, so it
        // should be visible alongside bindings created with the UI's "+".
        source: Some(
            aura_os_core::AgentInstanceSource::Ui
                .as_wire_str()
                .to_string(),
        ),
        permissions: Some(agent.permissions.clone()),
        intent_classifier: agent.intent_classifier.clone(),
    };
    storage
        .create_project_agent(&project_id, jwt, &request)
        .await
        .map_err(map_storage_error)
}

async fn copy_conversation_to_project(
    storage: &StorageClient,
    jwt: &str,
    source_session_id: &str,
    project_agent_id: &str,
    project: &Project,
) -> ApiResult<(String, usize)> {
    let source = storage
        .get_session(source_session_id, jwt)
        .await
        .map_err(map_storage_error)?;
    let events = storage
        .list_events(
            source_session_id,
            jwt,
            Some(MAX_PROJECT_HANDOFF_EVENTS),
            None,
        )
        .await
        .map_err(map_storage_error)?;
    let title = source
        .summary_of_previous_context
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| format!("Moved: {value}"))
        .unwrap_or_else(|| "Moved conversation".to_string());
    let session = storage
        .create_session(
            project_agent_id,
            jwt,
            &CreateSessionRequest {
                project_id: project.project_id.to_string(),
                org_id: Some(project.org_id.to_string()),
                model: source.model,
                status: Some("active".to_string()),
                context_usage_estimate: None,
                summary_of_previous_context: Some(title),
            },
        )
        .await
        .map_err(map_storage_error)?;

    let mut copied = 0;
    for event in events {
        let Some(event_type) = event.event_type else {
            continue;
        };
        let request = CreateSessionEventRequest {
            session_id: Some(session.id.clone()),
            user_id: event.user_id,
            agent_id: event.agent_id,
            sender: event.sender,
            project_id: Some(project.project_id.to_string()),
            org_id: Some(project.org_id.to_string()),
            event_type,
            content: event.content,
        };
        if let Err(error) = storage.create_event(&session.id, jwt, &request).await {
            warn!(
                target_session_id = %session.id,
                source_session_id,
                error = %error,
                "failed to copy project handoff conversation; deleting partial session"
            );
            if let Err(cleanup_error) = storage.delete_session(&session.id, jwt).await {
                warn!(
                    target_session_id = %session.id,
                    error = %cleanup_error,
                    "failed to delete partial project handoff session"
                );
            }
            return Err(map_storage_error(error));
        }
        copied += 1;
    }

    Ok((session.id, copied))
}

fn project_routes(
    project_id: &ProjectId,
    project_agent_id: &str,
    agent_id: &AgentId,
    session_id: Option<&str>,
) -> (String, String) {
    let mut query = url::form_urlencoded::Serializer::new(String::new());
    query.append_pair("project", &project_id.to_string());
    query.append_pair("instance", project_agent_id);
    if let Some(session_id) = session_id {
        query.append_pair("session", session_id);
    }
    query.append_pair("agent", &agent_id.to_string());
    let chat_route = format!("/chat?{}", query.finish());

    let mut project_route = format!("/projects/{project_id}/agents/{project_agent_id}");
    if let Some(session_id) = session_id {
        let query = url::form_urlencoded::Serializer::new(String::new())
            .append_pair("session", session_id)
            .finish();
        project_route.push('?');
        project_route.push_str(&query);
    }
    (chat_route, project_route)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn project_routes_include_the_bound_session() {
        let project_id = ProjectId::new();
        let agent_id = AgentId::new();
        let (chat, project) =
            project_routes(&project_id, "instance-1", &agent_id, Some("session-1"));

        assert!(chat.contains(&format!("project={project_id}")));
        assert!(chat.contains("instance=instance-1"));
        assert!(chat.contains("session=session-1"));
        assert!(chat.contains(&format!("agent={agent_id}")));
        assert_eq!(
            project,
            format!("/projects/{project_id}/agents/instance-1?session=session-1")
        );
    }
}
