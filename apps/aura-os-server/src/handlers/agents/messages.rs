use std::convert::Infallible;
use std::sync::Arc;

use axum::extract::{Path, State};
use axum::http::HeaderValue;
use axum::response::sse::{Event, KeepAlive, Sse};
use axum::Json;
use futures_util::future::join_all;
use tokio_stream::StreamExt;
use tracing::{info, warn};

use aura_os_core::{AgentId, AgentInstanceId, HarnessMode, Message, ProjectId};
use aura_os_link::{HarnessInbound, HarnessOutbound, SessionConfig, UserMessage};
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
        if let Some(session) = sessions.last() {
            return Some(session.id.clone());
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
) -> Option<ChatPersistCtx> {
    let storage = state.storage_client.as_ref()?.clone();
    let jwt = state.get_jwt().ok()?;
    let matching =
        find_matching_project_agents(state, &storage, &jwt, &agent_id.to_string()).await;
    let project_agent = matching.first()?;
    let pai = project_agent.id.clone();
    let pid = project_agent.project_id.clone().unwrap_or_default();
    if pid.is_empty() {
        warn!(%agent_id, "No project_id for agent; skipping chat persistence");
        return None;
    }
    let session_id = resolve_chat_session(&storage, &jwt, &pai, &pid).await?;
    Some(ChatPersistCtx { storage, jwt, session_id, project_agent_id: pai, project_id: pid })
}

const SSE_NO_BUFFERING_HEADERS: [(&str, HeaderValue); 1] =
    [("X-Accel-Buffering", HeaderValue::from_static("no"))];

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
) -> Vec<Message> {
    let msg_futs: Vec<_> = sessions
        .iter()
        .map(|s| storage.list_messages(&s.id, jwt, None, None))
        .collect();
    let msg_results: Vec<Result<Vec<aura_os_storage::StorageMessage>, _>> = join_all(msg_futs).await;
    let mut messages = Vec::new();
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
                warn!(session_id = %session.id, error = %e, "Failed to list messages");
            }
        }
    }
    messages
}

async fn fetch_all_sessions(
    storage: &aura_os_storage::StorageClient,
    jwt: &str,
    agents: &[aura_os_storage::StorageProjectAgent],
) -> Vec<aura_os_storage::StorageSession> {
    let futs: Vec<_> = agents
        .iter()
        .map(|pa| storage.list_sessions(&pa.id, jwt))
        .collect();
    let results: Vec<Result<Vec<aura_os_storage::StorageSession>, _>> = join_all(futs).await;
    results
        .into_iter()
        .zip(agents.iter())
        .flat_map(|(result, agent)| match result {
            Ok(sessions) => sessions,
            Err(e) => {
                warn!(project_agent_id = %agent.id, error = %e, "Failed to list sessions");
                Vec::new()
            }
        })
        .collect()
}

/// Aggregate agent-level messages from aura-storage (all project-agents for
/// this agent_id -> sessions -> messages).
pub(crate) async fn aggregate_agent_messages_from_storage(
    state: &AppState,
    agent_id: &AgentId,
) -> Vec<Message> {
    let (Some(ref storage), Ok(jwt)) = (&state.storage_client, state.get_jwt()) else {
        return Vec::new();
    };
    let agent_id_str = agent_id.to_string();
    let matching = find_matching_project_agents(state, storage, &jwt, &agent_id_str).await;
    let sessions = fetch_all_sessions(storage, &jwt, &matching).await;
    let mut messages = collect_session_messages(storage, &jwt, &sessions).await;
    messages.sort_by(|a, b| a.created_at.cmp(&b.created_at));
    messages
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

    let persist_ctx = setup_agent_chat_persistence(&state, &agent_id).await;

    let jwt = state.get_jwt().ok();
    let config = SessionConfig {
        system_prompt: Some(agent.system_prompt.clone()),
        agent_id: Some(agent_id.to_string()),
        token: jwt,
        ..Default::default()
    };

    let session_key = format!("agent:{agent_id}");
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

    let mut messages = collect_session_messages(&storage, &jwt, &sessions).await;
    messages.sort_by(|a, b| a.created_at.cmp(&b.created_at));
    Ok(Json(messages))
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

    let jwt = state.get_jwt().ok();
    let config = SessionConfig {
        system_prompt: Some(instance.system_prompt.clone()),
        agent_id: Some(instance.agent_id.to_string()),
        token: jwt,
        ..Default::default()
    };

    let session_key = format!("instance:{agent_instance_id}");
    open_harness_chat_stream(&state, &session_key, instance.harness_mode(), config, body.content, persist_ctx).await
}
