use axum::extract::{Path, State};
use axum::Json;

use aura_core::{Agent, AgentId, ProjectId, Session, SessionId, Task};

use crate::error::{ApiError, ApiResult};
use crate::state::AppState;

pub async fn list_agents(
    State(state): State<AppState>,
    Path(project_id): Path<ProjectId>,
) -> ApiResult<Json<Vec<Agent>>> {
    let agents = state
        .agent_service
        .list_agents(&project_id)
        .map_err(|e| ApiError::internal(e.to_string()))?;
    Ok(Json(agents))
}

pub async fn get_agent(
    State(state): State<AppState>,
    Path((project_id, agent_id)): Path<(ProjectId, AgentId)>,
) -> ApiResult<Json<Agent>> {
    let agent = state
        .agent_service
        .get_agent(&project_id, &agent_id)
        .map_err(|e| match &e {
            aura_agents::AgentError::NotFound => ApiError::not_found("agent not found"),
            _ => ApiError::internal(e.to_string()),
        })?;
    Ok(Json(agent))
}

pub async fn list_project_sessions(
    State(state): State<AppState>,
    Path(project_id): Path<ProjectId>,
) -> ApiResult<Json<Vec<Session>>> {
    let mut sessions = state
        .store
        .list_sessions_by_project(&project_id)
        .map_err(|e| ApiError::internal(e.to_string()))?;
    sessions.sort_by(|a, b| b.started_at.cmp(&a.started_at));
    Ok(Json(sessions))
}

pub async fn list_sessions(
    State(state): State<AppState>,
    Path((project_id, agent_id)): Path<(ProjectId, AgentId)>,
) -> ApiResult<Json<Vec<Session>>> {
    let sessions = state
        .session_service
        .list_sessions(&project_id, &agent_id)
        .map_err(|e| ApiError::internal(e.to_string()))?;
    Ok(Json(sessions))
}

pub async fn get_session(
    State(state): State<AppState>,
    Path((project_id, agent_id, session_id)): Path<(ProjectId, AgentId, SessionId)>,
) -> ApiResult<Json<Session>> {
    let session = state
        .session_service
        .get_session(&project_id, &agent_id, &session_id)
        .map_err(|e| match &e {
            aura_sessions::SessionError::NotFound => ApiError::not_found("session not found"),
            _ => ApiError::internal(e.to_string()),
        })?;
    Ok(Json(session))
}

pub async fn list_session_tasks(
    State(state): State<AppState>,
    Path((project_id, agent_id, session_id)): Path<(ProjectId, AgentId, SessionId)>,
) -> ApiResult<Json<Vec<Task>>> {
    let session = state
        .session_service
        .get_session(&project_id, &agent_id, &session_id)
        .map_err(|e| match &e {
            aura_sessions::SessionError::NotFound => ApiError::not_found("session not found"),
            _ => ApiError::internal(e.to_string()),
        })?;

    let all_tasks = state
        .store
        .list_tasks_by_project(&project_id)
        .map_err(|e| ApiError::internal(e.to_string()))?;

    let session_tasks: Vec<Task> = all_tasks
        .into_iter()
        .filter(|t| session.tasks_worked.contains(&t.task_id))
        .collect();

    Ok(Json(session_tasks))
}
