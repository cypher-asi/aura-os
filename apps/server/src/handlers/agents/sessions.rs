use axum::extract::{Path, State};
use axum::Json;
use tracing::warn;

use aura_os_core::{AgentInstanceId, Message, ProjectId, Session, SessionId, Task};
use aura_os_sessions::storage_session_to_session;

use crate::error::{map_storage_error, ApiError, ApiResult};
use crate::state::AppState;

use super::conversions::storage_message_to_message;

pub(crate) async fn list_project_sessions(
    State(state): State<AppState>,
    Path(project_id): Path<ProjectId>,
) -> ApiResult<Json<Vec<Session>>> {
    let storage = state.require_storage_client()?;
    let jwt = state.get_jwt()?;

    let storage_agents = storage
        .list_project_agents(&project_id.to_string(), &jwt)
        .await
        .map_err(map_storage_error)?;

    let mut sessions = Vec::new();
    for agent in &storage_agents {
        match storage.list_sessions(&agent.id, &jwt).await {
            Ok(agent_sessions) => {
                for ss in agent_sessions {
                    match storage_session_to_session(ss, None) {
                        Ok(s) => sessions.push(s),
                        Err(e) => warn!(error = %e, "skipping malformed session"),
                    }
                }
            }
            Err(e) => warn!(agent_id = %agent.id, error = %e, "failed to list sessions for agent"),
        }
    }
    sessions.sort_by(|a, b| b.started_at.cmp(&a.started_at));
    Ok(Json(sessions))
}

pub(crate) async fn list_sessions(
    State(state): State<AppState>,
    Path((_project_id, agent_instance_id)): Path<(ProjectId, AgentInstanceId)>,
) -> ApiResult<Json<Vec<Session>>> {
    let storage = state.require_storage_client()?;
    let jwt = state.get_jwt()?;
    let storage_sessions = storage
        .list_sessions(&agent_instance_id.to_string(), &jwt)
        .await
        .map_err(map_storage_error)?;
    let sessions: Vec<Session> = storage_sessions
        .into_iter()
        .filter_map(|s| {
            storage_session_to_session(s, None)
                .map_err(|e| warn!(error = %e, "skipping malformed session"))
                .ok()
        })
        .collect();
    Ok(Json(sessions))
}

pub(crate) async fn get_session(
    State(state): State<AppState>,
    Path((_project_id, _agent_instance_id, session_id)): Path<(
        ProjectId,
        AgentInstanceId,
        SessionId,
    )>,
) -> ApiResult<Json<Session>> {
    let storage = state.require_storage_client()?;
    let jwt = state.get_jwt()?;
    let ss = storage
        .get_session(&session_id.to_string(), &jwt)
        .await
        .map_err(|e| match &e {
            aura_os_storage::StorageError::Server { status: 404, .. } => {
                ApiError::not_found("session not found")
            }
            _ => map_storage_error(e),
        })?;
    let session = storage_session_to_session(ss, None).map_err(ApiError::internal)?;
    Ok(Json(session))
}

pub(crate) async fn list_session_tasks(
    State(state): State<AppState>,
    Path((_project_id, _agent_instance_id, session_id)): Path<(
        ProjectId,
        AgentInstanceId,
        SessionId,
    )>,
) -> ApiResult<Json<Vec<Task>>> {
    let storage = state.require_storage_client()?;
    let jwt = state.get_jwt()?;

    storage
        .get_session(&session_id.to_string(), &jwt)
        .await
        .map_err(|e| match &e {
            aura_os_storage::StorageError::Server { status: 404, .. } => {
                ApiError::not_found("session not found")
            }
            _ => map_storage_error(e),
        })?;

    let storage_tasks = storage
        .list_tasks(&_project_id.to_string(), &jwt)
        .await
        .map_err(map_storage_error)?;

    let tasks: Vec<Task> = storage_tasks
        .into_iter()
        .filter(|t| t.session_id.as_deref() == Some(&session_id.to_string()))
        .filter_map(|s| crate::handlers::tasks::storage_task_to_task(s).ok())
        .collect();

    Ok(Json(tasks))
}

pub(crate) async fn list_session_messages(
    State(state): State<AppState>,
    Path((_project_id, _agent_instance_id, session_id)): Path<(
        ProjectId,
        AgentInstanceId,
        SessionId,
    )>,
) -> ApiResult<Json<Vec<Message>>> {
    let storage = state.require_storage_client()?;
    let jwt = state.get_jwt()?;

    let storage_msgs = storage
        .list_messages(&session_id.to_string(), &jwt, None, None)
        .await
        .map_err(map_storage_error)?;

    let messages: Vec<Message> = storage_msgs
        .iter()
        .filter(|sm| sm.role.as_deref() != Some("system"))
        .map(storage_message_to_message)
        .collect();
    Ok(Json(messages))
}
