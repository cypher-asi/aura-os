use std::convert::Infallible;
use std::sync::Arc;

use axum::extract::{Path, State};
use axum::http::HeaderValue;
use axum::response::sse::{Event, KeepAlive, Sse};
use axum::Json;
use futures_util::future::join_all;
use tokio_stream::StreamExt;
use tracing::{info, warn};

use aura_os_core::{AgentId, AgentInstanceId, ChatRole, HarnessMode, Message, ProjectId};
use aura_os_link::{ConversationMessage, HarnessInbound, HarnessOutbound, SessionConfig, UserMessage};
use aura_os_storage::StorageClient;

use crate::dto::SendMessageRequest;
use crate::error::{ApiError, ApiResult};
use crate::handlers::projects;
use crate::state::{AppState, ChatSession};

use super::conversions::storage_message_to_message;

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
        // Walk backwards to find the most recent session whose messages
        // endpoint is still functional.  Sessions that return 404 on
        // list_messages have been purged upstream and must be skipped —
        // get_session may still return 200 for the record itself.
        for session in sessions.iter().rev() {
            match storage.list_messages(&session.id, jwt, Some(1), None).await {
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
        let req = aura_os_storage::CreateMessageRequest {
            project_agent_id: ctx.project_agent_id,
            project_id: ctx.project_id,
            role: "user".to_string(),
            content,
            org_id: None,
            created_by: None,
            content_blocks: None,
            input_tokens: None,
            output_tokens: None,
            thinking: None,
            thinking_duration_ms: None,
        };
        if let Err(e) = ctx.storage.create_message(&ctx.session_id, &ctx.jwt, &req).await {
            warn!(error = %e, "Failed to persist user chat message");
        }
    });
}

fn spawn_chat_persist_task(
    rx: tokio::sync::broadcast::Receiver<HarnessOutbound>,
    ctx: ChatPersistCtx,
) {
    tokio::spawn(async move {
        let mut rx = rx;
        let mut text_buf = String::new();
        let mut thinking_buf = String::new();

        loop {
            match rx.recv().await {
                Ok(evt) => {
                    let json = serde_json::to_value(&evt).unwrap_or_default();
                    let event_type = json
                        .get("type")
                        .and_then(|t| t.as_str())
                        .unwrap_or("");

                    match event_type {
                        "text_delta" => {
                            if let Some(text) = json.get("text").and_then(|t| t.as_str()) {
                                text_buf.push_str(text);
                            }
                        }
                        "thinking_delta" => {
                            if let Some(t) = json.get("thinking").and_then(|t| t.as_str()) {
                                thinking_buf.push_str(t);
                            }
                        }
                        "assistant_message_end" => {
                            let input_tokens = json
                                .get("usage")
                                .and_then(|u| u.get("input_tokens"))
                                .and_then(|v| v.as_i64());
                            let output_tokens = json
                                .get("usage")
                                .and_then(|u| u.get("output_tokens"))
                                .and_then(|v| v.as_i64());

                            let msg_req = aura_os_storage::CreateMessageRequest {
                                project_agent_id: ctx.project_agent_id.clone(),
                                project_id: ctx.project_id.clone(),
                                role: "assistant".to_string(),
                                content: text_buf,
                                org_id: None,
                                created_by: None,
                                content_blocks: None,
                                input_tokens,
                                output_tokens,
                                thinking: if thinking_buf.is_empty() {
                                    None
                                } else {
                                    Some(thinking_buf)
                                },
                                thinking_duration_ms: None,
                            };
                            if let Err(e) = ctx
                                .storage
                                .create_message(&ctx.session_id, &ctx.jwt, &msg_req)
                                .await
                            {
                                warn!(error = %e, "Failed to persist assistant chat message");
                            } else {
                                info!(
                                    session_id = %ctx.session_id,
                                    "Persisted assistant chat message"
                                );
                            }
                            break;
                        }
                        "error" => break,
                        _ => {}
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

fn messages_to_conversation_history(messages: &[Message]) -> Vec<ConversationMessage> {
    messages
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

async fn collect_session_messages(
    storage: &aura_os_storage::StorageClient,
    jwt: &str,
    sessions: &[aura_os_storage::StorageSession],
) -> MessageCollectOutcome {
    let msg_futs: Vec<_> = sessions
        .iter()
        .map(|s| storage.list_messages(&s.id, jwt, None, None))
        .collect();
    let msg_results: Vec<Result<Vec<aura_os_storage::StorageMessage>, _>> = join_all(msg_futs).await;
    let mut messages = Vec::new();
    let mut failed_sessions = 0usize;
    let mut first_error: Option<aura_os_storage::StorageError> = None;
    for (result, session) in msg_results.into_iter().zip(sessions.iter()) {
        match result {
            Ok(session_msgs) => {
                for sm in session_msgs
                    .iter()
                    .filter(|sm| sm.role.as_deref() != Some("system"))
                {
                    messages.push(storage_message_to_message(sm));
                }
            }
            Err(e) => {
                failed_sessions += 1;
                tracing::debug!(session_id = %session.id, error = %e, "Failed to list session messages");
                if first_error.is_none() {
                    first_error = Some(e);
                }
            }
        }
    }
    MessageCollectOutcome {
        messages,
        total_sessions: sessions.len(),
        failed_sessions,
        first_error,
    }
}

struct MessageCollectOutcome {
    messages: Vec<Message>,
    total_sessions: usize,
    failed_sessions: usize,
    first_error: Option<aura_os_storage::StorageError>,
}

impl MessageCollectOutcome {
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

async fn aggregate_agent_messages_from_storage_result(
    state: &AppState,
    agent_id: &AgentId,
) -> Result<Vec<Message>, aura_os_storage::StorageError> {
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

    let mut message_outcome = collect_session_messages(storage, &jwt, &sessions_outcome.sessions).await;
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

async fn load_project_chat_history(
    state: &AppState,
    agent_instance_id: &AgentInstanceId,
) -> Vec<Message> {
    let (Some(ref storage), Ok(jwt)) = (&state.storage_client, state.get_jwt()) else {
        return Vec::new();
    };
    let sessions = storage
        .list_sessions(&agent_instance_id.to_string(), &jwt)
        .await
        .unwrap_or_default();
    let mut outcome = collect_session_messages(storage, &jwt, &sessions).await;
    outcome.messages.sort_by(|a, b| a.created_at.cmp(&b.created_at));
    outcome.messages
}

/// Aggregate agent-level messages from aura-storage (all project-agents for
/// this agent_id -> sessions -> messages).
pub(crate) async fn aggregate_agent_messages_from_storage(
    state: &AppState,
    agent_id: &AgentId,
) -> Vec<Message> {
    match aggregate_agent_messages_from_storage_result(state, agent_id).await {
        Ok(messages) => messages,
        Err(e) => {
            warn!(error = %e, %agent_id, "failed to aggregate agent messages from storage");
            Vec::new()
        }
    }
}

pub(crate) async fn list_agent_messages(
    State(state): State<AppState>,
    Path(agent_id): Path<AgentId>,
) -> ApiResult<Json<Vec<Message>>> {
    let _ = state.require_storage_client()?;
    let _ = state.get_jwt()?;
    let messages = aggregate_agent_messages_from_storage(&state, &agent_id).await;
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

pub(crate) async fn send_agent_message_stream(
    State(state): State<AppState>,
    Path(agent_id): Path<AgentId>,
    Json(body): Json<SendMessageRequest>,
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
        let stored = aggregate_agent_messages_from_storage(&state, &agent_id).await;
        if stored.is_empty() { None } else { Some(messages_to_conversation_history(&stored)) }
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

pub(crate) async fn list_messages(
    State(state): State<AppState>,
    Path((_project_id, agent_instance_id)): Path<(ProjectId, AgentInstanceId)>,
) -> ApiResult<Json<Vec<Message>>> {
    let storage = state.require_storage_client()?;
    let jwt = state.get_jwt()?;

    let sessions = storage
        .list_sessions(&agent_instance_id.to_string(), &jwt)
        .await
        .unwrap_or_else(|e| {
            warn!(agent_instance_id = %agent_instance_id, error = %e, "failed to list sessions");
            Vec::new()
        });

    let mut outcome = collect_session_messages(&storage, &jwt, &sessions).await;
    outcome
        .messages
        .sort_by(|a, b| a.created_at.cmp(&b.created_at));
    Ok(Json(outcome.messages))
}

pub(crate) async fn send_message_stream(
    State(state): State<AppState>,
    Path((project_id, agent_instance_id)): Path<(ProjectId, AgentInstanceId)>,
    Json(body): Json<SendMessageRequest>,
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
        let stored = load_project_chat_history(&state, &agent_instance_id).await;
        if stored.is_empty() { None } else { Some(messages_to_conversation_history(&stored)) }
    } else {
        None
    };

    let jwt = state.get_jwt().ok();
    let pid_str = project_id.to_string();

    let system_prompt = build_project_system_prompt(&state, &project_id, &instance.system_prompt);

    let installed_tools = super::super::tool_callbacks::build_installed_tools(
        &pid_str,
        jwt.as_deref(),
    );

    let config = SessionConfig {
        system_prompt: Some(system_prompt),
        agent_id: Some(instance.agent_id.to_string()),
        token: jwt,
        conversation_messages,
        project_id: Some(pid_str),
        installed_tools: Some(installed_tools),
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
