use std::collections::HashMap;
use std::convert::Infallible;

use axum::extract::{Path, State};
use axum::response::sse::{Event, Sse};
use axum::Json;
use chrono::{DateTime, Utc};
use tokio::sync::mpsc;
use tokio_stream::wrappers::UnboundedReceiverStream;
use tokio_stream::StreamExt;
use futures_util::future::join_all;
use tracing::{info, warn};

use axum::http::StatusCode;

use aura_core::{
    Agent, AgentId, AgentInstance, AgentInstanceId, AgentStatus, ChatRole, Message, MessageId,
    ProfileId, ProjectId, Session, SessionId, Task, ZeroAuthSession,
};
use aura_storage::StorageMessage;
use aura_agents::{merge_agent_instance, AgentInstanceService};
use aura_sessions::{parse_dt, storage_session_to_session};
use aura_chat::ChatStreamEvent;
use aura_engine::EngineEvent;
use aura_network::NetworkAgent;

use crate::dto::{
    CreateAgentInstanceRequest, CreateAgentRequest, SendMessageRequest, UpdateAgentInstanceRequest,
    UpdateAgentRequest,
};
use crate::error::{map_network_error, map_storage_error, ApiError, ApiResult};
use crate::handlers::projects;
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
        network_agent_id: net.id.parse().ok(),
        profile_id,
        created_at,
        updated_at,
    }
}

// ---------------------------------------------------------------------------
// User-level Agent CRUD (aura-network only; no local store)
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
    Ok(Json(agent))
}

pub async fn list_agents(State(state): State<AppState>) -> ApiResult<Json<Vec<Agent>>> {
    let client = state.require_network_client()?;
    let jwt = state.get_jwt()?;
    let net_agents = client.list_agents(&jwt).await.map_err(map_network_error)?;
    let agents: Vec<Agent> = net_agents.iter().map(agent_from_network).collect();
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
    Ok(Json(agent))
}

pub async fn delete_agent(
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

// ---------------------------------------------------------------------------
// StorageProjectAgent -> AgentInstance conversion (uses aura_agents::merge_agent_instance)
// ---------------------------------------------------------------------------

/// Fetch all agents from the network, returning a map by network agent ID.
/// Returns empty map if network is unavailable.
async fn resolve_network_agents(state: &AppState, jwt: &str) -> HashMap<String, Agent> {
    if let Some(ref client) = state.network_client {
        if let Ok(net_agents) = client.list_agents(jwt).await {
            return net_agents
                .iter()
                .map(|na| (na.id.clone(), agent_from_network(na)))
                .collect();
        }
    }
    HashMap::new()
}

/// Fetch a single agent's config from the network only (no local fallback).
async fn resolve_single_agent(state: &AppState, jwt: &str, agent_id: &str) -> Option<Agent> {
    let client = state.network_client.as_ref()?;
    let net_agent = client.get_agent(agent_id, jwt).await.ok()?;
    Some(agent_from_network(&net_agent))
}

// ---------------------------------------------------------------------------
// StorageSession / StorageMessage -> domain type conversion
// ---------------------------------------------------------------------------

fn storage_message_to_message(sm: &StorageMessage) -> Message {
    let message_id = sm
        .id
        .parse::<MessageId>()
        .unwrap_or_else(|_| MessageId::new());
    let agent_instance_id = sm
        .project_agent_id
        .as_deref()
        .and_then(|s| s.parse::<AgentInstanceId>().ok())
        .unwrap_or_else(AgentInstanceId::nil);
    let project_id = sm
        .project_id
        .as_deref()
        .and_then(|s| s.parse::<ProjectId>().ok())
        .unwrap_or_else(ProjectId::nil);
    let role = match sm.role.as_deref() {
        Some("user") => ChatRole::User,
        Some("assistant") => ChatRole::Assistant,
        _ => ChatRole::User,
    };
    Message {
        message_id,
        agent_instance_id,
        project_id,
        role,
        content: sm.content.clone().unwrap_or_default(),
        content_blocks: None,
        thinking: None,
        thinking_duration_ms: None,
        created_at: parse_dt(&sm.created_at),
    }
}

// ---------------------------------------------------------------------------
// Project-level AgentInstance CRUD (proxied to aura-storage)
// ---------------------------------------------------------------------------

pub async fn create_agent_instance(
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
            aura_agents::AgentError::NotFound => ApiError::not_found("agent template not found"),
            _ => ApiError::internal(e.to_string()),
        })?;

    let req = aura_storage::CreateProjectAgentRequest {
        agent_id: body.agent_id.to_string(),
        name: agent.name.clone(),
        role: Some(agent.role.clone()),
        personality: Some(agent.personality.clone()),
        system_prompt: Some(agent.system_prompt.clone()),
        skills: Some(agent.skills.clone()),
        icon: agent.icon.clone(),
    };
    let jwt = state.get_jwt()?;
    let storage_agent = storage
        .create_project_agent(&project_id.to_string(), &jwt, &req)
        .await
        .map_err(map_storage_error)?;

    let instance = merge_agent_instance(&storage_agent, Some(&agent), None);
    Ok(Json(instance))
}

pub async fn list_agent_instances(
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
    let runtime_map = state.runtime_agent_state.lock().await;

    let instances: Vec<AgentInstance> = storage_agents
        .iter()
        .map(|spa| {
            let agent = spa.agent_id.as_deref().and_then(|aid| agent_map.get(aid));
            let aiid = spa.id.parse::<AgentInstanceId>().ok();
            let runtime = aiid.and_then(|id| runtime_map.get(&id));
            merge_agent_instance(spa, agent, runtime)
        })
        .collect();
    Ok(Json(instances))
}

pub async fn get_agent_instance(
    State(state): State<AppState>,
    Path((_project_id, agent_instance_id)): Path<(ProjectId, AgentInstanceId)>,
) -> ApiResult<Json<AgentInstance>> {
    let storage = state.require_storage_client()?;
    let jwt = state.get_jwt()?;
    let storage_agent = storage
        .get_project_agent(&agent_instance_id.to_string(), &jwt)
        .await
        .map_err(|e| match &e {
            aura_storage::StorageError::Server { status: 404, .. } => {
                ApiError::not_found("agent instance not found")
            }
            _ => map_storage_error(e),
        })?;

    let agent = if let Some(ref aid) = storage_agent.agent_id {
        resolve_single_agent(&state, &jwt, aid).await
    } else {
        None
    };
    let runtime_map = state.runtime_agent_state.lock().await;
    let runtime = runtime_map.get(&agent_instance_id);
    let instance = merge_agent_instance(&storage_agent, agent.as_ref(), runtime);
    Ok(Json(instance))
}

pub async fn update_agent_instance(
    State(state): State<AppState>,
    Path((_project_id, agent_instance_id)): Path<(ProjectId, AgentInstanceId)>,
    Json(body): Json<UpdateAgentInstanceRequest>,
) -> ApiResult<Json<AgentInstance>> {
    let storage = state.require_storage_client()?;
    let jwt = state.get_jwt()?;

    if let Some(ref status_str) = body.status {
        let target = aura_agents::parse_agent_status(status_str);

        let current_spa = storage
            .get_project_agent(&agent_instance_id.to_string(), &jwt)
            .await
            .map_err(map_storage_error)?;
        let current = current_spa
            .status
            .as_deref()
            .map(aura_agents::parse_agent_status)
            .unwrap_or(AgentStatus::Idle);

        AgentInstanceService::validate_transition(current, target)
            .map_err(|e| ApiError::bad_request(e.to_string()))?;

        let req = aura_storage::UpdateProjectAgentRequest {
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
    let runtime_map = state.runtime_agent_state.lock().await;
    let runtime = runtime_map.get(&agent_instance_id);
    let instance = merge_agent_instance(&storage_agent, agent.as_ref(), runtime);
    Ok(Json(instance))
}

pub async fn delete_agent_instance(
    State(state): State<AppState>,
    Path((_project_id, agent_instance_id)): Path<(ProjectId, AgentInstanceId)>,
) -> ApiResult<Json<()>> {
    let storage = state.require_storage_client()?;
    let jwt = state.get_jwt()?;
    storage
        .delete_project_agent(&agent_instance_id.to_string(), &jwt)
        .await
        .map_err(|e| match &e {
            aura_storage::StorageError::Server { status: 404, .. } => {
                ApiError::not_found("agent instance not found")
            }
            _ => map_storage_error(e),
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
    let mut messages = Vec::new();

    // Source 1: project-scoped messages from aura-storage
    if let (Some(ref storage), Ok(jwt)) = (&state.storage_client, state.get_jwt()) {
        let all_projects = projects::list_all_projects_from_network(&state)
            .await
            .unwrap_or_default();
        let agent_id_str = agent_id.to_string();

        let pids: Vec<String> = all_projects
            .iter()
            .map(|p| p.project_id.to_string())
            .collect();
        let agent_futs: Vec<_> = pids
            .iter()
            .map(|pid| storage.list_project_agents(pid, &jwt))
            .collect();
        let agent_results = join_all(agent_futs).await;

        let matching_agents: Vec<_> = agent_results
            .into_iter()
            .enumerate()
            .flat_map(|(i, result)| match result {
                Ok(agents) => agents
                    .into_iter()
                    .filter(|a| a.agent_id.as_deref() == Some(agent_id_str.as_str()))
                    .collect::<Vec<_>>(),
                Err(e) => {
                    warn!(project_id = %pids[i], error = %e, "Failed to list project agents");
                    Vec::new()
                }
            })
            .collect();

        let session_futs: Vec<_> = matching_agents
            .iter()
            .map(|pa| storage.list_sessions(&pa.id, &jwt))
            .collect();
        let session_results = join_all(session_futs).await;

        let all_sessions: Vec<_> = session_results
            .into_iter()
            .enumerate()
            .flat_map(|(i, result)| match result {
                Ok(sessions) => sessions,
                Err(e) => {
                    warn!(project_agent_id = %matching_agents[i].id, error = %e, "Failed to list sessions");
                    Vec::new()
                }
            })
            .collect();

        let msg_futs: Vec<_> = all_sessions
            .iter()
            .map(|s| storage.list_messages(&s.id, &jwt, None, None))
            .collect();
        let msg_results = join_all(msg_futs).await;

        for (i, result) in msg_results.into_iter().enumerate() {
            match result {
                Ok(session_msgs) => {
                    for sm in &session_msgs {
                        messages.push(storage_message_to_message(sm));
                    }
                }
                Err(e) => {
                    warn!(session_id = %all_sessions[i].id, error = %e, "Failed to list messages");
                }
            }
        }
    }

    // Source 2: agent-level messages from local store (multi-project chat)
    if let Ok(local_msgs) = state.store.list_agent_messages(&agent_id) {
        messages.extend(local_msgs);
    }

    messages.sort_by(|a, b| a.created_at.cmp(&b.created_at));
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
        Ok(uid) => state
            .agent_service
            .get_agent_async(&uid, &agent_id)
            .await
            .ok(),
        Err(_) => {
            warn!(%agent_id, "No authenticated user, cannot resolve agent");
            None
        }
    };

    let projects: Vec<aura_core::Project> = if let (Some(ref storage), Ok(jwt)) =
        (&state.storage_client, state.get_jwt())
    {
        let all_projects = projects::list_all_projects_from_network(&state)
            .await
            .unwrap_or_default();
        let agent_id_str = agent_id.to_string();
        let mut matched = Vec::new();
        for project in all_projects {
            if let Ok(agents) = storage
                .list_project_agents(&project.project_id.to_string(), &jwt)
                .await
            {
                if agents
                    .iter()
                    .any(|a| a.agent_id.as_deref() == Some(&agent_id_str))
                {
                    matched.push(project);
                }
            }
        }
        matched
    } else {
        Vec::new()
    };

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
    Path((_project_id, agent_instance_id)): Path<(ProjectId, AgentInstanceId)>,
) -> ApiResult<Json<Vec<Message>>> {
    let storage = state.require_storage_client()?;
    let jwt = state.get_jwt()?;

    let sessions = storage
        .list_sessions(&agent_instance_id.to_string(), &jwt)
        .await
        .unwrap_or_default();

    let mut messages = Vec::new();
    for session in &sessions {
        if let Ok(session_msgs) =
            storage.list_messages(&session.id, &jwt, None, None).await
        {
            for sm in &session_msgs {
                messages.push(storage_message_to_message(sm));
            }
        }
    }
    messages.sort_by(|a, b| a.created_at.cmp(&b.created_at));
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
        .await
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
// Sessions (scoped to agent instance, proxied to aura-storage)
// ---------------------------------------------------------------------------

pub async fn list_project_sessions(
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

pub async fn list_sessions(
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
        .filter_map(|s| storage_session_to_session(s, None).map_err(|e| warn!(error = %e, "skipping malformed session")).ok())
        .collect();
    Ok(Json(sessions))
}

pub async fn get_session(
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
            aura_storage::StorageError::Server { status: 404, .. } => {
                ApiError::not_found("session not found")
            }
            _ => map_storage_error(e),
        })?;
    let session = storage_session_to_session(ss, None).map_err(|e| ApiError::internal(e))?;
    Ok(Json(session))
}

pub async fn list_session_tasks(
    State(state): State<AppState>,
    Path((_project_id, _agent_instance_id, session_id)): Path<(
        ProjectId,
        AgentInstanceId,
        SessionId,
    )>,
) -> ApiResult<Json<Vec<Task>>> {
    let storage = state.require_storage_client()?;
    let jwt = state.get_jwt()?;

    // Verify session exists
    storage
        .get_session(&session_id.to_string(), &jwt)
        .await
        .map_err(|e| match &e {
            aura_storage::StorageError::Server { status: 404, .. } => {
                ApiError::not_found("session not found")
            }
            _ => map_storage_error(e),
        })?;

    // aura-storage doesn't track session-task relationships (tasks_worked is
    // not persisted remotely). Return empty until session_id is added to
    // StorageTask.
    Ok(Json(Vec::new()))
}
