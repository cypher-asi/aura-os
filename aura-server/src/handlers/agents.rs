use std::convert::Infallible;

use axum::extract::{Path, State};
use axum::response::sse::{Event, Sse};
use axum::Json;
use tokio::sync::mpsc;
use tokio_stream::wrappers::UnboundedReceiverStream;
use tokio_stream::StreamExt;
use tracing::info;

use aura_core::{
    Agent, AgentId, AgentInstance, AgentInstanceId, Message, ProjectId, Session, SessionId, Task,
};
use aura_chat::ChatStreamEvent;
use aura_engine::EngineEvent;

use crate::dto::{
    CreateAgentInstanceRequest, CreateAgentRequest, SendMessageRequest, UpdateAgentInstanceRequest,
    UpdateAgentRequest,
};
use crate::error::{ApiError, ApiResult};
use crate::state::AppState;

const DEFAULT_USER_ID: &str = "default";

// ---------------------------------------------------------------------------
// User-level Agent CRUD
// ---------------------------------------------------------------------------

pub async fn create_agent(
    State(state): State<AppState>,
    Json(body): Json<CreateAgentRequest>,
) -> ApiResult<Json<Agent>> {
    let agent = state
        .agent_service
        .create_agent(
            DEFAULT_USER_ID,
            body.name,
            body.role,
            body.personality,
            body.system_prompt,
            body.skills,
            body.icon,
        )
        .map_err(|e| ApiError::internal(e.to_string()))?;
    Ok(Json(agent))
}

pub async fn list_agents(State(state): State<AppState>) -> ApiResult<Json<Vec<Agent>>> {
    let agents = state
        .agent_service
        .list_agents(DEFAULT_USER_ID)
        .map_err(|e| ApiError::internal(e.to_string()))?;
    Ok(Json(agents))
}

pub async fn get_agent(
    State(state): State<AppState>,
    Path(agent_id): Path<AgentId>,
) -> ApiResult<Json<Agent>> {
    let agent = state
        .agent_service
        .get_agent(DEFAULT_USER_ID, &agent_id)
        .map_err(|e| match &e {
            aura_agents::AgentError::NotFound => ApiError::not_found("agent not found"),
            _ => ApiError::internal(e.to_string()),
        })?;
    Ok(Json(agent))
}

pub async fn update_agent(
    State(state): State<AppState>,
    Path(agent_id): Path<AgentId>,
    Json(body): Json<UpdateAgentRequest>,
) -> ApiResult<Json<Agent>> {
    let agent = state
        .agent_service
        .update_agent(
            DEFAULT_USER_ID,
            &agent_id,
            body.name,
            body.role,
            body.personality,
            body.system_prompt,
            body.skills,
            body.icon,
        )
        .map_err(|e| match &e {
            aura_agents::AgentError::NotFound => ApiError::not_found("agent not found"),
            _ => ApiError::internal(e.to_string()),
        })?;
    Ok(Json(agent))
}

pub async fn delete_agent(
    State(state): State<AppState>,
    Path(agent_id): Path<AgentId>,
) -> ApiResult<Json<()>> {
    state
        .agent_service
        .delete_agent(DEFAULT_USER_ID, &agent_id)
        .map_err(|e| match &e {
            aura_agents::AgentError::NotFound => ApiError::not_found("agent not found"),
            _ => ApiError::internal(e.to_string()),
        })?;
    Ok(Json(()))
}

// ---------------------------------------------------------------------------
// Project-level AgentInstance CRUD
// ---------------------------------------------------------------------------

pub async fn create_agent_instance(
    State(state): State<AppState>,
    Path(project_id): Path<ProjectId>,
    Json(body): Json<CreateAgentInstanceRequest>,
) -> ApiResult<Json<AgentInstance>> {
    let agent = state
        .agent_service
        .get_agent(DEFAULT_USER_ID, &body.agent_id)
        .map_err(|e| match &e {
            aura_agents::AgentError::NotFound => ApiError::not_found("agent template not found"),
            _ => ApiError::internal(e.to_string()),
        })?;

    let instance = state
        .agent_instance_service
        .create_instance_from_agent(&project_id, &agent)
        .map_err(|e| ApiError::internal(e.to_string()))?;
    Ok(Json(instance))
}

pub async fn list_agent_instances(
    State(state): State<AppState>,
    Path(project_id): Path<ProjectId>,
) -> ApiResult<Json<Vec<AgentInstance>>> {
    let instances = state
        .agent_instance_service
        .list_instances(&project_id)
        .map_err(|e| ApiError::internal(e.to_string()))?;
    Ok(Json(instances))
}

pub async fn get_agent_instance(
    State(state): State<AppState>,
    Path((project_id, agent_instance_id)): Path<(ProjectId, AgentInstanceId)>,
) -> ApiResult<Json<AgentInstance>> {
    let instance = state
        .agent_instance_service
        .get_instance(&project_id, &agent_instance_id)
        .map_err(|e| match &e {
            aura_agents::AgentError::NotFound => {
                ApiError::not_found("agent instance not found")
            }
            _ => ApiError::internal(e.to_string()),
        })?;
    Ok(Json(instance))
}

pub async fn update_agent_instance(
    State(state): State<AppState>,
    Path((project_id, agent_instance_id)): Path<(ProjectId, AgentInstanceId)>,
    Json(body): Json<UpdateAgentInstanceRequest>,
) -> ApiResult<Json<AgentInstance>> {
    let instance = state
        .agent_instance_service
        .update_instance(
            &project_id,
            &agent_instance_id,
            body.name,
            body.role,
            body.personality,
            body.system_prompt,
        )
        .map_err(|e| match &e {
            aura_agents::AgentError::NotFound => {
                ApiError::not_found("agent instance not found")
            }
            _ => ApiError::internal(e.to_string()),
        })?;
    Ok(Json(instance))
}

pub async fn delete_agent_instance(
    State(state): State<AppState>,
    Path((project_id, agent_instance_id)): Path<(ProjectId, AgentInstanceId)>,
) -> ApiResult<Json<()>> {
    state
        .agent_instance_service
        .delete_instance(&project_id, &agent_instance_id)
        .map_err(|e| match &e {
            aura_agents::AgentError::NotFound => {
                ApiError::not_found("agent instance not found")
            }
            _ => ApiError::internal(e.to_string()),
        })?;
    Ok(Json(()))
}

// ---------------------------------------------------------------------------
// Messages (scoped to agent instance)
// ---------------------------------------------------------------------------

pub async fn list_messages(
    State(state): State<AppState>,
    Path((project_id, agent_instance_id)): Path<(ProjectId, AgentInstanceId)>,
) -> ApiResult<Json<Vec<Message>>> {
    let messages = state
        .chat_service
        .list_messages(&project_id, &agent_instance_id)
        .map_err(|e| ApiError::internal(e.to_string()))?;
    Ok(Json(messages))
}

pub async fn send_message_stream(
    State(state): State<AppState>,
    Path((project_id, agent_instance_id)): Path<(ProjectId, AgentInstanceId)>,
    Json(body): Json<SendMessageRequest>,
) -> Sse<impl futures_core::Stream<Item = Result<Event, Infallible>>> {
    info!(%project_id, %agent_instance_id, action = ?body.action, "Message stream requested");

    let agent_instance = state
        .agent_instance_service
        .get_instance(&project_id, &agent_instance_id)
        .ok();

    let (tx, rx) = mpsc::unbounded_channel::<ChatStreamEvent>();

    let chat_service = state.chat_service.clone();
    let pid = project_id;
    let aiid = agent_instance_id;
    let content = body.content;
    let action = body.action.clone();
    let attachments = body.attachments.unwrap_or_default();

    let is_generate_specs = body.action.as_deref() == Some("generate_specs");
    if is_generate_specs {
        let _ = state
            .event_tx
            .send(EngineEvent::SpecGenStarted { project_id });
    }

    tokio::spawn(async move {
        if let Some(ref instance) = agent_instance {
            chat_service
                .send_message_streaming(
                    &pid,
                    &aiid,
                    instance,
                    &content,
                    action.as_deref(),
                    &attachments,
                    tx,
                )
                .await;
        } else {
            let _ = tx.send(ChatStreamEvent::Error(
                "agent instance not found".to_string(),
            ));
            let _ = tx.send(ChatStreamEvent::Done);
        }
    });

    let event_tx = state.event_tx.clone();
    let mut spec_count: usize = 0;

    let stream = UnboundedReceiverStream::new(rx).map(move |evt| {
        let sse_event = match &evt {
            ChatStreamEvent::Delta(text) => Event::default()
                .event("delta")
                .json_data(serde_json::json!({ "text": text }))
                .unwrap(),
            ChatStreamEvent::ThinkingDelta(text) => Event::default()
                .event("thinking_delta")
                .json_data(serde_json::json!({ "text": text }))
                .unwrap(),
            ChatStreamEvent::ToolCall { id, name, input } => Event::default()
                .event("tool_call")
                .json_data(serde_json::json!({ "id": id, "name": name, "input": input }))
                .unwrap(),
            ChatStreamEvent::ToolResult {
                id,
                name,
                result,
                is_error,
            } => Event::default()
                .event("tool_result")
                .json_data(serde_json::json!({
                    "id": id, "name": name, "result": result, "is_error": is_error
                }))
                .unwrap(),
            ChatStreamEvent::SpecSaved(spec) => {
                spec_count += 1;
                let _ = event_tx.send(EngineEvent::SpecSaved {
                    project_id,
                    spec: spec.clone(),
                });
                Event::default()
                    .event("spec_saved")
                    .json_data(serde_json::json!({ "spec": spec }))
                    .unwrap()
            }
            ChatStreamEvent::SpecsTitle(title) => Event::default()
                .event("specs_title")
                .json_data(serde_json::json!({ "title": title }))
                .unwrap(),
            ChatStreamEvent::SpecsSummary(summary) => Event::default()
                .event("specs_summary")
                .json_data(serde_json::json!({ "summary": summary }))
                .unwrap(),
            ChatStreamEvent::TaskSaved(task) => Event::default()
                .event("task_saved")
                .json_data(serde_json::json!({ "task": task }))
                .unwrap(),
            ChatStreamEvent::MessageSaved(msg) => Event::default()
                .event("message_saved")
                .json_data(serde_json::json!({ "message": msg }))
                .unwrap(),
            ChatStreamEvent::AgentInstanceUpdated(instance) => Event::default()
                .event("agent_instance_updated")
                .json_data(serde_json::json!({ "agent_instance": instance }))
                .unwrap(),
            ChatStreamEvent::Error(msg) => Event::default()
                .event("error")
                .json_data(serde_json::json!({ "message": msg }))
                .unwrap(),
            ChatStreamEvent::Done => {
                if is_generate_specs {
                    let _ = event_tx.send(EngineEvent::SpecGenCompleted {
                        project_id,
                        spec_count,
                    });
                }
                Event::default()
                    .event("done")
                    .json_data(serde_json::json!({}))
                    .unwrap()
            }
        };
        Ok(sse_event)
    });

    Sse::new(stream)
}

// ---------------------------------------------------------------------------
// Sessions (scoped to agent instance)
// ---------------------------------------------------------------------------

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
    Path((project_id, agent_instance_id)): Path<(ProjectId, AgentInstanceId)>,
) -> ApiResult<Json<Vec<Session>>> {
    let sessions = state
        .session_service
        .list_sessions(&project_id, &agent_instance_id)
        .map_err(|e| ApiError::internal(e.to_string()))?;
    Ok(Json(sessions))
}

pub async fn get_session(
    State(state): State<AppState>,
    Path((project_id, agent_instance_id, session_id)): Path<(
        ProjectId,
        AgentInstanceId,
        SessionId,
    )>,
) -> ApiResult<Json<Session>> {
    let session = state
        .session_service
        .get_session(&project_id, &agent_instance_id, &session_id)
        .map_err(|e| match &e {
            aura_sessions::SessionError::NotFound => ApiError::not_found("session not found"),
            _ => ApiError::internal(e.to_string()),
        })?;
    Ok(Json(session))
}

pub async fn list_session_tasks(
    State(state): State<AppState>,
    Path((project_id, agent_instance_id, session_id)): Path<(
        ProjectId,
        AgentInstanceId,
        SessionId,
    )>,
) -> ApiResult<Json<Vec<Task>>> {
    let session = state
        .session_service
        .get_session(&project_id, &agent_instance_id, &session_id)
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
