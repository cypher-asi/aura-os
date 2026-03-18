use std::convert::Infallible;

use axum::extract::{Path, State};
use axum::response::sse::{Event, Sse};
use axum::Json;
use chrono::{DateTime, Utc};
use tokio::sync::mpsc;
use tokio_stream::wrappers::UnboundedReceiverStream;
use tokio_stream::StreamExt;
use tracing::{info, warn};

use axum::http::StatusCode;

use aura_core::{
    Agent, AgentId, AgentInstance, AgentInstanceId, Message, ProfileId, ProjectId, Session,
    SessionId, Task, ZeroAuthSession,
};
use aura_chat::ChatStreamEvent;
use aura_engine::EngineEvent;
use aura_network::NetworkAgent;

use crate::dto::{
    CreateAgentInstanceRequest, CreateAgentRequest, SendMessageRequest, UpdateAgentInstanceRequest,
    UpdateAgentRequest,
};
use crate::error::{map_network_error, ApiError, ApiResult};
use crate::state::AppState;

fn get_user_id(state: &AppState) -> Result<String, (StatusCode, Json<ApiError>)> {
    let session_bytes = state
        .store
        .get_setting("zero_auth_session")
        .map_err(|_| ApiError::unauthorized("not authenticated"))?;
    let session: ZeroAuthSession =
        serde_json::from_slice(&session_bytes).map_err(|e| ApiError::internal(e.to_string()))?;
    Ok(session.user_id)
}

// ---------------------------------------------------------------------------
// Network <-> Local conversion helpers
// ---------------------------------------------------------------------------

fn agent_from_network(net: &NetworkAgent) -> Agent {
    let agent_id = net
        .id
        .parse::<AgentId>()
        .unwrap_or_else(|_| AgentId::new());
    let profile_id: Option<ProfileId> = net.profile_id_typed();
    let created_at = net
        .created_at
        .as_deref()
        .and_then(|s| DateTime::parse_from_rfc3339(s).ok())
        .map(|dt| dt.with_timezone(&Utc))
        .unwrap_or_else(Utc::now);
    let updated_at = net
        .updated_at
        .as_deref()
        .and_then(|s| DateTime::parse_from_rfc3339(s).ok())
        .map(|dt| dt.with_timezone(&Utc))
        .unwrap_or_else(Utc::now);

    Agent {
        agent_id,
        user_id: net.user_id.clone(),
        name: net.name.clone(),
        role: net.role.clone().unwrap_or_default(),
        personality: net.personality.clone().unwrap_or_default(),
        system_prompt: net.system_prompt.clone().unwrap_or_default(),
        skills: net.skills.clone().unwrap_or_default(),
        icon: net.icon.clone(),
        network_agent_id: Some(net.id.clone()),
        profile_id,
        created_at,
        updated_at,
    }
}

/// Save a local shadow of a network agent so agent instances and messaging work.
fn ensure_agent_shadow(state: &AppState, agent: &Agent) {
    if let Err(e) = state.store.put_agent(agent) {
        warn!(agent_id = %agent.agent_id, error = %e, "Failed to save local agent shadow");
    }
}

// ---------------------------------------------------------------------------
// User-level Agent CRUD (proxied to aura-network when available)
// ---------------------------------------------------------------------------

pub async fn create_agent(
    State(state): State<AppState>,
    Json(body): Json<CreateAgentRequest>,
) -> ApiResult<Json<Agent>> {
    let client = state.require_network_client()?;
    let jwt = state.get_jwt()?;
    let net_req = aura_network::CreateAgentRequest {
        name: body.name,
        role: Some(body.role),
        personality: Some(body.personality),
        system_prompt: Some(body.system_prompt),
        skills: Some(body.skills),
        icon: body.icon,
        org_id: None,
    };
    let net_agent = client
        .create_agent(&jwt, &net_req)
        .await
        .map_err(map_network_error)?;
    let agent = agent_from_network(&net_agent);
    ensure_agent_shadow(&state, &agent);
    Ok(Json(agent))
}

pub async fn list_agents(State(state): State<AppState>) -> ApiResult<Json<Vec<Agent>>> {
    let client = state.require_network_client()?;
    let jwt = state.get_jwt()?;
    let net_agents = client.list_agents(&jwt).await.map_err(map_network_error)?;
    let agents: Vec<Agent> = net_agents.iter().map(agent_from_network).collect();
    for agent in &agents {
        ensure_agent_shadow(&state, agent);
    }
    Ok(Json(agents))
}

pub async fn get_agent(
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
    ensure_agent_shadow(&state, &agent);
    Ok(Json(agent))
}

pub async fn update_agent(
    State(state): State<AppState>,
    Path(agent_id): Path<AgentId>,
    Json(body): Json<UpdateAgentRequest>,
) -> ApiResult<Json<Agent>> {
    let client = state.require_network_client()?;
    let jwt = state.get_jwt()?;
    let net_req = aura_network::UpdateAgentRequest {
        name: body.name,
        role: body.role,
        personality: body.personality,
        system_prompt: body.system_prompt,
        skills: body.skills,
        icon: body.icon.flatten(),
    };
    let net_agent = client
        .update_agent(&agent_id.to_string(), &jwt, &net_req)
        .await
        .map_err(map_network_error)?;
    let agent = agent_from_network(&net_agent);
    ensure_agent_shadow(&state, &agent);
    Ok(Json(agent))
}

pub async fn delete_agent(
    State(state): State<AppState>,
    Path(agent_id): Path<AgentId>,
) -> ApiResult<Json<()>> {
    let instances = state
        .store
        .list_agent_instances_by_agent_id(&agent_id)
        .unwrap_or_default();
    if !instances.is_empty() {
        return Err(ApiError::conflict(
            "Cannot delete agent while it is added to projects. Remove it from all projects first.",
        ));
    }

    let client = state.require_network_client()?;
    let jwt = state.get_jwt()?;
    client
        .delete_agent(&agent_id.to_string(), &jwt)
        .await
        .map_err(map_network_error)?;
    // Remove local shadow
    let user_id = get_user_id(&state).unwrap_or_default();
    let _ = state.store.delete_agent(&user_id, &agent_id);
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
    let user_id = get_user_id(&state)?;

    // Try local first, then fall back to network if the agent shadow is missing
    let agent = match state.agent_service.get_agent(&user_id, &body.agent_id) {
        Ok(a) => a,
        Err(_) if state.network_client.is_some() => {
            let client = state.network_client.as_ref().unwrap();
            let jwt = state.get_jwt()?;
            let net_agent = client
                .get_agent(&body.agent_id.to_string(), &jwt)
                .await
                .map_err(map_network_error)?;
            let agent = agent_from_network(&net_agent);
            ensure_agent_shadow(&state, &agent);
            agent
        }
        Err(e) => {
            return Err(match &e {
                aura_agents::AgentError::NotFound => {
                    ApiError::not_found("agent template not found")
                }
                _ => ApiError::internal(e.to_string()),
            });
        }
    };

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
// Agent-level messages (multi-project)
// ---------------------------------------------------------------------------

pub async fn list_agent_messages(
    State(state): State<AppState>,
    Path(agent_id): Path<AgentId>,
) -> ApiResult<Json<Vec<Message>>> {
    let messages = state
        .chat_service
        .list_agent_messages(&agent_id)
        .map_err(|e| ApiError::internal(e.to_string()))?;
    Ok(Json(messages))
}

pub async fn send_agent_message_stream(
    State(state): State<AppState>,
    Path(agent_id): Path<AgentId>,
    Json(body): Json<SendMessageRequest>,
) -> ApiResult<Sse<impl futures_core::Stream<Item = Result<Event, Infallible>>>> {
    super::billing::require_credits(&state).await?;
    info!(%agent_id, action = ?body.action, "Agent message stream requested");

    let agent = match get_user_id(&state) {
        Ok(uid) => match state.agent_service.get_agent(&uid, &agent_id) {
            Ok(a) => Some(a),
            Err(_) if state.network_client.is_some() => {
                let client = state.network_client.as_ref().unwrap();
                match state.get_jwt() {
                    Ok(jwt) => match client
                        .get_agent(&agent_id.to_string(), &jwt)
                        .await
                    {
                        Ok(net_agent) => {
                            let a = agent_from_network(&net_agent);
                            ensure_agent_shadow(&state, &a);
                            Some(a)
                        }
                        Err(e) => {
                            warn!(%agent_id, error = %e, "Agent not found via network");
                            None
                        }
                    },
                    Err(_) => None,
                }
            }
            Err(e) => {
                warn!(%agent_id, error = %e, "Agent not found locally, no network client");
                None
            }
        },
        Err(_) => {
            warn!(%agent_id, "No authenticated user, cannot resolve agent");
            None
        }
    };

    let instances = state
        .store
        .list_agent_instances_by_agent_id(&agent_id)
        .unwrap_or_default();

    let project_ids: Vec<ProjectId> = instances.iter().map(|i| i.project_id).collect();
    let projects: Vec<aura_core::Project> = project_ids
        .iter()
        .filter_map(|pid| state.store.get_project(pid).ok())
        .collect();

    let (tx, rx) = mpsc::unbounded_channel::<ChatStreamEvent>();

    let chat_service = state.chat_service.clone();
    let content = body.content;
    let action = body.action.clone();
    let attachments = body.attachments.unwrap_or_default();

    tokio::spawn(async move {
        if let Some(ref agent) = agent {
            chat_service
                .send_agent_message_streaming(
                    &agent_id,
                    agent,
                    &projects,
                    &content,
                    action.as_deref(),
                    &attachments,
                    tx,
                )
                .await;
        } else {
            let _ = tx.send(ChatStreamEvent::Error(
                "agent not found".to_string(),
            ));
            let _ = tx.send(ChatStreamEvent::Done);
        }
    });

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
            ChatStreamEvent::SpecSaved(spec) => Event::default()
                .event("spec_saved")
                .json_data(serde_json::json!({ "spec": spec }))
                .unwrap(),
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
            ChatStreamEvent::TokenUsage { input_tokens, output_tokens } => Event::default()
                .event("token_usage")
                .json_data(serde_json::json!({ "input_tokens": input_tokens, "output_tokens": output_tokens }))
                .unwrap(),
            ChatStreamEvent::Error(msg) => Event::default()
                .event("error")
                .json_data(serde_json::json!({ "message": msg }))
                .unwrap(),
            ChatStreamEvent::Done => Event::default()
                .event("done")
                .json_data(serde_json::json!({}))
                .unwrap(),
        };
        Ok(sse_event)
    });

    Ok(Sse::new(stream))
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
) -> ApiResult<Sse<impl futures_core::Stream<Item = Result<Event, Infallible>>>> {
    super::billing::require_credits(&state).await?;
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
            ChatStreamEvent::TokenUsage { input_tokens, output_tokens } => Event::default()
                .event("token_usage")
                .json_data(serde_json::json!({ "input_tokens": input_tokens, "output_tokens": output_tokens }))
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

    Ok(Sse::new(stream))
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
