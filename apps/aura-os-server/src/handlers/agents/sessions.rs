use axum::extract::{Path, State};
use axum::Json;
use serde_json::json;
use tracing::{info, warn};

use aura_os_core::{AgentInstanceId, ProjectId, Session, SessionEvent, SessionId, Task};
use aura_os_sessions::storage_session_to_session;
use aura_os_storage::StorageClient;

use crate::error::{map_storage_error, ApiError, ApiResult};
use crate::state::{AppState, AuthJwt};

use super::conversions::events_to_session_history;

const HAIKU_MODEL: &str = "claude-haiku-4-5-20251001";
const SUMMARY_MAX_TOKENS: u32 = 256;
const TRANSCRIPT_CHAR_LIMIT: usize = 4000;

pub(crate) async fn list_project_sessions(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    Path(project_id): Path<ProjectId>,
) -> ApiResult<Json<Vec<Session>>> {
    let storage = state.require_storage_client()?;

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
    AuthJwt(jwt): AuthJwt,
    Path((_project_id, agent_instance_id)): Path<(ProjectId, AgentInstanceId)>,
) -> ApiResult<Json<Vec<Session>>> {
    let storage = state.require_storage_client()?;
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
    AuthJwt(jwt): AuthJwt,
    Path((_project_id, _agent_instance_id, session_id)): Path<(
        ProjectId,
        AgentInstanceId,
        SessionId,
    )>,
) -> ApiResult<Json<Session>> {
    let storage = state.require_storage_client()?;
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

pub(crate) async fn delete_session(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    Path((_project_id, _agent_instance_id, session_id)): Path<(
        ProjectId,
        AgentInstanceId,
        SessionId,
    )>,
) -> ApiResult<axum::http::StatusCode> {
    let storage = state.require_storage_client()?;

    storage
        .delete_session(&session_id.to_string(), &jwt)
        .await
        .map_err(|e| match &e {
            aura_os_storage::StorageError::Server { status: 404, .. } => {
                ApiError::not_found("session not found")
            }
            _ => ApiError::internal(format!("deleting session: {e}")),
        })?;

    info!(%session_id, "Session deleted");

    Ok(axum::http::StatusCode::NO_CONTENT)
}

pub(crate) async fn list_session_tasks(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    Path((_project_id, _agent_instance_id, session_id)): Path<(
        ProjectId,
        AgentInstanceId,
        SessionId,
    )>,
) -> ApiResult<Json<Vec<Task>>> {
    let storage = state.require_storage_client()?;

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

pub(crate) async fn list_session_events(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    Path((_project_id, _agent_instance_id, session_id)): Path<(
        ProjectId,
        AgentInstanceId,
        SessionId,
    )>,
) -> ApiResult<Json<Vec<SessionEvent>>> {
    let storage = state.require_storage_client()?;

    let events = storage
        .list_events(&session_id.to_string(), &jwt, None, None)
        .await
        .map_err(map_storage_error)?;

    let messages = events_to_session_history(
        &events,
        &_agent_instance_id.to_string(),
        &_project_id.to_string(),
    );
    Ok(Json(messages))
}

pub(crate) async fn generate_session_summary(
    storage: &StorageClient,
    http: &reqwest::Client,
    router_url: &str,
    jwt: &str,
    session_id: &str,
) -> Result<String, String> {
    let events = storage
        .list_events(session_id, jwt, None, None)
        .await
        .map_err(|e| format!("listing events: {e}"))?;

    let mut transcript = String::new();
    for event in &events {
        let event_type = event.event_type.as_deref().unwrap_or("");
        let content = event.content.as_ref();
        let text = content
            .and_then(|c| c.get("text"))
            .and_then(|v| v.as_str())
            .unwrap_or("");
        if text.is_empty() {
            continue;
        }
        let role = match event_type {
            "user_message" => "User",
            "assistant_message_end" | "task_output" => "Assistant",
            _ => continue,
        };
        transcript.push_str(role);
        transcript.push_str(": ");
        transcript.push_str(text);
        transcript.push('\n');
        if transcript.len() > TRANSCRIPT_CHAR_LIMIT {
            transcript.truncate(TRANSCRIPT_CHAR_LIMIT);
            transcript.push_str("\n[truncated]");
            break;
        }
    }

    if transcript.is_empty() {
        return Ok(String::new());
    }

    let req_body = json!({
        "model": HAIKU_MODEL,
        "max_tokens": SUMMARY_MAX_TOKENS,
        "system": "Generate a 2-3 line summary of this agent coding session. Focus on what tasks were worked on and what was accomplished. Be concise and direct, no preamble.",
        "messages": [{"role": "user", "content": transcript}],
    });

    let resp = http
        .post(format!("{router_url}/v1/messages"))
        .bearer_auth(jwt)
        .json(&req_body)
        .send()
        .await
        .map_err(|e| format!("LLM request failed: {e}"))?;

    if !resp.status().is_success() {
        let status = resp.status().as_u16();
        let body = resp.text().await.unwrap_or_default();
        return Err(format!("LLM returned {status}: {body}"));
    }

    let body: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| format!("parsing LLM response: {e}"))?;

    let summary = body
        .get("content")
        .and_then(|c| c.as_array())
        .and_then(|arr| arr.first())
        .and_then(|block| block.get("text"))
        .and_then(|t| t.as_str())
        .unwrap_or("")
        .to_string();

    if !summary.is_empty() {
        let update_req = aura_os_storage::UpdateSessionRequest {
            status: None,
            total_input_tokens: None,
            total_output_tokens: None,
            context_usage_estimate: None,
            summary_of_previous_context: Some(summary.clone()),
            tasks_worked_count: None,
            ended_at: None,
        };
        storage
            .update_session(session_id, jwt, &update_req)
            .await
            .map_err(|e| format!("updating session summary: {e}"))?;
    }

    Ok(summary)
}

pub(crate) async fn summarize_session(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    Path((_project_id, _agent_instance_id, session_id)): Path<(
        ProjectId,
        AgentInstanceId,
        SessionId,
    )>,
) -> ApiResult<Json<Session>> {
    let storage = state.require_storage_client()?;

    let sid = session_id.to_string();
    info!(%session_id, "Session summary generation requested");

    let summary = generate_session_summary(
        storage,
        &state.agent_runtime.http_client,
        &state.agent_runtime.router_url,
        &jwt,
        &sid,
    )
    .await
    .map_err(|e| ApiError::internal(format!("summarizing session: {e}")))?;

    info!(%session_id, summary_len = summary.len(), "Session summary generated");

    let ss = storage
        .get_session(&sid, &jwt)
        .await
        .map_err(map_storage_error)?;
    let session = storage_session_to_session(ss, None).map_err(ApiError::internal)?;
    Ok(Json(session))
}
