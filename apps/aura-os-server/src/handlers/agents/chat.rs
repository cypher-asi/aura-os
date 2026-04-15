use std::convert::Infallible;
use std::pin::Pin;
use std::sync::Arc;

use axum::extract::{Path, Query, State};
use axum::http::{HeaderValue, StatusCode};
use axum::response::sse::{Event, KeepAlive, Sse};
use axum::Json;
use futures_util::future::join_all;
use futures_util::stream;
use futures_util::StreamExt as FuturesStreamExt;
use serde::{Deserialize, Serialize};
use tracing::{error, info, warn};

pub(crate) type SseStream =
    Pin<Box<dyn futures_core::Stream<Item = Result<Event, Infallible>> + Send>>;
pub(crate) type SseResponse = ([(&'static str, HeaderValue); 1], Sse<SseStream>);

const DEFAULT_AGENT_HISTORY_WINDOW_LIMIT: usize = 80;
const MAX_AGENT_HISTORY_WINDOW_LIMIT: usize = 400;

use aura_os_core::{
    Agent, AgentId, AgentInstanceId, ChatContentBlock, ChatRole, HarnessMode, ProjectId,
    SessionEvent,
};
use aura_os_link::{
    ConversationMessage, HarnessInbound, HarnessOutbound, MessageAttachment, SessionConfig,
    SessionUsage, UserMessage,
};
use aura_os_storage::StorageClient;

use crate::dto::{ChatAttachmentDto, SendChatRequest};
use crate::error::{map_storage_error, ApiError, ApiResult};
use crate::handlers::agents::workspace_tools::{
    installed_workspace_app_tools, installed_workspace_integrations_for_org_with_token,
};
use crate::handlers::billing::require_credits_for_auth_source;
use crate::handlers::{projects, projects_helpers::resolve_agent_instance_workspace_path};
use crate::state::{AppState, AuthJwt, ChatSession};

use super::conversions::events_to_session_history;
use super::runtime::{
    build_harness_provider_config, effective_model, resolve_integration, resolve_integration_ref,
    send_external_agent_event_stream,
};

// ---------------------------------------------------------------------------
// Chat persistence helpers
// ---------------------------------------------------------------------------

#[derive(Clone)]
pub(crate) struct ChatPersistCtx {
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
    match storage.list_sessions(project_agent_id, jwt).await {
        Ok(sessions) => {
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
        Err(e) => {
            warn!(
                %project_agent_id,
                error = %e,
                "Failed to list sessions for chat resolution"
            );
        }
    }
    let req = aura_os_storage::CreateSessionRequest {
        project_id: project_id.to_string(),
        org_id: None,
        model: None,
        status: Some("active".to_string()),
        context_usage_estimate: None,
        summary_of_previous_context: None,
    };
    match storage.create_session(project_agent_id, jwt, &req).await {
        Ok(session) => Some(session.id),
        Err(e) => {
            error!(error = %e, %project_agent_id, "Failed to create chat session in storage");
            None
        }
    }
}

pub(crate) fn persist_user_message(
    ctx: &ChatPersistCtx,
    content: &str,
    attachments: &Option<Vec<ChatAttachmentDto>>,
) {
    let ctx = ctx.clone();
    let content = content.to_string();

    let content_blocks: Option<serde_json::Value> = attachments.as_ref().and_then(|atts| {
        let image_blocks: Vec<serde_json::Value> = atts
            .iter()
            .filter(|a| a.type_ == "image")
            .map(|a| {
                serde_json::json!({
                    "type": "image",
                    "media_type": a.media_type,
                    "data": a.data,
                })
            })
            .collect();
        if image_blocks.is_empty() {
            None
        } else {
            let mut blocks = Vec::new();
            if !content.is_empty() {
                blocks.push(serde_json::json!({ "type": "text", "text": content }));
            }
            blocks.extend(image_blocks);
            Some(serde_json::Value::Array(blocks))
        }
    });

    tokio::spawn(async move {
        let mut payload = serde_json::json!({ "text": content });
        if let Some(blocks) = content_blocks {
            payload["content_blocks"] = blocks;
        }
        let req = aura_os_storage::CreateSessionEventRequest {
            session_id: Some(ctx.session_id.clone()),
            user_id: None,
            agent_id: Some(ctx.project_agent_id.clone()),
            sender: Some("user".to_string()),
            project_id: Some(ctx.project_id.clone()),
            org_id: None,
            event_type: "user_message".to_string(),
            content: Some(payload),
        };
        if let Err(e) = ctx
            .storage
            .create_event(&ctx.session_id, &ctx.jwt, &req)
            .await
        {
            error!(
                error = %e,
                session_id = %ctx.session_id,
                project_agent_id = %ctx.project_agent_id,
                "Failed to persist user message event"
            );
        }
    });
}

pub(crate) fn spawn_chat_persist_task(
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
                if let Err(e) = ctx
                    .storage
                    .create_event(&ctx.session_id, &ctx.jwt, &req)
                    .await
                {
                    error!(
                        error = %e,
                        session_id = %ctx.session_id,
                        project_agent_id = %ctx.project_agent_id,
                        "Failed to persist chat event"
                    );
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
                            persist(
                                "assistant_message_start",
                                serde_json::json!({
                                    "message_id": &start.message_id,
                                    "seq": seq,
                                }),
                            )
                            .await;
                        }
                        HarnessOutbound::TextDelta(ref delta) => {
                            full_text.push_str(&delta.text);
                            text_segment.push_str(&delta.text);
                            persist(
                                "text_delta",
                                serde_json::json!({
                                    "message_id": &message_id,
                                    "text": &delta.text,
                                    "seq": seq,
                                }),
                            )
                            .await;
                        }
                        HarnessOutbound::ThinkingDelta(ref delta) => {
                            thinking_buf.push_str(&delta.thinking);
                            persist(
                                "thinking_delta",
                                serde_json::json!({
                                    "message_id": &message_id,
                                    "thinking": &delta.thinking,
                                    "seq": seq,
                                }),
                            )
                            .await;
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
                                "input": serde_json::Value::Null
                            }));
                            persist(
                                "tool_use_start",
                                serde_json::json!({
                                    "message_id": &message_id,
                                    "id": &tool.id,
                                    "name": &tool.name,
                                    "seq": seq,
                                }),
                            )
                            .await;
                        }
                        HarnessOutbound::ToolCallSnapshot(ref snap) => {
                            if let Some(block) = content_blocks.iter_mut().rev().find(|b| {
                                b.get("type").and_then(|t| t.as_str()) == Some("tool_use")
                                    && b.get("id").and_then(|i| i.as_str()) == Some(&snap.id)
                            }) {
                                block["input"] = snap.input.clone();
                            } else {
                                content_blocks.push(serde_json::json!({
                                    "type": "tool_use",
                                    "id": &snap.id,
                                    "name": &snap.name,
                                    "input": &snap.input,
                                }));
                            }
                            persist(
                                "tool_call_snapshot",
                                serde_json::json!({
                                    "message_id": &message_id,
                                    "id": &snap.id,
                                    "name": &snap.name,
                                    "input": &snap.input,
                                    "seq": seq,
                                }),
                            )
                            .await;
                        }
                        HarnessOutbound::ToolResult(ref result) => {
                            content_blocks.push(serde_json::json!({
                                "type": "tool_result",
                                "tool_use_id": &last_tool_use_id,
                                "content": &result.result,
                                "is_error": result.is_error
                            }));
                            persist(
                                "tool_result",
                                serde_json::json!({
                                    "message_id": &message_id,
                                    "tool_use_id": &last_tool_use_id,
                                    "name": &result.name,
                                    "result": &result.result,
                                    "is_error": result.is_error,
                                    "seq": seq,
                                }),
                            )
                            .await;
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
                                "usage": &end.usage,
                                "files_changed": &end.files_changed,
                                "stop_reason": &end.stop_reason,
                                "seq": seq,
                            })).await;
                            info!(session_id = %ctx.session_id, "Persisted assistant turn events");
                            break;
                        }
                        HarnessOutbound::Error(ref err) => {
                            persist(
                                "error",
                                serde_json::json!({
                                    "message_id": &message_id,
                                    "code": &err.code,
                                    "message": &err.message,
                                    "recoverable": err.recoverable,
                                    "seq": seq,
                                }),
                            )
                            .await;
                            break;
                        }
                        HarnessOutbound::GenerationStart(_)
                        | HarnessOutbound::GenerationProgress(_)
                        | HarnessOutbound::GenerationPartialImage(_)
                        | HarnessOutbound::GenerationCompleted(_)
                        | HarnessOutbound::GenerationError(_) => {}
                    }
                }
                Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
                Err(tokio::sync::broadcast::error::RecvError::Lagged(n)) => {
                    error!(
                        session_id = %ctx.session_id,
                        project_agent_id = %ctx.project_agent_id,
                        skipped = n,
                        "Chat persistence receiver lagged; aborting this turn persistence to avoid partial replay"
                    );
                    break;
                }
            }
        }
    });
}

pub(crate) fn persist_external_agent_turn(ctx: &ChatPersistCtx, text: &str, usage: &SessionUsage) {
    let ctx = ctx.clone();
    let text = text.to_string();
    let usage = usage.clone();
    tokio::spawn(async move {
        let text_block = text.clone();
        let req = aura_os_storage::CreateSessionEventRequest {
            session_id: Some(ctx.session_id.clone()),
            user_id: None,
            agent_id: Some(ctx.project_agent_id.clone()),
            sender: Some("agent".to_string()),
            project_id: Some(ctx.project_id.clone()),
            org_id: None,
            event_type: "assistant_message_end".to_string(),
            content: Some(serde_json::json!({
                "message_id": uuid::Uuid::new_v4().to_string(),
                "text": text,
                "thinking": serde_json::Value::Null,
                "content_blocks": [{
                    "type": "text",
                    "text": text_block
                }],
                "usage": usage,
                "files_changed": {
                    "created": [],
                    "modified": [],
                    "deleted": []
                },
                "stop_reason": "end_turn"
            })),
        };
        if let Err(e) = ctx
            .storage
            .create_event(&ctx.session_id, &ctx.jwt, &req)
            .await
        {
            warn!(error = %e, "Failed to persist external agent message");
        }
    });
}

async fn setup_project_chat_persistence(
    state: &AppState,
    project_id: &ProjectId,
    agent_instance_id: &AgentInstanceId,
    jwt: &str,
) -> Option<ChatPersistCtx> {
    let storage = state.storage_client.as_ref()?.clone();
    let jwt = jwt.to_string();
    let pai = agent_instance_id.to_string();
    let pid = project_id.to_string();
    let session_id = resolve_chat_session(&storage, &jwt, &pai, &pid).await?;
    Some(ChatPersistCtx {
        storage,
        jwt,
        session_id,
        project_agent_id: pai,
        project_id: pid,
    })
}

pub(crate) async fn setup_agent_chat_persistence(
    state: &AppState,
    agent_id: &AgentId,
    _agent_name: &str,
    jwt: &str,
) -> Option<ChatPersistCtx> {
    let storage = match state.storage_client.as_ref() {
        Some(s) => s.clone(),
        None => {
            warn!(%agent_id, "agent chat persistence: no storage client configured");
            return None;
        }
    };
    let jwt = jwt.to_string();
    let matching = find_matching_project_agents(state, &storage, &jwt, &agent_id.to_string()).await;

    let (pai, pid) = if let Some(pa) = matching.first() {
        let pid = pa.project_id.clone().unwrap_or_default();
        if pid.is_empty() {
            warn!(%agent_id, "No project_id for agent; skipping chat persistence");
            return None;
        }
        info!(%agent_id, project_agent_id = %pa.id, %pid, "agent chat persistence: matched existing project agent");
        (pa.id.clone(), pid)
    } else {
        info!(
            %agent_id,
            "agent chat persistence: no matching project agents found; skipping persistence"
        );
        return None;
    };

    let session_id = match resolve_chat_session(&storage, &jwt, &pai, &pid).await {
        Some(sid) => sid,
        None => {
            warn!(%agent_id, %pai, %pid, "agent chat persistence: failed to resolve/create chat session");
            return None;
        }
    };
    Some(ChatPersistCtx {
        storage,
        jwt,
        session_id,
        project_agent_id: pai,
        project_id: pid,
    })
}

const SSE_NO_BUFFERING_HEADERS: [(&str, HeaderValue); 1] =
    [("X-Accel-Buffering", HeaderValue::from_static("no"))];

fn harness_broadcast_to_sse(
    rx: tokio::sync::broadcast::Receiver<HarnessOutbound>,
) -> impl futures_core::Stream<Item = Result<Event, Infallible>> + Send {
    stream::unfold((rx, false), |(mut rx, done)| async move {
        if done {
            return None;
        }

        loop {
            match rx.recv().await {
                Ok(evt) => {
                    let should_close = matches!(
                        evt,
                        HarnessOutbound::AssistantMessageEnd(_) | HarnessOutbound::Error(_)
                    );
                    let event = super::super::sse::harness_event_to_sse(&evt);
                    return Some((event, (rx, should_close)));
                }
                Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => continue,
                Err(tokio::sync::broadcast::error::RecvError::Closed) => return None,
            }
        }
    })
}

async fn has_live_session(state: &AppState, key: &str) -> bool {
    let reg = state.chat_sessions.lock().await;
    if let Some(s) = reg.get(key) {
        return s.is_alive();
    }
    false
}

async fn remove_live_session(state: &AppState, key: &str) {
    let mut reg = state.chat_sessions.lock().await;
    reg.remove(key);
}

pub(crate) async fn reset_agent_session(
    State(state): State<AppState>,
    AuthJwt(_jwt): AuthJwt,
    Path(agent_id): Path<AgentId>,
) -> ApiResult<StatusCode> {
    let session_key = format!("agent:{agent_id}");
    remove_live_session(&state, &session_key).await;
    let sa_key = format!("super_agent:{agent_id}");
    remove_live_session(&state, &sa_key).await;
    {
        let mut cache = state.super_agent_messages.lock().await;
        cache.remove(&sa_key);
    }
    info!(%agent_id, "Agent chat session reset");
    Ok(StatusCode::NO_CONTENT)
}

pub(crate) async fn reset_instance_session(
    State(state): State<AppState>,
    AuthJwt(_jwt): AuthJwt,
    Path((_project_id, agent_instance_id)): Path<(ProjectId, AgentInstanceId)>,
) -> ApiResult<StatusCode> {
    let session_key = format!("instance:{agent_instance_id}");
    remove_live_session(&state, &session_key).await;
    info!(%agent_instance_id, "Instance chat session reset");
    Ok(StatusCode::NO_CONTENT)
}

pub fn session_events_to_conversation_history(events: &[SessionEvent]) -> Vec<ConversationMessage> {
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

/// Reconstruct conversation history in Claude API format from stored
/// `SessionEvent`s. Unlike `session_events_to_conversation_history` (which
/// only keeps text), this preserves tool_use / tool_result content blocks so
/// the super agent can resume multi-turn tool conversations after a cold start.
fn session_events_to_super_agent_history(events: &[SessionEvent]) -> Vec<serde_json::Value> {
    let mut messages: Vec<serde_json::Value> = Vec::new();
    let mut pending_tool_results: Vec<serde_json::Value> = Vec::new();

    for evt in events {
        match evt.role {
            ChatRole::User => {
                if !pending_tool_results.is_empty() {
                    messages.push(serde_json::json!({
                        "role": "user",
                        "content": pending_tool_results,
                    }));
                    pending_tool_results = Vec::new();
                }
                if let Some(ref blocks) = evt.content_blocks {
                    let api_blocks: Vec<serde_json::Value> = blocks
                        .iter()
                        .filter_map(|b| match b {
                            ChatContentBlock::Text { text } => {
                                Some(serde_json::json!({ "type": "text", "text": text }))
                            }
                            ChatContentBlock::Image { media_type, data } => {
                                Some(serde_json::json!({
                                    "type": "image",
                                    "source": {
                                        "type": "base64",
                                        "media_type": media_type,
                                        "data": data,
                                    }
                                }))
                            }
                            _ => None,
                        })
                        .collect();
                    if !api_blocks.is_empty() {
                        messages.push(serde_json::json!({
                            "role": "user",
                            "content": api_blocks,
                        }));
                    }
                } else if !evt.content.is_empty() {
                    messages.push(serde_json::json!({
                        "role": "user",
                        "content": evt.content,
                    }));
                }
            }
            ChatRole::Assistant => {
                if let Some(ref blocks) = evt.content_blocks {
                    let mut api_blocks: Vec<serde_json::Value> = Vec::new();
                    for block in blocks {
                        match block {
                            ChatContentBlock::Text { text } => {
                                api_blocks.push(serde_json::json!({
                                    "type": "text",
                                    "text": text,
                                }));
                            }
                            ChatContentBlock::ToolUse { id, name, input } => {
                                api_blocks.push(serde_json::json!({
                                    "type": "tool_use",
                                    "id": id,
                                    "name": name,
                                    "input": input,
                                }));
                            }
                            ChatContentBlock::ToolResult {
                                tool_use_id,
                                content,
                                is_error,
                            } => {
                                pending_tool_results.push(serde_json::json!({
                                    "type": "tool_result",
                                    "tool_use_id": tool_use_id,
                                    "content": content,
                                    "is_error": is_error.unwrap_or(false),
                                }));
                            }
                            _ => {}
                        }
                    }
                    if !api_blocks.is_empty() {
                        messages.push(serde_json::json!({
                            "role": "assistant",
                            "content": api_blocks,
                        }));
                    }
                } else if !evt.content.is_empty() {
                    messages.push(serde_json::json!({
                        "role": "assistant",
                        "content": evt.content,
                    }));
                }
            }
            _ => {}
        }
    }

    if !pending_tool_results.is_empty() {
        messages.push(serde_json::json!({
            "role": "user",
            "content": pending_tool_results,
        }));
    }

    messages
}

async fn find_matching_project_agents(
    state: &AppState,
    storage: &aura_os_storage::StorageClient,
    jwt: &str,
    agent_id_str: &str,
) -> Vec<aura_os_storage::StorageProjectAgent> {
    let all_projects = match projects::list_all_projects_from_network(state, jwt).await {
        Ok(p) => {
            info!(count = p.len(), %agent_id_str, "agent matching: projects discovered from network");
            p
        }
        Err(_) => match state.project_service.list_projects() {
            Ok(local) if !local.is_empty() => {
                info!(count = local.len(), %agent_id_str, "agent matching: using local project cache (network unavailable)");
                local
            }
            _ => {
                warn!(%agent_id_str, "agent matching: network unavailable and no local projects");
                return Vec::new();
            }
        },
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

    let matched: Vec<_> = results
        .into_iter()
        .zip(pids.iter())
        .flat_map(|(result, pid)| match result {
            Ok(agents) => {
                let total = agents.len();
                let filtered: Vec<_> = agents
                    .into_iter()
                    .filter(|a| a.agent_id.as_deref() == Some(agent_id_str))
                    .map(|mut a| {
                        if a.project_id.as_ref().map_or(true, |p| p.is_empty()) {
                            a.project_id = Some(pid.clone());
                        }
                        a
                    })
                    .collect();
                if total > 0 || !filtered.is_empty() {
                    info!(
                        project_id = %pid, total_agents = total, matched = filtered.len(),
                        %agent_id_str, "agent matching: project agents listed"
                    );
                }
                filtered
            }
            Err(e) => {
                warn!(project_id = %pid, error = %e, "agent matching: failed to list project agents");
                Vec::new()
            }
        })
        .collect();

    info!(matched = matched.len(), %agent_id_str, "agent matching: total project agents matched");
    matched
}

async fn collect_session_events(
    storage: &aura_os_storage::StorageClient,
    jwt: &str,
    sessions: &[aura_os_storage::StorageSession],
) -> EventCollectOutcome {
    const PAGE_SIZE: u32 = 500;

    let mut messages = Vec::new();
    let mut failed_sessions = 0usize;
    let mut first_error: Option<aura_os_storage::StorageError> = None;

    for session in sessions {
        let mut all_events: Vec<aura_os_storage::StorageSessionEvent> = Vec::new();
        let mut offset: u32 = 0;
        let mut failed = false;

        loop {
            match storage
                .list_events(&session.id, jwt, Some(PAGE_SIZE), Some(offset))
                .await
            {
                Ok(page) => {
                    let page_len = page.len() as u32;
                    all_events.extend(page);
                    if page_len < PAGE_SIZE {
                        break;
                    }
                    offset += page_len;
                }
                Err(e) => {
                    if all_events.is_empty() {
                        failed = true;
                        failed_sessions += 1;
                        warn!(session_id = %session.id, error = %e, "Failed to list session events");
                        if first_error.is_none() {
                            first_error = Some(e);
                        }
                    } else {
                        warn!(session_id = %session.id, %offset, error = %e, "Pagination error listing session events, using partial results");
                    }
                    break;
                }
            }
        }

        if !failed {
            let pai = session.project_agent_id.as_deref().unwrap_or_default();
            let pid = session.project_id.as_deref().unwrap_or_default();
            messages.extend(events_to_session_history(&all_events, pai, pid));
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

#[derive(Debug, Clone, Copy, Deserialize, Default)]
pub(crate) struct AgentEventsQuery {
    pub limit: Option<usize>,
    #[serde(default)]
    pub offset: usize,
}

#[derive(Debug, Clone, Deserialize, Default)]
pub(crate) struct PaginatedEventsQuery {
    pub limit: Option<usize>,
    pub before: Option<String>,
    pub after: Option<String>,
}

#[derive(Debug, Serialize)]
pub(crate) struct PaginatedEventsResponse {
    pub events: Vec<SessionEvent>,
    pub has_more: bool,
    pub next_cursor: Option<String>,
}

fn normalize_agent_history_limit(limit: Option<usize>) -> Option<usize> {
    limit.map(|value| value.min(MAX_AGENT_HISTORY_WINDOW_LIMIT))
}

fn slice_recent_agent_events(
    messages: Vec<SessionEvent>,
    limit: Option<usize>,
    offset: usize,
) -> Vec<SessionEvent> {
    let Some(limit) = normalize_agent_history_limit(limit) else {
        return messages;
    };
    if limit == 0 {
        return Vec::new();
    }

    let total = messages.len();
    if offset >= total {
        return Vec::new();
    }

    let end = total.saturating_sub(offset);
    let start = end.saturating_sub(limit);
    messages[start..end].to_vec()
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
    jwt: &str,
) -> Result<Vec<SessionEvent>, aura_os_storage::StorageError> {
    let Some(ref storage) = state.storage_client else {
        warn!(%agent_id, "aggregate events: no storage client available");
        return Ok(Vec::new());
    };
    let agent_id_str = agent_id.to_string();
    let matching = find_matching_project_agents(state, storage, jwt, &agent_id_str).await;
    if matching.is_empty() {
        info!(
            %agent_id,
            "aggregate events: no matching project agents found — returning empty history"
        );
        return Ok(Vec::new());
    }
    let sessions_outcome = fetch_all_sessions(storage, &jwt, &matching).await;
    info!(
        %agent_id,
        matched_agents = matching.len(),
        sessions = sessions_outcome.sessions.len(),
        failed_agents = sessions_outcome.failed_agents,
        "aggregate events: sessions fetched"
    );

    if sessions_outcome.all_failed() {
        if let Some(err) = sessions_outcome.first_error {
            return Err(err);
        }
    }

    let mut message_outcome =
        collect_session_events(storage, &jwt, &sessions_outcome.sessions).await;
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
    jwt: &str,
) -> Result<Vec<SessionEvent>, aura_os_storage::StorageError> {
    let Some(ref storage) = state.storage_client else {
        return Ok(Vec::new());
    };
    let sessions = storage
        .list_sessions(&agent_instance_id.to_string(), &jwt)
        .await?;
    let mut outcome = collect_session_events(storage, &jwt, &sessions).await;
    if outcome.all_failed() {
        if let Some(err) = outcome.first_error {
            return Err(err);
        }
    }
    outcome
        .messages
        .sort_by(|a, b| a.created_at.cmp(&b.created_at));
    Ok(outcome.messages)
}

/// Aggregate agent-level messages from aura-storage (all project-agents for
/// this agent_id -> sessions -> messages).
pub(crate) async fn aggregate_agent_events_from_storage(
    state: &AppState,
    agent_id: &AgentId,
    jwt: &str,
) -> Vec<SessionEvent> {
    match aggregate_agent_events_from_storage_result(state, agent_id, jwt).await {
        Ok(messages) => messages,
        Err(e) => {
            warn!(error = %e, %agent_id, "failed to aggregate agent messages from storage");
            Vec::new()
        }
    }
}

pub(crate) async fn list_agent_events(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    Path(agent_id): Path<AgentId>,
    Query(query): Query<AgentEventsQuery>,
) -> ApiResult<Json<Vec<SessionEvent>>> {
    let _ = state.require_storage_client()?;
    let messages = aggregate_agent_events_from_storage_result(&state, &agent_id, &jwt)
        .await
        .map_err(map_storage_error)?;
    Ok(Json(slice_recent_agent_events(
        messages,
        query.limit,
        query.offset,
    )))
}

fn apply_cursor_filter(
    messages: Vec<SessionEvent>,
    before: Option<&str>,
    after: Option<&str>,
) -> Vec<SessionEvent> {
    let mut result = messages;

    if let Some(after_id) = after {
        if let Some(pos) = result.iter().position(|m| m.event_id.to_string() == after_id) {
            result = result[pos + 1..].to_vec();
        }
    }

    if let Some(before_id) = before {
        if let Some(pos) = result.iter().position(|m| m.event_id.to_string() == before_id) {
            result = result[..pos].to_vec();
        }
    }

    result
}

pub(crate) async fn list_agent_events_paginated(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    Path(agent_id): Path<AgentId>,
    Query(query): Query<PaginatedEventsQuery>,
) -> ApiResult<Json<PaginatedEventsResponse>> {
    let _ = state.require_storage_client()?;
    let messages = aggregate_agent_events_from_storage_result(&state, &agent_id, &jwt)
        .await
        .map_err(map_storage_error)?;

    let filtered = apply_cursor_filter(messages, query.before.as_deref(), query.after.as_deref());

    let limit = normalize_agent_history_limit(query.limit).unwrap_or(50);

    let has_more = filtered.len() > limit;
    let start = filtered.len().saturating_sub(limit);
    let result = filtered[start..].to_vec();

    let next_cursor = if has_more {
        result.first().map(|m| m.event_id.to_string())
    } else {
        None
    };

    Ok(Json(PaginatedEventsResponse {
        events: result,
        has_more,
        next_cursor,
    }))
}

pub(crate) async fn get_or_create_chat_session(
    state: &AppState,
    key: &str,
    harness_mode: HarnessMode,
    session_config: SessionConfig,
    requested_model: Option<String>,
) -> ApiResult<(
    bool,
    tokio::sync::broadcast::Receiver<aura_os_link::HarnessOutbound>,
    tokio::sync::mpsc::UnboundedSender<HarnessInbound>,
)> {
    {
        let mut reg = state.chat_sessions.lock().await;
        if let Some(session) = reg.get(key) {
            if session.is_alive() {
                let model_changed = match (&session.model, &requested_model) {
                    (Some(current), Some(requested)) => current != requested,
                    (None, Some(_)) => true,
                    _ => false,
                };
                if model_changed {
                    info!(key, "Model changed; closing existing chat session");
                    reg.remove(key);
                } else {
                    let rx = session.events_tx.subscribe();
                    return Ok((false, rx, session.commands_tx.clone()));
                }
            }
        }
    }

    let harness = state.harness_for(harness_mode);
    let session = harness.open_session(session_config).await.map_err(|e| {
        let error_message = e.to_string();
        warn!(
            session_key = key,
            ?harness_mode,
            error = %error_message,
            "Failed to open harness chat session"
        );
        map_harness_session_startup_error(&error_message)
    })?;

    let rx = session.events_tx.subscribe();
    let commands_tx = session.commands_tx.clone();

    {
        let mut reg = state.chat_sessions.lock().await;
        reg.insert(
            key.to_string(),
            ChatSession {
                session_id: session.session_id,
                commands_tx: session.commands_tx,
                events_tx: session.events_tx,
                model: requested_model,
            },
        );
    }

    Ok((true, rx, commands_tx))
}

fn map_harness_session_startup_error(message: &str) -> (StatusCode, Json<ApiError>) {
    let normalized = message.to_ascii_lowercase();

    if normalized.contains("swarm gateway is not configured") {
        return ApiError::service_unavailable(
            "remote agent runtime is not configured (SWARM_BASE_URL)",
        );
    }

    if normalized.contains("did not become ready within")
        || normalized.contains("entered error state")
    {
        return ApiError::service_unavailable(format!(
            "remote agent is still provisioning or unavailable: {message}"
        ));
    }

    if normalized.contains("swarm create agent request failed")
        || normalized.contains("swarm create session request failed")
        || normalized.contains("swarm create agent failed with")
        || normalized.contains("swarm create session failed with")
        || normalized.contains("swarm agent readiness check failed")
        || normalized.contains("swarm websocket")
    {
        return ApiError::bad_gateway(format!("remote agent runtime startup failed: {message}"));
    }

    if normalized.contains("local harness websocket connect failed") {
        return ApiError::service_unavailable(format!("local harness is unavailable: {message}"));
    }

    if normalized.contains("local harness session_init send failed")
        || normalized.contains("harness error during init")
        || normalized.contains("connection closed before session_ready")
    {
        return ApiError::bad_gateway(format!("local harness startup failed: {message}"));
    }

    ApiError::internal(format!("opening harness session: {message}"))
}

fn dto_attachments_to_protocol(
    atts: &Option<Vec<ChatAttachmentDto>>,
) -> Option<Vec<MessageAttachment>> {
    atts.as_ref().and_then(|v| {
        if v.is_empty() {
            None
        } else {
            Some(
                v.iter()
                    .map(|a| MessageAttachment {
                        type_: a.type_.clone(),
                        media_type: a.media_type.clone(),
                        data: a.data.clone(),
                        name: a.name.clone(),
                    })
                    .collect(),
            )
        }
    })
}

async fn open_harness_chat_stream(
    state: &AppState,
    session_key: &str,
    harness_mode: HarnessMode,
    session_config: SessionConfig,
    user_content: String,
    requested_model: Option<String>,
    persist_ctx: Option<ChatPersistCtx>,
    _commands: Option<Vec<String>>,
    attachments: Option<Vec<ChatAttachmentDto>>,
) -> ApiResult<SseResponse> {
    let persist_unavailable = persist_ctx.is_none();

    let (is_new, rx, commands_tx) = get_or_create_chat_session(
        state,
        session_key,
        harness_mode,
        session_config,
        requested_model,
    )
    .await?;

    // Subscribe the persistence receiver *before* sending the user message so
    // we don't miss early harness events in a fast-response scenario.
    let persist_rx = if persist_ctx.is_some() {
        Some(rx.resubscribe())
    } else {
        None
    };

    if let Some(ref ctx) = persist_ctx {
        persist_user_message(ctx, &user_content, &attachments);
    }

    commands_tx
        .send(HarnessInbound::UserMessage(UserMessage {
            content: user_content,
            tool_hints: None,
            attachments: dto_attachments_to_protocol(&attachments),
        }))
        .map_err(|e| ApiError::internal(format!("sending user message: {e}")))?;

    if let (Some(ctx), Some(prx)) = (persist_ctx, persist_rx) {
        spawn_chat_persist_task(prx, ctx);
    }

    let mut prefix: Vec<Result<Event, Infallible>> = Vec::new();
    if is_new {
        let progress_event = Event::default()
            .event("progress")
            .json_data(&serde_json::json!({"type":"progress","stage":"connecting"}))
            .unwrap();
        prefix.push(Ok(progress_event));
    }
    if persist_unavailable {
        let warning_event = Event::default()
            .event("error")
            .json_data(&serde_json::json!({
                "type": "error",
                "message": "Chat history could not be saved — storage is unavailable",
                "recoverable": true,
            }))
            .unwrap();
        prefix.push(Ok(warning_event));
    }

    let broadcast_stream = harness_broadcast_to_sse(rx);

    let stream = FuturesStreamExt::chain(futures_util::stream::iter(prefix), broadcast_stream);
    let boxed: SseStream = Box::pin(stream);

    Ok((
        SSE_NO_BUFFERING_HEADERS,
        Sse::new(boxed).keep_alive(KeepAlive::default()),
    ))
}

/// Resolve the active org for the super agent. Tries network first, then
/// falls back to the org_id stored on local projects.
async fn resolve_org_for_super_agent(state: &AppState, jwt: &str) -> (String, String) {
    if let Some(ref client) = state.network_client {
        if let Ok(orgs) = client.list_orgs(jwt).await {
            if let Some(org) = orgs.first() {
                return (org.name.clone(), org.id.clone());
            }
        }
    }
    // Fallback: derive org from local projects
    if let Ok(projects) = state.project_service.list_projects() {
        if let Some(p) = projects.first() {
            let oid = p.org_id.to_string();
            if oid != aura_os_core::OrgId::nil().to_string() {
                return (String::new(), oid);
            }
        }
    }
    ("Default Org".into(), "default".into())
}

async fn handle_super_agent_stream(
    state: &AppState,
    jwt: &str,
    auth_session: &aura_os_core::ZeroAuthSession,
    agent: &Agent,
    body: SendChatRequest,
) -> ApiResult<SseResponse> {
    let agent_id = agent.agent_id;
    let sas = &state.super_agent_service;
    let user_id = auth_session.user_id.as_str();

    // Resolve org: try network first, then derive from local projects
    let (org_name, org_id) = resolve_org_for_super_agent(state, jwt).await;

    let sa_ctx = Arc::new(sas.build_context(user_id, &org_id, jwt));

    // Always generate a fresh system prompt with current org info
    let system_prompt = aura_os_super_agent::prompt::super_agent_system_prompt(&org_name, &org_id);

    let user_content = body.content;
    let requested_model = body.model;
    let attachments = body.attachments;

    let domains = aura_os_super_agent::tier::classify_intent(&user_content);
    let domain_tools = sas.tool_registry.tools_for_domains(&domains);
    let tool_defs = sas.tool_registry.tool_definitions(&domain_tools);

    let session_key = format!("super_agent:{agent_id}");

    // Load conversation history: prefer in-memory cache (full Claude API
    // format with tool blocks), fall back to storage-based reconstruction
    // for cold starts (e.g. after server restart).
    let conversation_history: Vec<serde_json::Value> = {
        let cache = state.super_agent_messages.lock().await;
        if let Some(cached) = cache.get(&session_key) {
            info!(%agent_id, cached_messages = cached.len(), "super agent: loaded conversation from in-memory cache");
            cached.clone()
        } else {
            drop(cache);
            let stored = aggregate_agent_events_from_storage(state, &agent_id, jwt).await;
            if stored.is_empty() {
                Vec::new()
            } else {
                info!(%agent_id, stored_events = stored.len(), "super agent: reconstructing conversation from storage (cold start)");
                let bounded =
                    slice_recent_agent_events(stored, Some(DEFAULT_AGENT_HISTORY_WINDOW_LIMIT), 0);
                session_events_to_super_agent_history(&bounded)
            }
        }
    };

    let persist_ctx = setup_agent_chat_persistence(state, &agent_id, &agent.name, jwt).await;
    if persist_ctx.is_none() {
        warn!(%agent_id, "super agent chat: persistence context unavailable");
    }

    let (tx, _) = tokio::sync::broadcast::channel::<HarnessOutbound>(256);
    let rx = tx.subscribe();

    let persist_rx = persist_ctx.as_ref().map(|_| tx.subscribe());

    if let Some(ref pctx) = persist_ctx {
        persist_user_message(pctx, &user_content, &attachments);
    }

    let stream_handle = aura_os_super_agent::stream::SuperAgentStream::new(
        sas.router_url.clone(),
        sas.http_client.clone(),
        system_prompt,
        tool_defs,
        conversation_history,
        sa_ctx,
        Arc::new(aura_os_super_agent::tools::ToolRegistry::with_all_tools()),
        tx,
        requested_model,
    );

    let content_for_run = user_content.clone();
    let image_blocks_for_run: Option<Vec<serde_json::Value>> =
        attachments.as_ref().and_then(|atts| {
            let blocks: Vec<serde_json::Value> = atts
                .iter()
                .filter(|a| a.type_ == "image")
                .map(|a| {
                    serde_json::json!({
                        "type": "image",
                        "source": {
                            "type": "base64",
                            "media_type": a.media_type,
                            "data": a.data,
                        }
                    })
                })
                .collect();
            if blocks.is_empty() {
                None
            } else {
                Some(blocks)
            }
        });
    let messages_cache = state.super_agent_messages.clone();
    let cache_key = session_key.clone();
    tokio::spawn(async move {
        let messages = stream_handle
            .run(content_for_run, image_blocks_for_run)
            .await;
        messages_cache.lock().await.insert(cache_key, messages);
    });

    if let (Some(pctx), Some(prx)) = (persist_ctx, persist_rx) {
        spawn_chat_persist_task(prx, pctx);
    }

    let broadcast_stream = harness_broadcast_to_sse(rx);

    let boxed: SseStream = Box::pin(broadcast_stream);
    Ok((
        SSE_NO_BUFFERING_HEADERS,
        Sse::new(boxed).keep_alive(KeepAlive::default()),
    ))
}

pub(crate) async fn send_agent_event_stream(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    crate::state::AuthSession(auth_session): crate::state::AuthSession,
    Path(agent_id): Path<AgentId>,
    Json(body): Json<SendChatRequest>,
) -> ApiResult<SseResponse> {
    let agent = match state.agent_service.get_agent_async("", &agent_id).await {
        Ok(a) => a,
        Err(_) => state
            .agent_service
            .get_agent_local(&agent_id)
            .map_err(|e| ApiError::not_found(format!("agent not found: {e}")))?,
    };
    require_credits_for_auth_source(&state, &jwt, &agent.auth_source).await?;
    info!(%agent_id, action = ?body.action, "Agent message stream requested");

    if agent.role == "super_agent" || agent.tags.contains(&"super_agent".to_string()) {
        info!(%agent_id, "SuperAgent detected — routing to SuperAgent handler");
        return handle_super_agent_stream(&state, &jwt, &auth_session, &agent, body).await;
    }

    if agent.adapter_type != "aura_harness" {
        info!(%agent_id, adapter = %agent.adapter_type, "Routing direct agent chat through external runtime");
        return send_external_agent_event_stream(&state, &jwt, &agent, body).await;
    }

    let persist_ctx = setup_agent_chat_persistence(&state, &agent_id, &agent.name, &jwt).await;
    if persist_ctx.is_none() {
        error!(%agent_id, "agent chat: persistence context unavailable — chat will NOT be saved");
    } else {
        info!(%agent_id, "agent chat: persistence context ready");
    }

    let session_key = format!("agent:{agent_id}");
    let force_new = body.new_session.unwrap_or(false);
    if force_new {
        remove_live_session(&state, &session_key).await;
        let sa_key = format!("super_agent:{agent_id}");
        remove_live_session(&state, &sa_key).await;
        {
            let mut cache = state.super_agent_messages.lock().await;
            cache.remove(&sa_key);
        }
    }
    let conversation_messages = if force_new {
        None
    } else if !has_live_session(&state, &session_key).await {
        let stored = aggregate_agent_events_from_storage(&state, &agent_id, &jwt).await;
        if stored.is_empty() {
            None
        } else {
            let bounded =
                slice_recent_agent_events(stored, Some(DEFAULT_AGENT_HISTORY_WINDOW_LIMIT), 0);
            Some(session_events_to_conversation_history(&bounded))
        }
    } else {
        None
    };

    let integration = resolve_integration(&state, &agent, &jwt).await?;
    let model = effective_model(&agent, integration.as_ref(), body.model.clone());
    let installed_tools = if let Some(org_id) = agent.org_id.as_ref() {
        let tools = installed_workspace_app_tools(&state, org_id, &jwt).await;
        (!tools.is_empty()).then_some(tools)
    } else {
        None
    };
    let installed_integrations = if let Some(org_id) = agent.org_id.as_ref() {
        let integrations =
            installed_workspace_integrations_for_org_with_token(&state, org_id, &jwt).await;
        (!integrations.is_empty()).then_some(integrations)
    } else {
        None
    };
    let config = SessionConfig {
        system_prompt: Some(agent.system_prompt.clone()),
        agent_id: Some(agent_id.to_string()),
        agent_name: Some(agent.name.clone()),
        model: model.clone(),
        token: Some(jwt.clone()),
        conversation_messages,
        project_id: body.project_id.clone(),
        provider_config: build_harness_provider_config(integration.as_ref(), model.as_deref())?,
        installed_tools,
        installed_integrations,
        ..Default::default()
    };

    open_harness_chat_stream(
        &state,
        &session_key,
        agent.harness_mode(),
        config,
        body.content,
        body.model,
        persist_ctx,
        body.commands,
        body.attachments,
    )
    .await
}

pub(crate) async fn list_events(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    Path((_project_id, agent_instance_id)): Path<(ProjectId, AgentInstanceId)>,
) -> ApiResult<Json<Vec<SessionEvent>>> {
    let storage = state.require_storage_client()?;

    let sessions = storage
        .list_sessions(&agent_instance_id.to_string(), &jwt)
        .await
        .map_err(map_storage_error)?;

    let mut outcome = collect_session_events(&storage, &jwt, &sessions).await;
    if outcome.all_failed() {
        if let Some(err) = outcome.first_error {
            return Err(map_storage_error(err));
        }
    }
    outcome
        .messages
        .sort_by(|a, b| a.created_at.cmp(&b.created_at));
    Ok(Json(outcome.messages))
}

pub(crate) async fn send_event_stream(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    Path((project_id, agent_instance_id)): Path<(ProjectId, AgentInstanceId)>,
    Json(body): Json<SendChatRequest>,
) -> ApiResult<SseResponse> {
    let instance = state
        .agent_instance_service
        .get_instance(&project_id, &agent_instance_id)
        .await
        .map_err(|e| ApiError::internal(format!("looking up agent instance: {e}")))?;
    require_credits_for_auth_source(&state, &jwt, &instance.auth_source).await?;
    info!(%project_id, %agent_instance_id, action = ?body.action, "Message stream requested");

    let persist_ctx =
        setup_project_chat_persistence(&state, &project_id, &agent_instance_id, &jwt).await;

    let session_key = format!("instance:{agent_instance_id}");
    let force_new = body.new_session.unwrap_or(false);
    if force_new {
        remove_live_session(&state, &session_key).await;
    }
    let conversation_messages = if force_new {
        None
    } else if !has_live_session(&state, &session_key).await {
        let stored = load_project_session_history(&state, &agent_instance_id, &jwt)
            .await
            .map_err(map_storage_error)?;
        if stored.is_empty() {
            None
        } else {
            Some(session_events_to_conversation_history(&stored))
        }
    } else {
        None
    };

    let pid_str = project_id.to_string();

    let project_path =
        resolve_agent_instance_workspace_path(&state, &project_id, Some(agent_instance_id)).await;
    let system_prompt = build_project_system_prompt(
        &state,
        &project_id,
        &instance.system_prompt,
        project_path.as_deref(),
    );

    let integration = resolve_integration_ref(
        &state,
        instance.org_id,
        &instance.auth_source,
        instance.integration_id.as_deref(),
        &jwt,
    )
    .await?;
    let model = body
        .model
        .clone()
        .filter(|value| !value.trim().is_empty())
        .or_else(|| {
            instance
                .default_model
                .clone()
                .filter(|value| !value.trim().is_empty())
        })
        .or_else(|| {
            integration
                .as_ref()
                .and_then(|resolved| resolved.metadata.default_model.clone())
                .filter(|value| !value.trim().is_empty())
        });
    let installed_tools = if let Some(org_id) = instance.org_id.as_ref() {
        let tools = installed_workspace_app_tools(&state, org_id, &jwt).await;
        (!tools.is_empty()).then_some(tools)
    } else {
        None
    };
    let installed_integrations = if let Some(org_id) = instance.org_id.as_ref() {
        let integrations =
            installed_workspace_integrations_for_org_with_token(&state, org_id, &jwt).await;
        (!integrations.is_empty()).then_some(integrations)
    } else {
        None
    };
    let config = SessionConfig {
        system_prompt: Some(system_prompt),
        agent_id: Some(instance.agent_id.to_string()),
        agent_name: Some(instance.name.clone()),
        model: model.clone(),
        token: Some(jwt),
        conversation_messages,
        project_id: Some(pid_str),
        project_path,
        provider_config: build_harness_provider_config(integration.as_ref(), model.as_deref())?,
        installed_tools,
        installed_integrations,
        ..Default::default()
    };

    open_harness_chat_stream(
        &state,
        &session_key,
        instance.harness_mode(),
        config,
        body.content,
        body.model,
        persist_ctx,
        body.commands,
        body.attachments,
    )
    .await
}

fn build_project_system_prompt(
    state: &AppState,
    project_id: &ProjectId,
    agent_prompt: &str,
    workspace_path: Option<&str>,
) -> String {
    let project_ctx = match state.project_service.get_project(project_id) {
        Ok(p) => {
            let desc: &str = &p.description;
            let mut ctx = format!(
                "<project_context>\nproject_id: {}\nproject_name: {}\n",
                project_id, p.name,
            );
            if !desc.is_empty() {
                ctx.push_str(&format!("description: {}\n", desc));
            }
            if let Some(workspace_path) = workspace_path.filter(|path| !path.is_empty()) {
                ctx.push_str(&format!("workspace: {}\n", workspace_path));
            }
            ctx.push_str("</project_context>\n\n");
            ctx.push_str("IMPORTANT: When calling tools that accept a project_id parameter, always use the project_id from the project_context above.\n\n");
            ctx.push_str(
                "IMPORTANT: For filesystem and command tools, treat the project root as `.` and always use paths relative to that root. \
                 Never pass `/` or any other absolute host path to list_files, find_files, read_file, write_file, or run_command.\n\n",
            );
            ctx
        }
        Err(_) => {
            format!(
                "<project_context>\nproject_id: {}\n</project_context>\n\n\
                 IMPORTANT: When calling tools that accept a project_id parameter, always use the project_id above.\n\n\
                 IMPORTANT: For filesystem and command tools, treat the project root as `.` and always use relative paths. Never pass `/` or any other absolute host path.\n\n",
                project_id,
            )
        }
    };
    format!("{}{}", project_ctx, agent_prompt)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maps_swarm_configuration_errors_to_service_unavailable() {
        let (status, body) =
            map_harness_session_startup_error("swarm gateway is not configured (SWARM_BASE_URL)");

        assert_eq!(status, StatusCode::SERVICE_UNAVAILABLE);
        assert_eq!(body.0.code, "service_unavailable");
    }

    #[test]
    fn maps_swarm_readiness_errors_to_service_unavailable() {
        let (status, body) = map_harness_session_startup_error(
            "swarm agent readiness check failed: agent abc did not become ready within 90s",
        );

        assert_eq!(status, StatusCode::SERVICE_UNAVAILABLE);
        assert_eq!(body.0.code, "service_unavailable");
        assert!(body.0.error.contains("still provisioning"));
    }

    #[test]
    fn maps_swarm_session_start_errors_to_bad_gateway() {
        let (status, body) = map_harness_session_startup_error(
            "swarm create session failed with 502 Bad Gateway: upstream unavailable",
        );

        assert_eq!(status, StatusCode::BAD_GATEWAY);
        assert_eq!(body.0.code, "bad_gateway");
    }

    #[test]
    fn maps_local_harness_connect_errors_to_service_unavailable() {
        let (status, body) =
            map_harness_session_startup_error("local harness websocket connect failed");

        assert_eq!(status, StatusCode::SERVICE_UNAVAILABLE);
        assert_eq!(body.0.code, "service_unavailable");
    }
}
