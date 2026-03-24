use std::convert::Infallible;
use std::sync::Arc;

use axum::extract::{Path, State};
use axum::http::HeaderValue;
use axum::response::sse::{Event, KeepAlive, Sse};
use axum::Json;
use futures_util::future::join_all;
use tokio_stream::StreamExt;
use tracing::{info, warn};

use aura_os_core::{AgentId, AgentInstanceId, ChatRole, HarnessMode, ProjectId, SessionEvent};
use aura_os_link::{ConversationMessage, HarnessInbound, HarnessOutbound, SessionConfig, UserMessage};
use aura_os_storage::StorageClient;

use crate::dto::SendChatRequest;
use crate::error::{ApiError, ApiResult};
use crate::handlers::projects;
use crate::state::{AppState, ChatSession};

use super::conversions::events_to_session_history;

// ---------------------------------------------------------------------------
// Chat persistence helpers
// ---------------------------------------------------------------------------

#[derive(Clone)]
struct ChatPersistCtx {
    storage: Arc<StorageClient>,
    jwt: String,
    session_id: String,
    project_agent_id: String,
    project_id: String,
}

async fn resolve_chat_session(
    storage: &StorageClient,
    jwt: &str,
    project_agent_id: &str,
    project_id: &str,
) -> Option<String> {
    if let Ok(sessions) = storage.list_sessions(project_agent_id, jwt).await {
        for session in sessions.iter().rev() {
            match storage.list_events(&session.id, jwt, Some(1), None).await {
                Ok(_) => return Some(session.id.clone()),
                Err(e) => {
                    tracing::debug!(
                        session_id = %session.id,
                        error = %e,
                        "Skipping stale session during resolution"
                    );
                }
            }
        }
    }
    let req = aura_os_storage::CreateSessionRequest {
        project_id: project_id.to_string(),
        org_id: None,
        status: Some("active".to_string()),
        context_usage_estimate: None,
        summary_of_previous_context: None,
    };
    match storage.create_session(project_agent_id, jwt, &req).await {
        Ok(session) => Some(session.id),
        Err(e) => {
            warn!(error = %e, "Failed to create chat session in storage");
            None
        }
    }
}

fn persist_user_message(ctx: &ChatPersistCtx, content: &str) {
    let ctx = ctx.clone();
    let content = content.to_string();
    tokio::spawn(async move {
        let req = aura_os_storage::CreateSessionEventRequest {
            session_id: Some(ctx.session_id.clone()),
            user_id: None,
            agent_id: Some(ctx.project_agent_id.clone()),
            sender: Some("user".to_string()),
            project_id: Some(ctx.project_id.clone()),
            org_id: None,
            event_type: "user_message".to_string(),
            content: Some(serde_json::json!({ "text": content })),
        };
        if let Err(e) = ctx.storage.create_event(&ctx.session_id, &ctx.jwt, &req).await {
            warn!(error = %e, "Failed to persist user message event");
        }
    });
}

fn spawn_chat_persist_task(
    rx: tokio::sync::broadcast::Receiver<HarnessOutbound>,
    ctx: ChatPersistCtx,
) {
    tokio::spawn(async move {
        let mut rx = rx;
        let mut full_text = String::new();
        let mut text_segment = String::new();
        let mut thinking_buf = String::new();
        let mut content_blocks: Vec<serde_json::Value> = Vec::new();
        let mut message_id = String::new();
        let mut seq: u32 = 0;
        let mut last_tool_use_id = String::new();

        let persist = |event_type: &str, content: serde_json::Value| {
            let ctx = ctx.clone();
            let event_type = event_type.to_string();
            async move {
                let req = aura_os_storage::CreateSessionEventRequest {
                    session_id: Some(ctx.session_id.clone()),
                    user_id: None,
                    agent_id: Some(ctx.project_agent_id.clone()),
                    sender: Some("agent".to_string()),
                    project_id: Some(ctx.project_id.clone()),
                    org_id: None,
                    event_type,
                    content: Some(content),
                };
                if let Err(e) = ctx.storage.create_event(&ctx.session_id, &ctx.jwt, &req).await {
                    warn!(error = %e, "Failed to persist chat event");
                }
            }
        };

        loop {
            match rx.recv().await {
                Ok(evt) => {
                    seq += 1;
                    match evt {
                        HarnessOutbound::SessionReady(_) => {}
                        HarnessOutbound::AssistantMessageStart(ref start) => {
                            message_id = start.message_id.clone();
                            persist("assistant_message_start", serde_json::json!({
                                "message_id": &start.message_id,
                                "seq": seq,
                            })).await;
                        }
                        HarnessOutbound::TextDelta(ref delta) => {
                            full_text.push_str(&delta.text);
                            text_segment.push_str(&delta.text);
                            persist("text_delta", serde_json::json!({
                                "message_id": &message_id,
                                "text": &delta.text,
                                "seq": seq,
                            })).await;
                        }
                        HarnessOutbound::ThinkingDelta(ref delta) => {
                            thinking_buf.push_str(&delta.thinking);
                            persist("thinking_delta", serde_json::json!({
                                "message_id": &message_id,
                                "thinking": &delta.thinking,
                                "seq": seq,
                            })).await;
                        }
                        HarnessOutbound::ToolUseStart(ref tool) => {
                            if !text_segment.is_empty() {
                                content_blocks.push(serde_json::json!({
                                    "type": "text", "text": &text_segment
                                }));
                                text_segment.clear();
                            }
                            last_tool_use_id = tool.id.clone();
                            content_blocks.push(serde_json::json!({
                                "type": "tool_use",
                                "id": &tool.id,
                                "name": &tool.name,
                                "input": {}
                            }));
                            persist("tool_use_start", serde_json::json!({
                                "message_id": &message_id,
                                "id": &tool.id,
                                "name": &tool.name,
                                "seq": seq,
                            })).await;
                        }
                        HarnessOutbound::ToolResult(ref result) => {
                            content_blocks.push(serde_json::json!({
                                "type": "tool_result",
                                "tool_use_id": &last_tool_use_id,
                                "content": &result.result,
                                "is_error": result.is_error
                            }));
                            persist("tool_result", serde_json::json!({
                                "message_id": &message_id,
                                "tool_use_id": &last_tool_use_id,
                                "name": &result.name,
                                "result": &result.result,
                                "is_error": result.is_error,
                                "seq": seq,
                            })).await;
                        }
                        HarnessOutbound::AssistantMessageEnd(ref end) => {
                            if !text_segment.is_empty() {
                                content_blocks.push(serde_json::json!({
                                    "type": "text", "text": &text_segment
                                }));
                            }
                            persist("assistant_message_end", serde_json::json!({
                                "message_id": &end.message_id,
                                "text": &full_text,
                                "thinking": if thinking_buf.is_empty() { serde_json::Value::Null } else { serde_json::Value::String(thinking_buf) },
                                "content_blocks": &content_blocks,
                                "usage": {
                                    "input_tokens": end.usage.input_tokens,
                                    "output_tokens": end.usage.output_tokens,
                                },
                                "stop_reason": &end.stop_reason,
                                "seq": seq,
                            })).await;
                            info!(session_id = %ctx.session_id, "Persisted assistant turn events");
                            break;
                        }
                        HarnessOutbound::Error(ref err) => {
                            persist("error", serde_json::json!({
                                "message_id": &message_id,
                                "code": &err.code,
                                "message": &err.message,
                                "recoverable": err.recoverable,
                                "seq": seq,
                            })).await;
                            break;
                        }
                    }
                }
                Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
                Err(tokio::sync::broadcast::error::RecvError::Lagged(n)) => {
                    warn!(skipped = n, "Chat persistence receiver lagged");
                }
            }
        }
    });
}

async fn setup_project_chat_persistence(
    state: &AppState,
    project_id: &ProjectId,
    agent_instance_id: &AgentInstanceId,
) -> Option<ChatPersistCtx> {
    let storage = state.storage_client.as_ref()?.clone();
    let jwt = state.get_jwt().ok()?;
    let pai = agent_instance_id.to_string();
    let pid = project_id.to_string();
    let session_id = resolve_chat_session(&storage, &jwt, &pai, &pid).await?;
    Some(ChatPersistCtx { storage, jwt, session_id, project_agent_id: pai, project_id: pid })
}

async fn setup_agent_chat_persistence(
    state: &AppState,
    agent_id: &AgentId,
    agent_name: &str,
) -> Option<ChatPersistCtx> {
    let storage = state.storage_client.as_ref()?.clone();
    let jwt = state.get_jwt().ok()?;
    let matching =
        find_matching_project_agents(state, &storage, &jwt, &agent_id.to_string()).await;

    let (pai, pid) = if let Some(pa) = matching.first() {
        let pid = pa.project_id.clone().unwrap_or_default();
        if pid.is_empty() {
            warn!(%agent_id, "No project_id for agent; skipping chat persistence");
            return None;
        }
        (pa.id.clone(), pid)
    } else {
        // No project_agent exists — auto-create one in the first available project.
        let all_projects = projects::list_all_projects_from_network(state).await.ok()?;
        let project = all_projects.first()?;
        let project_id_str = project.project_id.to_string();
        let req = aura_os_storage::CreateProjectAgentRequest {
            agent_id: agent_id.to_string(),
            name: agent_name.to_string(),
            org_id: None,
            role: None,
            personality: None,
            system_prompt: None,
            skills: None,
            icon: None,
            harness: None,
        };
        match storage.create_project_agent(&project_id_str, &jwt, &req).await {
            Ok(pa) => {
                let pid = pa.project_id.clone().unwrap_or(project_id_str);
                (pa.id, pid)
            }
            Err(e) => {
                warn!(error = %e, %agent_id, "Failed to auto-create project_agent for chat persistence");
                return None;
            }
        }
    };

    let session_id = resolve_chat_session(&storage, &jwt, &pai, &pid).await?;
    Some(ChatPersistCtx { storage, jwt, session_id, project_agent_id: pai, project_id: pid })
}

const SSE_NO_BUFFERING_HEADERS: [(&str, HeaderValue); 1] =
    [("X-Accel-Buffering", HeaderValue::from_static("no"))];

fn has_live_session(state: &AppState, key: &str) -> bool {
    if let Ok(reg) = state.chat_sessions.try_lock() {
        if let Some(s) = reg.get(key) {
            return s.is_alive();
        }
    }
    false
}

fn session_events_to_conversation_history(events: &[SessionEvent]) -> Vec<ConversationMessage> {
    events
        .iter()
        .filter_map(|m| {
            let role = match m.role {
                ChatRole::User => "user",
                ChatRole::Assistant => "assistant",
                _ => return None,
            };
            if m.content.is_empty() {
                return None;
            }
            Some(ConversationMessage {
                role: role.to_string(),
                content: m.content.clone(),
            })
        })
        .collect()
}

async fn find_matching_project_agents(
    state: &AppState,
    storage: &aura_os_storage::StorageClient,
    jwt: &str,
    agent_id_str: &str,
) -> Vec<aura_os_storage::StorageProjectAgent> {
    let all_projects = match projects::list_all_projects_from_network(state).await {
        Ok(p) => p,
        Err((status, body)) => {
            warn!(?status, ?body, "failed to list projects for agent matching");
            return Vec::new();
        }
    };
    let pids: Vec<String> = all_projects
        .iter()
        .map(|p| p.project_id.to_string())
        .collect();
    let futs: Vec<_> = pids
        .iter()
        .map(|pid| storage.list_project_agents(pid, jwt))
        .collect();
    let results = join_all(futs).await;

    results
        .into_iter()
        .zip(pids.iter())
        .flat_map(|(result, pid)| match result {
            Ok(agents) => agents
                .into_iter()
                .filter(|a| a.agent_id.as_deref() == Some(agent_id_str))
                .collect::<Vec<_>>(),
            Err(e) => {
                warn!(project_id = %pid, error = %e, "Failed to list project agents");
                Vec::new()
            }
        })
        .collect()
}

async fn collect_session_events(
    storage: &aura_os_storage::StorageClient,
    jwt: &str,
    sessions: &[aura_os_storage::StorageSession],
) -> EventCollectOutcome {
    let evt_futs: Vec<_> = sessions
        .iter()
        .map(|s| storage.list_events(&s.id, jwt, None, None))
        .collect();
    let evt_results: Vec<Result<Vec<aura_os_storage::StorageSessionEvent>, _>> =
        join_all(evt_futs).await;
    let mut messages = Vec::new();
    let mut failed_sessions = 0usize;
    let mut first_error: Option<aura_os_storage::StorageError> = None;
    for (result, session) in evt_results.into_iter().zip(sessions.iter()) {
        match result {
            Ok(events) => {
                let pai = session.project_agent_id.as_deref().unwrap_or_default();
                let pid = session.project_id.as_deref().unwrap_or_default();
                messages.extend(events_to_session_history(&events, pai, pid));
            }
            Err(e) => {
                failed_sessions += 1;
                tracing::debug!(session_id = %session.id, error = %e, "Failed to list session events");
                if first_error.is_none() {
                    first_error = Some(e);
                }
            }
        }
    }
    EventCollectOutcome {
        messages,
        total_sessions: sessions.len(),
        failed_sessions,
        first_error,
    }
}

struct EventCollectOutcome {
    messages: Vec<SessionEvent>,
    total_sessions: usize,
    failed_sessions: usize,
    first_error: Option<aura_os_storage::StorageError>,
}

impl EventCollectOutcome {
    fn all_failed(&self) -> bool {
        self.total_sessions > 0 && self.failed_sessions == self.total_sessions
    }
}

struct SessionFetchOutcome {
    sessions: Vec<aura_os_storage::StorageSession>,
    total_agents: usize,
    failed_agents: usize,
    first_error: Option<aura_os_storage::StorageError>,
}

impl SessionFetchOutcome {
    fn all_failed(&self) -> bool {
        self.total_agents > 0 && self.failed_agents == self.total_agents
    }
}

async fn fetch_all_sessions(
    storage: &aura_os_storage::StorageClient,
    jwt: &str,
    agents: &[aura_os_storage::StorageProjectAgent],
) -> SessionFetchOutcome {
    let futs: Vec<_> = agents
        .iter()
        .map(|pa| storage.list_sessions(&pa.id, jwt))
        .collect();
    let results: Vec<Result<Vec<aura_os_storage::StorageSession>, _>> = join_all(futs).await;
    let mut sessions = Vec::new();
    let mut failed_agents = 0usize;
    let mut first_error: Option<aura_os_storage::StorageError> = None;

    for (result, agent) in results.into_iter().zip(agents.iter()) {
        match result {
            Ok(sessions) => sessions,
            Err(e) => {
                failed_agents += 1;
                warn!(project_agent_id = %agent.id, error = %e, "Failed to list sessions");
                if first_error.is_none() {
                    first_error = Some(e);
                }
                Vec::new()
            }
        }
        .into_iter()
        .for_each(|session| sessions.push(session));
    }

    SessionFetchOutcome {
        sessions,
        total_agents: agents.len(),
        failed_agents,
        first_error,
    }
}

async fn aggregate_agent_events_from_storage_result(
    state: &AppState,
    agent_id: &AgentId,
) -> Result<Vec<SessionEvent>, aura_os_storage::StorageError> {
    let (Some(ref storage), Ok(jwt)) = (&state.storage_client, state.get_jwt()) else {
        return Ok(Vec::new());
    };
    let agent_id_str = agent_id.to_string();
    let matching = find_matching_project_agents(state, storage, &jwt, &agent_id_str).await;
    let sessions_outcome = fetch_all_sessions(storage, &jwt, &matching).await;

    if sessions_outcome.all_failed() {
        if let Some(err) = sessions_outcome.first_error {
            return Err(err);
        }
    }

    let mut message_outcome = collect_session_events(storage, &jwt, &sessions_outcome.sessions).await;
    if message_outcome.all_failed() {
        if let Some(err) = message_outcome.first_error {
            return Err(err);
        }
    }
    message_outcome
        .messages
        .sort_by(|a, b| a.created_at.cmp(&b.created_at));
    Ok(message_outcome.messages)
}

async fn load_project_session_history(
    state: &AppState,
    agent_instance_id: &AgentInstanceId,
) -> Vec<SessionEvent> {
    let (Some(ref storage), Ok(jwt)) = (&state.storage_client, state.get_jwt()) else {
        return Vec::new();
    };
    let sessions = storage
        .list_sessions(&agent_instance_id.to_string(), &jwt)
        .await
        .unwrap_or_default();
    let mut outcome = collect_session_events(storage, &jwt, &sessions).await;
    outcome.messages.sort_by(|a, b| a.created_at.cmp(&b.created_at));
    outcome.messages
}

/// Aggregate agent-level messages from aura-storage (all project-agents for
/// this agent_id -> sessions -> messages).
pub(crate) async fn aggregate_agent_events_from_storage(
    state: &AppState,
    agent_id: &AgentId,
) -> Vec<SessionEvent> {
    match aggregate_agent_events_from_storage_result(state, agent_id).await {
        Ok(messages) => messages,
        Err(e) => {
            warn!(error = %e, %agent_id, "failed to aggregate agent messages from storage");
            Vec::new()
        }
    }
}

pub(crate) async fn list_agent_events(
    State(state): State<AppState>,
    Path(agent_id): Path<AgentId>,
) -> ApiResult<Json<Vec<SessionEvent>>> {
    let _ = state.require_storage_client()?;
    let _ = state.get_jwt()?;
    let messages = aggregate_agent_events_from_storage(&state, &agent_id).await;
    Ok(Json(messages))
}

async fn get_or_create_chat_session(
    state: &AppState,
    key: &str,
    harness_mode: HarnessMode,
    session_config: SessionConfig,
) -> ApiResult<(bool, tokio::sync::broadcast::Receiver<aura_os_link::HarnessOutbound>, tokio::sync::mpsc::UnboundedSender<HarnessInbound>)> {
    {
        let reg = state.chat_sessions.lock().await;
        if let Some(session) = reg.get(key) {
            if session.is_alive() {
                let rx = session.events_tx.subscribe();
                return Ok((false, rx, session.commands_tx.clone()));
            }
        }
    }

    let harness = state.harness_for(harness_mode);
    let session = harness
        .open_session(session_config)
        .await
        .map_err(|e| ApiError::internal(format!("opening harness session: {e}")))?;

    let rx = session.events_tx.subscribe();
    let commands_tx = session.commands_tx.clone();

    {
        let mut reg = state.chat_sessions.lock().await;
        reg.insert(key.to_string(), ChatSession {
            session_id: session.session_id,
            commands_tx: session.commands_tx,
            events_tx: session.events_tx,
        });
    }

    Ok((true, rx, commands_tx))
}

async fn open_harness_chat_stream(
    state: &AppState,
    session_key: &str,
    harness_mode: HarnessMode,
    session_config: SessionConfig,
    user_content: String,
    persist_ctx: Option<ChatPersistCtx>,
) -> ApiResult<(
    [(&'static str, HeaderValue); 1],
    Sse<impl futures_core::Stream<Item = Result<Event, Infallible>>>,
)> {
    let (is_new, rx, commands_tx) =
        get_or_create_chat_session(state, session_key, harness_mode, session_config).await?;

    // Subscribe the persistence receiver *before* sending the user message so
    // we don't miss early harness events in a fast-response scenario.
    let persist_rx = if persist_ctx.is_some() {
        Some(rx.resubscribe())
    } else {
        None
    };

    if let Some(ref ctx) = persist_ctx {
        persist_user_message(ctx, &user_content);
    }

    commands_tx
        .send(HarnessInbound::UserMessage(UserMessage {
            content: user_content,
        }))
        .map_err(|e| ApiError::internal(format!("sending user message: {e}")))?;

    if let (Some(ctx), Some(prx)) = (persist_ctx, persist_rx) {
        spawn_chat_persist_task(prx, ctx);
    }

    let prefix: Vec<Result<Event, Infallible>> = if is_new {
        let progress_event = Event::default()
            .event("progress")
            .json_data(&serde_json::json!({"type":"progress","stage":"connecting"}))
            .unwrap();
        vec![Ok(progress_event)]
    } else {
        vec![]
    };

    let broadcast_stream = tokio_stream::wrappers::BroadcastStream::new(rx)
        .filter_map(|r| r.ok())
        .map(|evt| super::super::sse::harness_event_to_sse(&evt));

    let stream = futures_util::stream::iter(prefix).chain(broadcast_stream);

    Ok((
        SSE_NO_BUFFERING_HEADERS,
        Sse::new(stream).keep_alive(KeepAlive::default()),
    ))
}

pub(crate) async fn send_agent_event_stream(
    State(state): State<AppState>,
    Path(agent_id): Path<AgentId>,
    Json(body): Json<SendChatRequest>,
) -> ApiResult<(
    [(&'static str, HeaderValue); 1],
    Sse<impl futures_core::Stream<Item = Result<Event, Infallible>>>,
)> {
    super::super::billing::require_credits(&state).await?;
    info!(%agent_id, action = ?body.action, "Agent message stream requested");

    let agent = state
        .agent_service
        .get_agent_async("", &agent_id)
        .await
        .map_err(|e| ApiError::internal(format!("looking up agent: {e}")))?;

    let persist_ctx = setup_agent_chat_persistence(&state, &agent_id, &agent.name).await;

    let session_key = format!("agent:{agent_id}");
    let conversation_messages = if !has_live_session(&state, &session_key) {
        let stored = aggregate_agent_events_from_storage(&state, &agent_id).await;
        if stored.is_empty() { None } else { Some(session_events_to_conversation_history(&stored)) }
    } else {
        None
    };

    let jwt = state.get_jwt().ok();
    let config = SessionConfig {
        system_prompt: Some(agent.system_prompt.clone()),
        agent_id: Some(agent_id.to_string()),
        token: jwt,
        conversation_messages,
        ..Default::default()
    };

    open_harness_chat_stream(&state, &session_key, agent.harness_mode(), config, body.content, persist_ctx).await
}

pub(crate) async fn list_events(
    State(state): State<AppState>,
    Path((_project_id, agent_instance_id)): Path<(ProjectId, AgentInstanceId)>,
) -> ApiResult<Json<Vec<SessionEvent>>> {
    let storage = state.require_storage_client()?;
    let jwt = state.get_jwt()?;

    let sessions = storage
        .list_sessions(&agent_instance_id.to_string(), &jwt)
        .await
        .unwrap_or_else(|e| {
            warn!(agent_instance_id = %agent_instance_id, error = %e, "failed to list sessions");
            Vec::new()
        });

    let mut outcome = collect_session_events(&storage, &jwt, &sessions).await;
    outcome
        .messages
        .sort_by(|a, b| a.created_at.cmp(&b.created_at));
    Ok(Json(outcome.messages))
}

pub(crate) async fn send_event_stream(
    State(state): State<AppState>,
    Path((project_id, agent_instance_id)): Path<(ProjectId, AgentInstanceId)>,
    Json(body): Json<SendChatRequest>,
) -> ApiResult<(
    [(&'static str, HeaderValue); 1],
    Sse<impl futures_core::Stream<Item = Result<Event, Infallible>>>,
)> {
    super::super::billing::require_credits(&state).await?;
    info!(%project_id, %agent_instance_id, action = ?body.action, "Message stream requested");

    let instance = state
        .agent_instance_service
        .get_instance(&project_id, &agent_instance_id)
        .await
        .map_err(|e| ApiError::internal(format!("looking up agent instance: {e}")))?;

    let persist_ctx =
        setup_project_chat_persistence(&state, &project_id, &agent_instance_id).await;

    let session_key = format!("instance:{agent_instance_id}");
    let conversation_messages = if !has_live_session(&state, &session_key) {
        let stored = load_project_session_history(&state, &agent_instance_id).await;
        if stored.is_empty() { None } else { Some(session_events_to_conversation_history(&stored)) }
    } else {
        None
    };

    let jwt = state.get_jwt().ok();
    let pid_str = project_id.to_string();

    let system_prompt = build_project_system_prompt(&state, &project_id, &instance.system_prompt);

    let project_path = state
        .project_service
        .get_project(&project_id)
        .ok()
        .map(|p| p.linked_folder_path)
        .filter(|s| !s.is_empty());

    let config = SessionConfig {
        system_prompt: Some(system_prompt),
        agent_id: Some(instance.agent_id.to_string()),
        token: jwt,
        conversation_messages,
        project_id: Some(pid_str),
        project_path,
        ..Default::default()
    };

    open_harness_chat_stream(&state, &session_key, instance.harness_mode(), config, body.content, persist_ctx).await
}

fn build_project_system_prompt(
    state: &AppState,
    project_id: &ProjectId,
    agent_prompt: &str,
) -> String {
    let project_ctx = match state.project_service.get_project(project_id) {
        Ok(p) => {
            let desc: &str = &p.description;
            let folder: &str = &p.linked_folder_path;
            let mut ctx = format!(
                "<project_context>\nproject_id: {}\nproject_name: {}\n",
                project_id, p.name,
            );
            if !desc.is_empty() {
                ctx.push_str(&format!("description: {}\n", desc));
            }
            if !folder.is_empty() {
                ctx.push_str(&format!("workspace: {}\n", folder));
            }
            ctx.push_str("</project_context>\n\n");
            ctx.push_str("IMPORTANT: When calling tools that accept a project_id parameter, always use the project_id from the project_context above.\n\n");
            ctx
        }
        Err(_) => {
            format!(
                "<project_context>\nproject_id: {}\n</project_context>\n\n\
                 IMPORTANT: When calling tools that accept a project_id parameter, always use the project_id above.\n\n",
                project_id,
            )
        }
    };
    format!("{}{}", project_ctx, agent_prompt)
}
