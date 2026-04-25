use std::convert::Infallible;
use std::pin::Pin;
use std::sync::Arc;
use std::time::Instant;

use axum::extract::{Path, Query, State};
use axum::http::{HeaderMap, HeaderName, HeaderValue, StatusCode};
use axum::response::sse::{Event, KeepAlive, Sse};
use axum::Json;
use chrono::{DateTime, Utc};
use futures_util::future::join_all;
use futures_util::stream;
use futures_util::StreamExt as FuturesStreamExt;
use serde::{Deserialize, Serialize};
use tracing::{error, info, warn};

pub(crate) type SseStream =
    Pin<Box<dyn futures_core::Stream<Item = Result<Event, Infallible>> + Send>>;
pub(crate) type SseResponse = (HeaderMap, Sse<SseStream>);

/// Header names used to surface persistence info alongside the SSE
/// response so fire-and-forget callers (e.g. the CEO's `send_to_agent`
/// tool, which only reads the response head) can tell whether the
/// message will actually be saved and viewable in the target agent's
/// chat history — without having to drain the stream.
pub(crate) const HEADER_CHAT_PERSISTED: &str = "x-aura-chat-persisted";
pub(crate) const HEADER_CHAT_SESSION_ID: &str = "x-aura-chat-session-id";
pub(crate) const HEADER_CHAT_PROJECT_ID: &str = "x-aura-chat-project-id";

fn sse_response_headers(persist_snapshot: Option<&(String, String)>) -> HeaderMap {
    let mut headers = HeaderMap::new();
    headers.insert("X-Accel-Buffering", HeaderValue::from_static("no"));
    let persisted = persist_snapshot.is_some();
    headers.insert(
        HeaderName::from_static(HEADER_CHAT_PERSISTED),
        HeaderValue::from_static(if persisted { "true" } else { "false" }),
    );
    if let Some((session_id, project_id)) = persist_snapshot {
        if let Ok(v) = HeaderValue::from_str(session_id) {
            headers.insert(HeaderName::from_static(HEADER_CHAT_SESSION_ID), v);
        }
        if let Ok(v) = HeaderValue::from_str(project_id) {
            headers.insert(HeaderName::from_static(HEADER_CHAT_PROJECT_ID), v);
        }
    }
    headers
}

const DEFAULT_AGENT_HISTORY_WINDOW_LIMIT: usize = 80;
const MAX_AGENT_HISTORY_WINDOW_LIMIT: usize = 400;

/// Maximum bytes of a single `tool_use` input / `tool_result` content
/// blob we embed into the flat-text conversation history replayed to
/// the harness on a cold start. Anything beyond this is replaced with
/// a "... [truncated N bytes]" marker.
///
/// Tool payloads like the old `list_agents` response used to land here
/// in the tens-of-kilobytes range because the full `NetworkAgent`
/// record carries multi-KB `system_prompt` / `personality` fields per
/// agent. Even after slimming those tools, a buggy or verbose tool
/// could still blow the context — this cap is the defense in depth.
const TOOL_BLOB_MAX_BYTES: usize = 2048;

/// Tighter cap used for tool blobs in turns *outside* the recent
/// window; older tool traffic only needs to leave a breadcrumb of
/// "this happened".
const TOOL_BLOB_OLD_MAX_BYTES: usize = 256;

/// How many of the most recent turns keep the full
/// `TOOL_BLOB_MAX_BYTES` budget when replaying history. Turns beyond
/// this fall back to `TOOL_BLOB_OLD_MAX_BYTES`.
const HISTORY_RECENT_TURNS: usize = 2;

/// Log-level threshold on the total size of the flat-text
/// `conversation_messages` array shipped to the harness in
/// `SessionConfig`. Anything above this triggers a `warn!` so future
/// context bloat regressions surface without needing user bug reports.
const CONVERSATION_HISTORY_WARN_BYTES: usize = 64 * 1024;

/// Truncate a string to at most `max_bytes` bytes on a UTF-8 char
/// boundary and append a marker noting the original length. A no-op
/// when `s.len() <= max_bytes`.
fn truncate_for_history(s: &str, max_bytes: usize) -> String {
    if s.len() <= max_bytes {
        return s.to_string();
    }
    let mut end = max_bytes;
    while end > 0 && !s.is_char_boundary(end) {
        end -= 1;
    }
    format!("{}... [truncated {} bytes]", &s[..end], s.len())
}

use aura_os_core::{
    AgentId, AgentInstanceId, AgentPermissions, ChatContentBlock, ChatRole, HarnessMode, OrgId,
    ProjectId, SessionEvent, Spec, Task,
};
use aura_os_harness::{
    ConversationMessage, HarnessInbound, HarnessOutbound, InstalledTool, MessageAttachment,
    SessionConfig,
};
use aura_os_harness::{SessionBridge, SessionBridgeError, SessionBridgeStarted, SessionBridgeTurn};
use aura_os_storage::StorageClient;

use crate::dto::{ChatAttachmentDto, SendChatRequest};
use crate::error::{map_storage_error, ApiError, ApiResult};
use crate::handlers::agents::tool_dedupe::dedupe_and_log_installed_tools;
use crate::handlers::agents::workspace_tools::installed_workspace_app_tools;
use crate::handlers::billing::require_credits_for_auth_source;
use crate::handlers::{projects, projects_helpers::resolve_agent_instance_workspace_path};
use crate::state::{AppState, AuthJwt, CachedAgentDiscovery, ChatSession, AGENT_DISCOVERY_TTL};

use super::conversions::events_to_session_history;
use super::runtime::{
    build_harness_provider_config, effective_model, resolve_integration, resolve_integration_ref,
};
use crate::capture_auth::{
    demo_agent_events, demo_agent_id, demo_agent_instance_id, demo_project_id,
    is_capture_access_token,
};

// ---------------------------------------------------------------------------
// Session installed_tools assembly
// ---------------------------------------------------------------------------

/// Build the `installed_tools` payload for a harness chat session.
///
/// Phase 3 removes the legacy cross-agent dispatcher. Domain
/// operations now remain reachable to the harness through its own
/// delegated domain API, so the server only contributes workspace and
/// integration tools here.
#[allow(dead_code)]
#[allow(clippy::too_many_arguments)]
async fn build_session_installed_tools(
    state: &AppState,
    org_id: Option<&OrgId>,
    permissions: &AgentPermissions,
    jwt: &str,
    context: &'static str,
    agent_id: &str,
    machine_type: &str,
    user_message: Option<&str>,
    project_id: Option<&str>,
) -> ApiResult<Option<Vec<InstalledTool>>> {
    build_session_installed_tools_with_integrations(
        state,
        org_id,
        permissions,
        jwt,
        context,
        agent_id,
        machine_type,
        user_message,
        None,
        project_id,
    )
    .await
}

#[allow(clippy::too_many_arguments)]
async fn build_session_installed_tools_with_integrations(
    state: &AppState,
    org_id: Option<&OrgId>,
    _permissions: &AgentPermissions,
    jwt: &str,
    context: &'static str,
    agent_id: &str,
    machine_type: &str,
    _user_message: Option<&str>,
    integrations: Option<&[aura_os_core::OrgIntegration]>,
    _project_id: Option<&str>,
) -> ApiResult<Option<Vec<InstalledTool>>> {
    let mut tools = if let Some(org_id) = org_id {
        match integrations {
            Some(ints) => {
                crate::handlers::agents::workspace_tools::installed_workspace_app_tools_with_integrations(
                    state, org_id, jwt, ints,
                )
                .await
            }
            None => installed_workspace_app_tools(state, org_id, jwt).await,
        }
    } else {
        Vec::new()
    };
    let _ = (jwt, machine_type);

    dedupe_and_log_installed_tools(context, agent_id, &mut tools);

    Ok((!tools.is_empty()).then_some(tools))
}

// ---------------------------------------------------------------------------
// Chat persistence helpers
// ---------------------------------------------------------------------------

#[derive(Clone)]
pub(crate) struct ChatPersistCtx {
    pub(crate) storage: Arc<StorageClient>,
    pub(crate) jwt: String,
    pub(crate) session_id: String,
    pub(crate) project_agent_id: String,
    pub(crate) project_id: String,
    /// Org-level agent id (the `agents.agent_id` from aura-network)
    /// this persistence context belongs to. Distinct from
    /// `project_agent_id` (the project binding). We broadcast it in
    /// `user_message` / `assistant_message_end` so the UI can key
    /// standalone-chat history entries by the same id the sidebar
    /// uses (`agentHistoryKey(agent_id)`); without it cross-agent
    /// `send_to_agent` deliveries only refresh the sender's view and
    /// the recipient's chat window stays stale until the user hits F5.
    pub(crate) agent_id: Option<String>,
}

async fn resolve_chat_session(
    storage: &StorageClient,
    jwt: &str,
    project_agent_id: &str,
    project_id: &str,
    force_new: bool,
) -> Option<String> {
    if !force_new {
        match storage.list_sessions(project_agent_id, jwt).await {
            Ok(sessions) => {
                // Sort by the same recency key the reader uses so a writer
                // never lands in a different session than
                // `load_project_session_history` will later read from.
                // Storage may return sessions in any order (insertion,
                // alphanumeric id, etc.); we want newest-by-timestamp first.
                //
                // Previously we also walked the sorted list and issued a
                // `list_events(limit=1)` probe on each candidate to skip
                // "stale" sessions. That added one round-trip per session
                // on the hot path — for users with long chat histories
                // this was the single slowest setup step. Trust the sort
                // key instead: if the newest session by timestamp is
                // structurally unreadable the very next persist will
                // surface the error, and the UI loader applies the same
                // sort key so writer/reader can't diverge.
                if let Some(newest) = sessions.iter().max_by_key(|s| storage_session_sort_key(s)) {
                    return Some(newest.id.clone());
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
    }
    close_active_sessions_for_agent(storage, jwt, project_agent_id).await;
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

/// Flip any lingering `active` sessions for this agent instance to
/// `completed` so the sidekick does not render historical sessions as
/// spinning/in-progress. Failures are logged and swallowed: retiring old
/// sessions is best-effort and must never block creation of a new one.
async fn close_active_sessions_for_agent(
    storage: &StorageClient,
    jwt: &str,
    project_agent_id: &str,
) {
    let sessions = match storage.list_sessions(project_agent_id, jwt).await {
        Ok(list) => list,
        Err(e) => {
            warn!(
                %project_agent_id,
                error = %e,
                "Failed to list sessions while retiring stale active sessions"
            );
            return;
        }
    };

    let now = Utc::now().to_rfc3339();
    for session in sessions {
        if session.status.as_deref() != Some("active") {
            continue;
        }
        let req = aura_os_storage::UpdateSessionRequest {
            status: Some("completed".to_string()),
            total_input_tokens: None,
            total_output_tokens: None,
            context_usage_estimate: None,
            summary_of_previous_context: None,
            tasks_worked_count: None,
            ended_at: Some(now.clone()),
        };
        if let Err(e) = storage.update_session(&session.id, jwt, &req).await {
            warn!(session_id = %session.id, error = %e, "Failed to retire stale active session");
        }
    }
}

/// Persist the inbound user message to storage and return the created
/// event on success.
///
/// Previously this fire-and-forget spawned a background task that only
/// logged failures, which let the CEO's `send_to_agent` tool report
/// `persisted: true` for writes that silently vanished from the target
/// agent's chat history. Callers are now required to `.await` this
/// function and hard-fail the request on `Err` — no silent success.
pub(crate) async fn persist_user_message(
    ctx: &ChatPersistCtx,
    content: &str,
    attachments: &Option<Vec<ChatAttachmentDto>>,
) -> Result<aura_os_storage::StorageSessionEvent, aura_os_storage::StorageError> {
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
    match ctx
        .storage
        .create_event(&ctx.session_id, &ctx.jwt, &req)
        .await
    {
        Ok(evt) => Ok(evt),
        Err(e) => {
            let (upstream_status, body_preview) = match &e {
                aura_os_storage::StorageError::Server { status, body } => {
                    (Some(*status), body.chars().take(400).collect::<String>())
                }
                _ => (None, String::new()),
            };
            error!(
                error = %e,
                upstream_status = ?upstream_status,
                body_preview = %body_preview,
                session_id = %ctx.session_id,
                project_agent_id = %ctx.project_agent_id,
                project_id = %ctx.project_id,
                "Failed to persist user message event"
            );
            Err(e)
        }
    }
}

/// Publish a `user_message` event on the app-wide WebSocket event bus.
/// The UI's `useChatHistorySync` hook subscribes to this and force-refetches
/// the target agent's chat history so cross-agent writes (from the CEO's
/// `send_to_agent` tool, say) surface live in the target's panel without
/// needing a manual reload.
pub(crate) fn publish_user_message_event(
    bus: &tokio::sync::broadcast::Sender<serde_json::Value>,
    ctx: &ChatPersistCtx,
    event_id: &str,
) {
    let _ = bus.send(serde_json::json!({
        "type": "user_message",
        "event_id": event_id,
        "session_id": ctx.session_id,
        "project_id": ctx.project_id,
        "project_agent_id": ctx.project_agent_id,
        // `agent_instance_id` is the field the UI wire parser
        // (`parseAuraEvent` in interface/src/types/aura-events.ts) reads
        // to populate `AuraEventBase.agent_id`, which the hook filters on.
        "agent_instance_id": ctx.project_agent_id,
        // Org-level agent id (`agents.agent_id`), used by the UI
        // standalone-chat invalidator to force-refresh
        // `agentHistoryKey(agent_id)` when someone else writes into
        // this agent's session (e.g. the CEO via `send_to_agent`).
        // `Null` for project-scoped chat sessions.
        "agent_id": ctx.agent_id,
    }));
}

/// Publish an `assistant_message_end` event on the app-wide WebSocket
/// event bus after a successful persist. Same consumer story as
/// `publish_user_message_event`.
fn publish_assistant_message_end_event(
    bus: &tokio::sync::broadcast::Sender<serde_json::Value>,
    ctx: &ChatPersistCtx,
    message_id: &str,
) {
    let _ = bus.send(serde_json::json!({
        "type": "assistant_message_end",
        "message_id": message_id,
        "session_id": ctx.session_id,
        "project_id": ctx.project_id,
        "project_agent_id": ctx.project_agent_id,
        "agent_instance_id": ctx.project_agent_id,
        "agent_id": ctx.agent_id,
    }));
}

/// Publish a heartbeat-style progress event on the WS bus for an
/// in-flight assistant turn. Carries no payload beyond the routing
/// keys so the chat-history-sync hook on the client can throttle
/// itself into a single force-refetch per emission and pull the
/// latest reconstructed partial turn from `events_to_session_history`
/// — rather than us trying to ship token-level deltas over the bus.
///
/// Throttled to at most ~one publish per
/// `ASSISTANT_TURN_PROGRESS_THROTTLE` (currently 400ms) inside
/// `spawn_chat_persist_task`. Final state is delivered by the
/// existing `assistant_message_end` publish, so a missed progress
/// event just means slightly later refresh; correctness is preserved.
fn publish_assistant_turn_progress_event(
    bus: &tokio::sync::broadcast::Sender<serde_json::Value>,
    ctx: &ChatPersistCtx,
    message_id: &str,
) {
    let _ = bus.send(serde_json::json!({
        "type": "assistant_turn_progress",
        "message_id": message_id,
        "session_id": ctx.session_id,
        "project_id": ctx.project_id,
        "project_agent_id": ctx.project_agent_id,
        "agent_instance_id": ctx.project_agent_id,
        "agent_id": ctx.agent_id,
    }));
}

/// Minimum time between consecutive `assistant_turn_progress`
/// publishes for a single turn. Tuned to balance UI responsiveness
/// after a refresh against history-API request load — on the order
/// of two refetches per second is enough to feel "live".
const ASSISTANT_TURN_PROGRESS_THROTTLE: std::time::Duration = std::time::Duration::from_millis(400);

pub(crate) fn spawn_chat_persist_task(
    rx: tokio::sync::broadcast::Receiver<HarnessOutbound>,
    ctx: ChatPersistCtx,
    event_bus: tokio::sync::broadcast::Sender<serde_json::Value>,
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
        let mut persisted_events: u32 = 0;
        let mut end_persisted = false;
        // Last time we emitted an `assistant_turn_progress` for this
        // turn; gates the throttled WS heartbeat so the client can
        // refetch reconstructed partial turns after a mid-turn refresh
        // without us flooding the bus with one event per token.
        let mut last_progress_at: Option<std::time::Instant> = None;

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
                    event_type: event_type.clone(),
                    content: Some(content),
                };
                match ctx
                    .storage
                    .create_event(&ctx.session_id, &ctx.jwt, &req)
                    .await
                {
                    Ok(_) => true,
                    Err(e) => {
                        error!(
                            error = %e,
                            session_id = %ctx.session_id,
                            project_agent_id = %ctx.project_agent_id,
                            event_type = %event_type,
                            "Failed to persist chat event"
                        );
                        false
                    }
                }
            }
        };

        loop {
            match rx.recv().await {
                Ok(evt) => {
                    seq += 1;
                    // Tracks whether the current event represents user-visible
                    // turn progress (new text, thinking, or tool activity). Set
                    // by each delta arm below so the throttled progress publish
                    // at the end of the loop iteration only fires when there's
                    // something new to refetch.
                    let mut produced_progress = false;
                    match evt {
                        HarnessOutbound::SessionReady(_) => {}
                        HarnessOutbound::AssistantMessageStart(ref start) => {
                            message_id = start.message_id.clone();
                            if persist(
                                "assistant_message_start",
                                serde_json::json!({
                                    "message_id": &start.message_id,
                                    "seq": seq,
                                }),
                            )
                            .await
                            {
                                persisted_events += 1;
                            }
                            // Tell clients that just refreshed mid-turn that
                            // a new turn has begun, so they can flip
                            // `streamingAgentInstanceId` back on even before
                            // any deltas land.
                            produced_progress = true;
                        }
                        HarnessOutbound::TextDelta(ref delta) => {
                            full_text.push_str(&delta.text);
                            text_segment.push_str(&delta.text);
                            if persist(
                                "text_delta",
                                serde_json::json!({
                                    "message_id": &message_id,
                                    "text": &delta.text,
                                    "seq": seq,
                                }),
                            )
                            .await
                            {
                                persisted_events += 1;
                            }
                            produced_progress = true;
                        }
                        HarnessOutbound::ThinkingDelta(ref delta) => {
                            thinking_buf.push_str(&delta.thinking);
                            if persist(
                                "thinking_delta",
                                serde_json::json!({
                                    "message_id": &message_id,
                                    "thinking": &delta.thinking,
                                    "seq": seq,
                                }),
                            )
                            .await
                            {
                                persisted_events += 1;
                            }
                            produced_progress = true;
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
                            if persist(
                                "tool_use_start",
                                serde_json::json!({
                                    "message_id": &message_id,
                                    "id": &tool.id,
                                    "name": &tool.name,
                                    "seq": seq,
                                }),
                            )
                            .await
                            {
                                persisted_events += 1;
                            }
                            produced_progress = true;
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
                            if persist(
                                "tool_call_snapshot",
                                serde_json::json!({
                                    "message_id": &message_id,
                                    "id": &snap.id,
                                    "name": &snap.name,
                                    "input": &snap.input,
                                    "seq": seq,
                                }),
                            )
                            .await
                            {
                                persisted_events += 1;
                            }
                            produced_progress = true;
                        }
                        HarnessOutbound::ToolResult(ref result) => {
                            // Fill in any tool_use block that still has a null
                            // input. Non-streaming tools never emit a snapshot,
                            // so without this recovery the persisted tool_use
                            // block would round-trip with `input: null` and be
                            // rejected by the LLM on replay.
                            if let Some(block) = content_blocks.iter_mut().rev().find(|b| {
                                b.get("type").and_then(|t| t.as_str()) == Some("tool_use")
                                    && b.get("id").and_then(|i| i.as_str())
                                        == Some(&last_tool_use_id)
                            }) {
                                if block.get("input") == Some(&serde_json::Value::Null) {
                                    block["input"] = serde_json::json!({});
                                }
                            }

                            content_blocks.push(serde_json::json!({
                                "type": "tool_result",
                                "tool_use_id": &last_tool_use_id,
                                "content": &result.result,
                                "is_error": result.is_error
                            }));
                            if persist(
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
                            .await
                            {
                                persisted_events += 1;
                            }
                            produced_progress = true;
                        }
                        HarnessOutbound::AssistantMessageEnd(ref end) => {
                            if !text_segment.is_empty() {
                                content_blocks.push(serde_json::json!({
                                    "type": "text", "text": &text_segment
                                }));
                            }
                            if persist("assistant_message_end", serde_json::json!({
                                "message_id": &end.message_id,
                                "text": &full_text,
                                "thinking": if thinking_buf.is_empty() { serde_json::Value::Null } else { serde_json::Value::String(thinking_buf.clone()) },
                                "content_blocks": &content_blocks,
                                "usage": &end.usage,
                                "files_changed": &end.files_changed,
                                "stop_reason": &end.stop_reason,
                                "seq": seq,
                            })).await {
                                persisted_events += 1;
                                end_persisted = true;
                                publish_assistant_message_end_event(
                                    &event_bus,
                                    &ctx,
                                    &end.message_id,
                                );
                            }
                            info!(
                                session_id = %ctx.session_id,
                                persisted_events,
                                content_blocks = content_blocks.len(),
                                stop_reason = %end.stop_reason,
                                "Persisted assistant turn events"
                            );
                            break;
                        }
                        HarnessOutbound::Error(ref err) => {
                            if persist(
                                "error",
                                serde_json::json!({
                                    "message_id": &message_id,
                                    "code": &err.code,
                                    "message": &err.message,
                                    "recoverable": err.recoverable,
                                    "seq": seq,
                                }),
                            )
                            .await
                            {
                                persisted_events += 1;
                            }

                            // If the harness errored before producing any
                            // text, thinking, or tool blocks (e.g. auth,
                            // credits, provider 4xx on first byte), no
                            // `assistant_message_end` will ever arrive. The
                            // broadcast-closed safety net below only fires
                            // when *some* output has accumulated, so the
                            // turn would otherwise round-trip as
                            // "user message with no assistant reply" on
                            // every reopen. Persist a minimal synthesized
                            // end row here so the turn is recoverable.
                            if !end_persisted
                                && full_text.is_empty()
                                && content_blocks.is_empty()
                                && thinking_buf.is_empty()
                            {
                                let err_summary = if err.message.trim().is_empty() {
                                    format!("(agent error: {})", err.code)
                                } else {
                                    format!("(agent error: {})", err.message)
                                };
                                let end_payload = serde_json::json!({
                                    "message_id": if message_id.is_empty() {
                                        serde_json::Value::Null
                                    } else {
                                        serde_json::Value::String(message_id.clone())
                                    },
                                    "text": err_summary,
                                    "thinking": serde_json::Value::Null,
                                    "content_blocks": [],
                                    "usage": serde_json::Value::Null,
                                    "files_changed": {
                                        "created": [],
                                        "modified": [],
                                        "deleted": [],
                                    },
                                    "stop_reason": "error",
                                    "seq": seq + 1,
                                    "synthesized": true,
                                    "error_code": &err.code,
                                });
                                if persist("assistant_message_end", end_payload).await {
                                    persisted_events += 1;
                                    end_persisted = true;
                                    let mid = if message_id.is_empty() {
                                        ""
                                    } else {
                                        message_id.as_str()
                                    };
                                    publish_assistant_message_end_event(&event_bus, &ctx, mid);
                                    warn!(
                                        session_id = %ctx.session_id,
                                        error_code = %err.code,
                                        "Synthesized assistant_message_end after early harness error"
                                    );
                                }
                            }
                            break;
                        }
                        HarnessOutbound::GenerationStart(_)
                        | HarnessOutbound::GenerationProgress(_)
                        | HarnessOutbound::GenerationPartialImage(_)
                        | HarnessOutbound::GenerationCompleted(_)
                        | HarnessOutbound::GenerationError(_)
                        | HarnessOutbound::ToolApprovalPrompt(_) => {}
                    }

                    // Throttled live-progress heartbeat. The client uses this
                    // signal (carried over the WS event bus) to refetch the
                    // chat history and pick up the in-flight reconstructed
                    // assistant turn — supporting mid-turn page refreshes
                    // without losing chat / sidekick state. We deliberately
                    // do not ship token-level deltas here; the periodic
                    // refetch is enough because `events_to_session_history`
                    // already rebuilds the partial turn from the persisted
                    // delta rows. `assistant_message_end` continues to be
                    // the authoritative finalization signal.
                    if produced_progress {
                        let now = std::time::Instant::now();
                        let should_publish = match last_progress_at {
                            None => true,
                            Some(prev) => {
                                now.saturating_duration_since(prev)
                                    >= ASSISTANT_TURN_PROGRESS_THROTTLE
                            }
                        };
                        if should_publish && !message_id.is_empty() {
                            publish_assistant_turn_progress_event(&event_bus, &ctx, &message_id);
                            last_progress_at = Some(now);
                        }
                    }
                }
                Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
                Err(tokio::sync::broadcast::error::RecvError::Lagged(n)) => {
                    // Previously we aborted the turn on lag, which meant a
                    // single slow storage write could cause us to lose the
                    // terminating `assistant_message_end` and therefore the
                    // entire assistant turn on reopen. Log and keep draining
                    // — we still have the accumulated `content_blocks` and
                    // will synthesize an end event at the close of the stream
                    // if needed.
                    warn!(
                        session_id = %ctx.session_id,
                        project_agent_id = %ctx.project_agent_id,
                        skipped = n,
                        "Chat persistence receiver lagged; continuing to drain so the assistant_message_end is not lost"
                    );
                    continue;
                }
            }
        }

        // Safety net: the broadcast channel closed before the harness emitted
        // `assistant_message_end` (e.g. the stream task panicked, the client
        // disconnected mid-turn, or a provider-side hard error). Synthesize a
        // terminating event from whatever we have accumulated so the LLM can
        // see at least a partial record of this turn on the next reopen.
        if !end_persisted
            && (!full_text.is_empty() || !content_blocks.is_empty() || !thinking_buf.is_empty())
        {
            if !text_segment.is_empty() {
                content_blocks.push(serde_json::json!({
                    "type": "text", "text": &text_segment
                }));
            }
            let end_payload = serde_json::json!({
                "message_id": if message_id.is_empty() {
                    serde_json::Value::Null
                } else {
                    serde_json::Value::String(message_id.clone())
                },
                "text": &full_text,
                "thinking": if thinking_buf.is_empty() {
                    serde_json::Value::Null
                } else {
                    serde_json::Value::String(thinking_buf)
                },
                "content_blocks": &content_blocks,
                "usage": serde_json::Value::Null,
                "files_changed": {
                    "created": [],
                    "modified": [],
                    "deleted": [],
                },
                "stop_reason": "aborted",
                "seq": seq + 1,
                "synthesized": true,
            });
            if persist("assistant_message_end", end_payload).await {
                persisted_events += 1;
                let mid = if message_id.is_empty() {
                    ""
                } else {
                    message_id.as_str()
                };
                publish_assistant_message_end_event(&event_bus, &ctx, mid);
            }
            warn!(
                session_id = %ctx.session_id,
                persisted_events,
                content_blocks = content_blocks.len(),
                "Synthesized assistant_message_end after broadcast channel closed early"
            );
        }
    });
}

async fn setup_project_chat_persistence(
    state: &AppState,
    project_id: &ProjectId,
    agent_instance_id: &AgentInstanceId,
    jwt: &str,
    force_new: bool,
) -> Option<ChatPersistCtx> {
    let storage = state.storage_client.as_ref()?.clone();
    let jwt = jwt.to_string();
    let pai = agent_instance_id.to_string();
    let pid = project_id.to_string();
    let session_id = resolve_chat_session(&storage, &jwt, &pai, &pid, force_new).await?;
    Some(ChatPersistCtx {
        storage,
        jwt,
        session_id,
        project_agent_id: pai,
        project_id: pid,
        // Project chats don't have an org-level agent handle to
        // broadcast — the sidebar's standalone-chat view wouldn't key
        // on a project session anyway.
        agent_id: None,
    })
}

pub(crate) async fn setup_agent_chat_persistence(
    state: &AppState,
    agent_id: &AgentId,
    _agent_name: &str,
    jwt: &str,
    force_new: bool,
) -> Option<ChatPersistCtx> {
    let storage = match state.storage_client.as_ref() {
        Some(s) => s.clone(),
        None => {
            warn!(%agent_id, "agent chat persistence: no storage client configured");
            return None;
        }
    };
    let mut matching =
        find_matching_project_agents(state, &storage, jwt, &agent_id.to_string()).await;

    // Lazy repair: if the agent has no project binding yet (e.g. it was
    // created before the auto-binding path in `create_agent` existed, or
    // the binding attempt at create time failed transiently), try once
    // to auto-create a per-org Home project + binding here so the
    // user's first chat turn self-heals instead of surfacing the
    // `chat_persist_unavailable` error to the UI. Best-effort: if it
    // still fails we fall through to the `None` return and the caller
    // raises the existing error.
    if matching.is_empty() {
        match state.agent_service.get_agent_with_jwt(jwt, agent_id).await {
            Ok(agent) => {
                info!(
                    %agent_id,
                    "agent chat persistence: no project binding; attempting lazy Home-project auto-bind"
                );
                super::home_project::ensure_agent_home_project_and_binding(state, jwt, &agent)
                    .await;
                // Bust the discovery cache so the re-read below sees
                // the just-created binding rather than the empty
                // snapshot the first call populated.
                invalidate_agent_discovery_cache(state, jwt, &agent_id.to_string());
                matching =
                    find_matching_project_agents(state, &storage, jwt, &agent_id.to_string()).await;
            }
            Err(e) => {
                warn!(
                    %agent_id,
                    error = %e,
                    "agent chat persistence: cannot resolve agent for lazy auto-bind; giving up"
                );
            }
        }
    }

    setup_agent_chat_persistence_with_matched(&storage, agent_id, jwt, force_new, &matching).await
}

/// Variant of [`setup_agent_chat_persistence`] that reuses a pre-fetched
/// `find_matching_project_agents` result. The chat handler calls
/// `find_matching_project_agents` once per turn and feeds the result
/// into both this function and the history loader so we don't double
/// the network/storage traffic for every CEO message.
pub(crate) async fn setup_agent_chat_persistence_with_matched(
    storage: &Arc<StorageClient>,
    agent_id: &AgentId,
    jwt: &str,
    force_new: bool,
    matching: &[aura_os_storage::StorageProjectAgent],
) -> Option<ChatPersistCtx> {
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

    let session_id = match resolve_chat_session(storage, jwt, &pai, &pid, force_new).await {
        Some(sid) => sid,
        None => {
            warn!(%agent_id, %pai, %pid, "agent chat persistence: failed to resolve/create chat session");
            return None;
        }
    };
    Some(ChatPersistCtx {
        storage: storage.clone(),
        jwt: jwt.to_string(),
        session_id,
        project_agent_id: pai,
        project_id: pid,
        agent_id: Some(agent_id.to_string()),
    })
}

pub(crate) fn harness_broadcast_to_sse(
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
    AuthJwt(jwt): AuthJwt,
    Path(agent_id): Path<AgentId>,
) -> ApiResult<StatusCode> {
    let session_key = format!("agent:{agent_id}");
    remove_live_session(&state, &session_key).await;
    let _ = setup_agent_chat_persistence(&state, &agent_id, "", &jwt, true).await;
    info!(%agent_id, "Agent chat session reset");
    Ok(StatusCode::NO_CONTENT)
}

pub(crate) async fn reset_instance_session(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    Path((project_id, agent_instance_id)): Path<(ProjectId, AgentInstanceId)>,
) -> ApiResult<StatusCode> {
    let session_key = format!("instance:{agent_instance_id}");
    remove_live_session(&state, &session_key).await;
    let _ =
        setup_project_chat_persistence(&state, &project_id, &agent_instance_id, &jwt, true).await;
    info!(%agent_instance_id, "Instance chat session reset");
    Ok(StatusCode::NO_CONTENT)
}

pub fn session_events_to_conversation_history(events: &[SessionEvent]) -> Vec<ConversationMessage> {
    // Defensive: a harness crash can leave `tool_use` blocks in storage with
    // no matching `tool_result`. Feeding those back to the LLM trips
    // Anthropic's "tool_use without matching tool_result" 400 error (seen
    // with agent 1f7dabd9... after a 79h session crashed mid-tool-call).
    // We drop any dangling `tool_use` whose id isn't referenced by a
    // subsequent `tool_result` in the same event stream.
    let referenced_tool_use_ids = collect_referenced_tool_use_ids(events);

    // Compute the index of the first *user* event that belongs to the
    // "recent" window. Events at or after this index keep the full
    // per-blob budget; events before it fall back to the older, tighter
    // cap so long histories don't balloon the cold-start prompt.
    let recent_start = {
        let mut user_turns_from_end = 0usize;
        let mut idx = events.len();
        for (i, evt) in events.iter().enumerate().rev() {
            if matches!(evt.role, ChatRole::User) {
                user_turns_from_end += 1;
                if user_turns_from_end >= HISTORY_RECENT_TURNS {
                    idx = i;
                    break;
                }
            }
        }
        idx
    };

    events
        .iter()
        .enumerate()
        .filter_map(|(i, m)| {
            let role = match m.role {
                ChatRole::User => "user",
                ChatRole::Assistant => "assistant",
                _ => return None,
            };

            let max_blob = if i >= recent_start {
                TOOL_BLOB_MAX_BYTES
            } else {
                TOOL_BLOB_OLD_MAX_BYTES
            };

            // The harness `ConversationMessage` shape is flat text, so we need
            // to render tool_use / tool_result blocks textually for the LLM to
            // see them on cold start. Previously a tool-only assistant turn
            // (empty `content`, populated `content_blocks`) was filtered out
            // here, causing the model to lose all prior tool context after the
            // app was reopened.
            let rendered = render_conversation_text(
                &m.content,
                m.content_blocks.as_deref(),
                &referenced_tool_use_ids,
                max_blob,
            );
            if rendered.is_empty() {
                return None;
            }

            Some(ConversationMessage {
                role: role.to_string(),
                content: rendered,
            })
        })
        .collect()
}

/// Collect the set of `tool_use_id` values referenced by any `tool_result`
/// block across the given event stream. Used to detect dangling `tool_use`
/// blocks left behind by a crashed harness — those must be stripped before
/// sending history back to the LLM.
fn collect_referenced_tool_use_ids(events: &[SessionEvent]) -> std::collections::HashSet<String> {
    let mut set = std::collections::HashSet::new();
    for evt in events {
        if let Some(blocks) = evt.content_blocks.as_deref() {
            for block in blocks {
                if let ChatContentBlock::ToolResult { tool_use_id, .. } = block {
                    set.insert(tool_use_id.clone());
                }
            }
        }
    }
    set
}

/// Render a message into the flat-text shape the harness expects.
///
/// Preserves the plain-text content when present; additionally serializes any
/// `tool_use` / `tool_result` / `thinking` / `image` blocks as compact
/// annotations so the model retains awareness of prior tool activity when
/// loading history on a cold start. Skips `tool_use` blocks whose id isn't
/// referenced by any `tool_result` in the stream (dangling blocks from a
/// crashed tool-call cycle).
fn render_conversation_text(
    text: &str,
    blocks: Option<&[ChatContentBlock]>,
    referenced_tool_use_ids: &std::collections::HashSet<String>,
    max_blob_bytes: usize,
) -> String {
    let mut parts: Vec<String> = Vec::new();
    if !text.is_empty() {
        parts.push(text.to_string());
    }

    if let Some(blocks) = blocks {
        for block in blocks {
            match block {
                ChatContentBlock::Text { text } if !text.is_empty() => {
                    // Already captured via the top-level `content` string in
                    // most cases, but include when `text` was empty there.
                    if parts.iter().any(|p| p == text) {
                        continue;
                    }
                    parts.push(text.clone());
                }
                ChatContentBlock::ToolUse { id, name, input } => {
                    if !referenced_tool_use_ids.contains(id) {
                        warn!(tool_use_id = %id, %name, "skipping dangling tool_use (no matching tool_result)");
                        continue;
                    }
                    let input_preview =
                        serde_json::to_string(input).unwrap_or_else(|_| "{}".to_string());
                    let input_preview = truncate_for_history(&input_preview, max_blob_bytes);
                    parts.push(format!("[tool_use {name} input={input_preview}]"));
                }
                ChatContentBlock::ToolResult {
                    content, is_error, ..
                } => {
                    let label = if is_error.unwrap_or(false) {
                        "tool_error"
                    } else {
                        "tool_result"
                    };
                    let content = truncate_for_history(content, max_blob_bytes);
                    parts.push(format!("[{label} {content}]"));
                }
                ChatContentBlock::TaskRef { title, .. } => {
                    parts.push(format!("[task_ref {title}]"));
                }
                ChatContentBlock::SpecRef { title, .. } => {
                    parts.push(format!("[spec_ref {title}]"));
                }
                ChatContentBlock::Image { .. } | ChatContentBlock::Text { .. } => {}
            }
        }
    }

    parts.join("\n")
}

fn format_project_state_snapshot(specs: &[Spec], tasks: &[Task]) -> Option<String> {
    let mut sections: Vec<String> = Vec::new();

    if !specs.is_empty() {
        let mut recent_specs = specs.to_vec();
        recent_specs.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
        recent_specs.truncate(3);

        let spec_lines: Vec<String> = recent_specs
            .iter()
            .map(|spec| format!("- {}", spec.title))
            .collect();
        sections.push(format!("Recent specs:\n{}", spec_lines.join("\n")));
    }

    if !tasks.is_empty() {
        let mut recent_tasks = tasks.to_vec();
        recent_tasks.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
        recent_tasks.truncate(6);

        let spec_titles: std::collections::HashMap<_, _> = specs
            .iter()
            .map(|spec| (spec.spec_id, spec.title.as_str()))
            .collect();

        let task_lines: Vec<String> = recent_tasks
            .iter()
            .map(|task| {
                let status = format!("{:?}", task.status).to_lowercase();
                let spec_suffix = spec_titles
                    .get(&task.spec_id)
                    .map(|title| format!(" (spec: {title})"))
                    .unwrap_or_default();
                format!("- [{status}] {}{}", task.title, spec_suffix)
            })
            .collect();
        sections.push(format!("Recent tasks:\n{}", task_lines.join("\n")));
    }

    if sections.is_empty() {
        None
    } else {
        Some(format!(
            "Current durable project state from persisted Aura records:\n{}",
            sections.join("\n\n")
        ))
    }
}

fn append_project_state_to_system_prompt(base: &str, snapshot: Option<&str>) -> String {
    match snapshot {
        Some(snapshot) if !snapshot.trim().is_empty() => {
            let prefix = if base.trim().is_empty() {
                String::new()
            } else {
                format!("{base}\n\n")
            };
            format!(
                "{prefix}Use the following persisted project state as continuity context when continuing this conversation after a restart or model switch:\n{snapshot}"
            )
        }
        _ => base.to_string(),
    }
}

async fn load_project_state_snapshot(
    state: &AppState,
    project_id: &str,
    jwt: &str,
) -> Option<String> {
    let storage = match state.storage_client.as_ref() {
        Some(storage) => storage,
        None => return None,
    };

    let specs = match storage.list_specs(project_id, jwt).await {
        Ok(storage_specs) => {
            let mut specs: Vec<Spec> = storage_specs
                .into_iter()
                .filter_map(|spec| Spec::try_from(spec).ok())
                .collect();
            specs.sort_by_key(|spec| spec.order_index);
            specs
        }
        Err(err) => {
            warn!(project_id, error = %err, "failed to load specs for project state snapshot");
            Vec::new()
        }
    };

    let tasks = match storage.list_tasks(project_id, jwt).await {
        Ok(storage_tasks) => {
            let mut tasks: Vec<Task> = storage_tasks
                .into_iter()
                .filter_map(|task| Task::try_from(task).ok())
                .collect();
            tasks.sort_by_key(|task| task.order_index);
            tasks
        }
        Err(err) => {
            warn!(project_id, error = %err, "failed to load tasks for project state snapshot");
            Vec::new()
        }
    };

    format_project_state_snapshot(&specs, &tasks)
}

/// Reconstruct conversation history in Claude API format from stored
/// `SessionEvent`s. Unlike `session_events_to_conversation_history` (which
/// only keeps text), this preserves tool_use / tool_result content blocks so
/// the agent can resume multi-turn tool conversations after a cold start.
///
/// Dangling `tool_use` blocks (ones whose id has no matching `tool_result`
/// in the event stream — typically left behind by a crashed harness) are
/// stripped here. Feeding them back into context would trigger Anthropic's
/// "tool_use without matching tool_result" 400 error on every subsequent
/// prompt — which is exactly the class of bug that motivated this
/// regression guard.
pub fn session_events_to_agent_history(events: &[SessionEvent]) -> Vec<serde_json::Value> {
    let referenced_tool_use_ids = collect_referenced_tool_use_ids(events);

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
                                if !referenced_tool_use_ids.contains(id) {
                                    warn!(
                                        tool_use_id = %id,
                                        %name,
                                        "skipping dangling tool_use (no matching tool_result) from agent history"
                                    );
                                    continue;
                                }
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

/// Build the lookup key for [`AppState::agent_discovery_cache`].
///
/// The JWT is part of the key so cached bindings never leak across
/// users. JWTs are opaque to us — we just treat the whole string as an
/// isolation token.
fn agent_discovery_cache_key(jwt: &str, agent_id_str: &str) -> String {
    format!("{jwt}::{agent_id_str}")
}

/// Invalidate any cached [`find_matching_project_agents`] result for
/// this `(jwt, agent_id)`. Callers that mutate bindings (e.g. the
/// lazy Home-project auto-bind path) should invoke this so the next
/// read sees the fresh state without waiting for TTL expiry.
pub(super) fn invalidate_agent_discovery_cache(state: &AppState, jwt: &str, agent_id_str: &str) {
    state
        .agent_discovery_cache
        .remove(&agent_discovery_cache_key(jwt, agent_id_str));
}

pub(super) async fn find_matching_project_agents(
    state: &AppState,
    storage: &aura_os_storage::StorageClient,
    jwt: &str,
    agent_id_str: &str,
) -> Vec<aura_os_storage::StorageProjectAgent> {
    let cache_key = agent_discovery_cache_key(jwt, agent_id_str);

    // Short-TTL cache: the orgs → projects → project_agents fan-out
    // underneath this function is the dominant fixed cost on every
    // chat open and every chat turn. Bindings change only on explicit
    // create/delete paths, so returning a ≤30s stale result here is
    // safe and covers the cold-boot burst (active chat + sidebar
    // preview prefetches) with a single underlying walk.
    if let Some(entry) = state.agent_discovery_cache.get(&cache_key) {
        if entry.cached_at.elapsed() < AGENT_DISCOVERY_TTL {
            let matched = entry.project_agents.clone();
            info!(
                matched = matched.len(),
                %agent_id_str,
                age_ms = entry.cached_at.elapsed().as_millis() as u64,
                "agent matching: discovery cache hit"
            );
            return matched;
        }
    }

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

    state.agent_discovery_cache.insert(
        cache_key,
        CachedAgentDiscovery {
            project_agents: matched.clone(),
            cached_at: Instant::now(),
        },
    );

    matched
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

/// Translate a caller's `(limit, offset)` window into the minimum total
/// number of events the storage loader must return so the final slice is
/// correct. Used as a short-circuit hint for
/// [`load_events_oldest_first_bounded`]: once we've collected this many
/// events walking sessions newest-first we can stop reading older
/// sessions. Returns `None` when the caller asked for an unbounded load.
fn target_window_size(limit: Option<usize>, offset: usize) -> Option<usize> {
    normalize_agent_history_limit(limit).map(|l| l.saturating_add(offset))
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

/// Produce a sortable recency key for a storage session.
///
/// Parses RFC3339 timestamps so timezone-suffixed ("...Z") and offset
/// ("+00:00") variants, or entries that include fractional seconds, compare
/// correctly — raw string compare would mis-order them. Prefers `started_at`
/// (when the session became active) then `created_at` (row creation) then
/// `updated_at` (last row mutation). Missing / unparseable timestamps sort
/// to the Unix epoch, so any session with a real timestamp always wins over
/// a session with no recency signal at all.
pub(super) fn storage_session_sort_key(session: &aura_os_storage::StorageSession) -> DateTime<Utc> {
    let candidate = session
        .started_at
        .as_deref()
        .or(session.created_at.as_deref())
        .or(session.updated_at.as_deref());

    candidate
        .and_then(|raw| DateTime::parse_from_rfc3339(raw).ok())
        .map(|dt| dt.with_timezone(&Utc))
        .unwrap_or_else(|| DateTime::<Utc>::from(std::time::UNIX_EPOCH))
}

/// Pick the most recent session out of a list. No longer used by the chat
/// history loaders (they now aggregate events across all sessions so prior
/// sessions stay visible after the user starts a new session), but retained
/// because its unit tests pin down the `storage_session_sort_key` ordering
/// contract, which the loaders depend on for "oldest first" concatenation.
#[cfg(test)]
fn latest_storage_session(
    sessions: &[aura_os_storage::StorageSession],
) -> Option<&aura_os_storage::StorageSession> {
    sessions
        .iter()
        .max_by(|left, right| storage_session_sort_key(left).cmp(&storage_session_sort_key(right)))
}

/// Maximum number of per-session `list_events` requests we fan out in a
/// single parallel batch while walking sessions newest-first. Larger
/// batches give more parallelism at the cost of wasted storage traffic
/// when the target window is already filled by the first session or two.
const SESSION_FETCH_BATCH: usize = 4;

/// Load events across sessions in chronological (oldest-first) order,
/// fanning per-session `list_events` calls out in parallel batches and
/// short-circuiting once enough events have been collected to satisfy
/// `target_size` (the caller's `limit + offset` window).
///
/// Pre-optimization this function walked every session sequentially with
/// `list_events(None, None)` — which paginates in 500-event chunks until
/// exhaustion — then the HTTP handler sliced the result down to the last
/// `limit` events. For accounts with many historical sessions that meant
/// O(total lifetime events) of storage reads on every chat open. Walking
/// newest-first with a target lets us stop after the most recent session
/// (the common case) while still returning the same chronological slice
/// the caller expected.
async fn load_events_oldest_first_bounded(
    storage: &StorageClient,
    jwt: &str,
    sessions: &[&aura_os_storage::StorageSession],
    target_size: Option<usize>,
    default_project_agent_id: Option<&str>,
) -> Result<(Vec<SessionEvent>, usize), aura_os_storage::StorageError> {
    if sessions.is_empty() {
        return Ok((Vec::new(), 0));
    }

    let newest_first: Vec<&aura_os_storage::StorageSession> =
        sessions.iter().rev().copied().collect();

    let mut per_session_events: Vec<Vec<SessionEvent>> = Vec::with_capacity(newest_first.len());
    let mut total_events = 0usize;
    let mut sessions_read = 0usize;
    for chunk in newest_first.chunks(SESSION_FETCH_BATCH) {
        let futs = chunk.iter().map(|session| async move {
            let storage_events = storage.list_events(&session.id, jwt, None, None).await?;
            let project_agent_id = session
                .project_agent_id
                .as_deref()
                .or(default_project_agent_id)
                .unwrap_or_default();
            let project_id = session.project_id.as_deref().unwrap_or_default();
            Ok::<_, aura_os_storage::StorageError>(events_to_session_history(
                &storage_events,
                project_agent_id,
                project_id,
            ))
        });
        let results: Vec<Result<Vec<SessionEvent>, _>> = join_all(futs).await;
        for result in results {
            let events = result?;
            total_events += events.len();
            per_session_events.push(events);
            sessions_read += 1;
        }
        if let Some(target) = target_size {
            if total_events >= target {
                break;
            }
        }
    }

    // `per_session_events` is newest-session-first; reverse to chronological.
    per_session_events.reverse();
    let mut history = Vec::with_capacity(total_events);
    for events in per_session_events {
        history.extend(events);
    }
    Ok((history, sessions_read))
}

async fn load_latest_agent_events_from_storage_result(
    state: &AppState,
    agent_id: &AgentId,
    jwt: &str,
    target_size: Option<usize>,
) -> Result<Vec<SessionEvent>, aura_os_storage::StorageError> {
    let Some(ref storage) = state.storage_client else {
        warn!(%agent_id, "latest agent events: no storage client available");
        return Ok(Vec::new());
    };
    let agent_id_str = agent_id.to_string();
    let matching = find_matching_project_agents(state, storage, jwt, &agent_id_str).await;
    if matching.is_empty() {
        info!(
            %agent_id,
            "latest agent events: no matching project agents found — returning empty history"
        );
        return Ok(Vec::new());
    }
    let sessions_outcome = fetch_all_sessions(storage, jwt, &matching).await;
    info!(
        %agent_id,
        matched_agents = matching.len(),
        sessions = sessions_outcome.sessions.len(),
        failed_agents = sessions_outcome.failed_agents,
        "latest agent events: sessions fetched"
    );

    if sessions_outcome.all_failed() {
        if let Some(err) = sessions_outcome.first_error {
            return Err(err);
        }
    }

    // Aggregate events across ALL sessions for this agent, oldest first.
    // Each session is reconstructed independently via events_to_session_history
    // (so a dangling tool-use in one session cannot bind to a message in
    // another) and the results are concatenated. "Starting a new session"
    // therefore no longer hides prior messages from the UI — it only
    // changes which session new events get written to.
    let mut ordered: Vec<&aura_os_storage::StorageSession> =
        sessions_outcome.sessions.iter().collect();
    ordered.sort_by_key(|session| storage_session_sort_key(session));

    let (history, sessions_read) =
        load_events_oldest_first_bounded(storage, jwt, &ordered, target_size, None).await?;

    info!(
        %agent_id,
        sessions_total = ordered.len(),
        sessions_read,
        reconstructed_messages = history.len(),
        target_size,
        "latest agent events: events fetched"
    );
    Ok(history)
}

async fn load_project_session_history(
    state: &AppState,
    agent_instance_id: &AgentInstanceId,
    jwt: &str,
    target_size: Option<usize>,
) -> Result<Vec<SessionEvent>, aura_os_storage::StorageError> {
    let Some(ref storage) = state.storage_client else {
        return Ok(Vec::new());
    };
    let sessions = storage
        .list_sessions(&agent_instance_id.to_string(), jwt)
        .await?;
    let sessions_total = sessions.len();
    if sessions.is_empty() {
        info!(
            %agent_instance_id,
            sessions_total,
            "project session history: no sessions for agent instance"
        );
        return Ok(Vec::new());
    }

    // Aggregate events across ALL sessions for this agent instance, oldest
    // first. Each session is reconstructed independently (see comment in
    // load_latest_agent_events_from_storage_result) and concatenated so the
    // UI can display the full multi-session transcript even after the user
    // started a new session.
    let mut ordered: Vec<&aura_os_storage::StorageSession> = sessions.iter().collect();
    ordered.sort_by_key(|session| storage_session_sort_key(session));

    let instance_id_str = agent_instance_id.to_string();
    let (history, sessions_read) = load_events_oldest_first_bounded(
        storage,
        jwt,
        &ordered,
        target_size,
        Some(&instance_id_str),
    )
    .await?;

    info!(
        %agent_instance_id,
        sessions_total,
        sessions_read,
        reconstructed_messages = history.len(),
        target_size,
        "project session history loaded"
    );
    Ok(history)
}

/// Load events from only the *current* storage session for a standalone
/// agent — the most recent session by `storage_session_sort_key`, which is
/// also the session `resolve_chat_session(force_new=false)` would return.
///
/// This is the LLM-context loader — it intentionally does NOT aggregate
/// across historical sessions. After a "Clear session" reset, the current
/// session is the fresh empty one just created by
/// `setup_agent_chat_persistence(force_new=true)`, so no prior events
/// (including any corrupted `tool_use` blocks left over from a crashed
/// harness) can be re-injected into the model context. UI endpoints still
/// call the aggregating loaders so prior messages remain visible in the
/// chat timeline.
async fn load_current_session_events_for_agent_result(
    state: &AppState,
    agent_id: &AgentId,
    jwt: &str,
) -> Result<Vec<SessionEvent>, aura_os_storage::StorageError> {
    let Some(ref storage) = state.storage_client else {
        warn!(%agent_id, "current agent session: no storage client available");
        return Ok(Vec::new());
    };
    let agent_id_str = agent_id.to_string();
    let matching = find_matching_project_agents(state, storage, jwt, &agent_id_str).await;
    load_current_session_events_for_agent_with_matched_result(storage, agent_id, jwt, &matching)
        .await
}

/// Variant of [`load_current_session_events_for_agent_result`] that
/// reuses a pre-fetched `find_matching_project_agents` result so the
/// chat handler doesn't re-run the `list_orgs` / `list_projects` /
/// `list_project_agents` fan-out twice per turn.
async fn load_current_session_events_for_agent_with_matched_result(
    storage: &StorageClient,
    agent_id: &AgentId,
    jwt: &str,
    matching: &[aura_os_storage::StorageProjectAgent],
) -> Result<Vec<SessionEvent>, aura_os_storage::StorageError> {
    if matching.is_empty() {
        info!(
            %agent_id,
            "current agent session: no matching project agents found — returning empty history"
        );
        return Ok(Vec::new());
    }
    let sessions_outcome = fetch_all_sessions(storage, jwt, matching).await;
    if sessions_outcome.all_failed() {
        if let Some(err) = sessions_outcome.first_error {
            return Err(err);
        }
    }

    let Some(latest) = sessions_outcome
        .sessions
        .iter()
        .max_by_key(|s| storage_session_sort_key(s))
    else {
        return Ok(Vec::new());
    };

    info!(
        %agent_id,
        session_id = %latest.id,
        "current agent session: loading events from latest storage session only"
    );
    let storage_events = storage.list_events(&latest.id, jwt, None, None).await?;
    Ok(events_to_session_history(
        &storage_events,
        latest.project_agent_id.as_deref().unwrap_or_default(),
        latest.project_id.as_deref().unwrap_or_default(),
    ))
}

pub async fn load_current_session_events_for_agent(
    state: &AppState,
    agent_id: &AgentId,
    jwt: &str,
) -> Vec<SessionEvent> {
    match load_current_session_events_for_agent_result(state, agent_id, jwt).await {
        Ok(messages) => messages,
        Err(e) => {
            warn!(error = %e, %agent_id, "failed to load current agent session from storage");
            Vec::new()
        }
    }
}

pub async fn load_current_session_events_for_agent_with_matched(
    storage: &StorageClient,
    agent_id: &AgentId,
    jwt: &str,
    matching: &[aura_os_storage::StorageProjectAgent],
) -> Vec<SessionEvent> {
    match load_current_session_events_for_agent_with_matched_result(
        storage, agent_id, jwt, matching,
    )
    .await
    {
        Ok(messages) => messages,
        Err(e) => {
            warn!(error = %e, %agent_id, "failed to load current agent session from storage");
            Vec::new()
        }
    }
}

/// Instance-scoped analogue of `load_current_session_events_for_agent` — used
/// by the harness chat path for project-bound agent instances. Loads events
/// from only the newest storage session for the instance.
pub async fn load_current_session_events_for_instance(
    state: &AppState,
    agent_instance_id: &AgentInstanceId,
    jwt: &str,
) -> Result<Vec<SessionEvent>, aura_os_storage::StorageError> {
    let Some(ref storage) = state.storage_client else {
        return Ok(Vec::new());
    };
    let sessions = storage
        .list_sessions(&agent_instance_id.to_string(), jwt)
        .await?;
    if sessions.is_empty() {
        return Ok(Vec::new());
    }

    let Some(latest) = sessions.iter().max_by_key(|s| storage_session_sort_key(s)) else {
        return Ok(Vec::new());
    };

    info!(
        %agent_instance_id,
        session_id = %latest.id,
        "current instance session: loading events from latest storage session only"
    );
    let storage_events = storage.list_events(&latest.id, jwt, None, None).await?;
    Ok(events_to_session_history(
        &storage_events,
        &agent_instance_id.to_string(),
        latest.project_id.as_deref().unwrap_or_default(),
    ))
}

pub(crate) async fn list_agent_events(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    Path(agent_id): Path<AgentId>,
    Query(query): Query<AgentEventsQuery>,
) -> ApiResult<Json<Vec<SessionEvent>>> {
    if is_capture_access_token(&jwt) && agent_id == demo_agent_id() {
        return Ok(Json(slice_recent_agent_events(
            demo_agent_events(),
            query.limit,
            query.offset,
        )));
    }

    let _ = state.require_storage_client()?;
    let target_size = target_window_size(query.limit, query.offset);
    let messages =
        load_latest_agent_events_from_storage_result(&state, &agent_id, &jwt, target_size)
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
        if let Some(pos) = result
            .iter()
            .position(|m| m.event_id.to_string() == after_id)
        {
            result = result[pos + 1..].to_vec();
        }
    }

    if let Some(before_id) = before {
        if let Some(pos) = result
            .iter()
            .position(|m| m.event_id.to_string() == before_id)
        {
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
    if is_capture_access_token(&jwt) && agent_id == demo_agent_id() {
        let filtered = apply_cursor_filter(
            demo_agent_events(),
            query.before.as_deref(),
            query.after.as_deref(),
        );
        let limit = normalize_agent_history_limit(query.limit).unwrap_or(50);
        let has_more = filtered.len() > limit;
        let start = filtered.len().saturating_sub(limit);
        let result = filtered[start..].to_vec();
        let next_cursor = if has_more {
            result.first().map(|m| m.event_id.to_string())
        } else {
            None
        };
        return Ok(Json(PaginatedEventsResponse {
            events: result,
            has_more,
            next_cursor,
        }));
    }

    let _ = state.require_storage_client()?;
    // When either cursor is present we need the full transcript so the
    // `before`/`after` anchor can be located; otherwise we only need
    // enough events to fill the requested window.
    let target_size = if query.before.is_some() || query.after.is_some() {
        None
    } else {
        target_window_size(query.limit, 0)
    };
    let messages =
        load_latest_agent_events_from_storage_result(&state, &agent_id, &jwt, target_size)
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

async fn get_or_create_delegated_chat_session(
    state: &AppState,
    key: &str,
    harness_mode: HarnessMode,
    session_config: SessionConfig,
    requested_model: Option<String>,
    turn: SessionBridgeTurn,
) -> ApiResult<(
    bool,
    tokio::sync::broadcast::Receiver<aura_os_harness::HarnessOutbound>,
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
                    info!(
                        key,
                        "Model changed; closing existing delegated chat session"
                    );
                    reg.remove(key);
                } else {
                    SessionBridge::send_user_message(&session.commands_tx, turn)
                        .map_err(map_session_bridge_error)?;
                    return Ok((
                        false,
                        session.events_tx.subscribe(),
                        session.commands_tx.clone(),
                    ));
                }
            }
        }
    }

    let harness = state.harness_for(harness_mode);
    let session_agent_id = session_config.agent_id.clone();
    let started = SessionBridge::open_and_send_user_message(harness, session_config, turn)
        .await
        .map_err(map_session_bridge_start_error(key, harness_mode))?;
    insert_delegated_chat_session(state, key, requested_model, session_agent_id, started).await
}

async fn insert_delegated_chat_session(
    state: &AppState,
    key: &str,
    requested_model: Option<String>,
    session_agent_id: Option<String>,
    started: SessionBridgeStarted,
) -> ApiResult<(
    bool,
    tokio::sync::broadcast::Receiver<aura_os_harness::HarnessOutbound>,
    tokio::sync::mpsc::UnboundedSender<HarnessInbound>,
)> {
    let rx = started.events_rx;
    let commands_tx = started.commands_tx.clone();
    let mut reg = state.chat_sessions.lock().await;
    reg.insert(
        key.to_string(),
        ChatSession {
            session_id: started.session.session_id,
            commands_tx: started.session.commands_tx,
            events_tx: started.session.events_tx,
            model: requested_model,
            agent_id: session_agent_id,
        },
    );
    Ok((true, rx, commands_tx))
}

fn map_session_bridge_start_error(
    key: &str,
    harness_mode: HarnessMode,
) -> impl FnOnce(SessionBridgeError) -> (StatusCode, Json<ApiError>) + '_ {
    move |err| {
        warn!(
            session_key = key,
            ?harness_mode,
            error = %err,
            "Failed to open delegated harness chat session"
        );
        map_session_bridge_error(err)
    }
}

fn map_session_bridge_error(err: SessionBridgeError) -> (StatusCode, Json<ApiError>) {
    match err {
        SessionBridgeError::Open(message) => map_harness_session_startup_error(&message),
        SessionBridgeError::Send(message) => {
            ApiError::internal(format!("sending user message: {message}"))
        }
    }
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

#[allow(clippy::too_many_arguments)]
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
    // Guiding invariant: no silent success. If the inbound user message
    // cannot be persisted for ANY reason, we must return a non-2xx to the
    // caller, we must NOT forward the turn to the harness, and we must
    // NOT open an SSE body. The CEO's `send_to_agent` tool relied on the
    // previous soft-success behavior to report `persisted: true` for
    // writes that silently vanished — see the structured
    // `chat_persist_failed` / `chat_persist_unavailable` shapes in
    // `error.rs` for what callers now see on failure.
    let ctx = match persist_ctx {
        Some(ctx) => ctx,
        None => {
            error!(
                session_key,
                "chat stream rejected: persistence context unavailable (no project binding / storage down)"
            );
            return Err(ApiError::chat_persist_unavailable(
                "Chat persistence unavailable: target agent is not bound to any project in storage, or storage is not configured. Call assign_agent_to_project before retrying.",
                crate::error::ChatPersistErrorCtx::default(),
            ));
        }
    };

    let err_ctx = crate::error::ChatPersistErrorCtx {
        session_id: Some(ctx.session_id.clone()),
        project_id: Some(ctx.project_id.clone()),
        project_agent_id: Some(ctx.project_agent_id.clone()),
    };

    // Persist the user turn BEFORE starting the harness session. If
    // storage rejects the write we must not charge the caller credits
    // for a turn that would never make it into the target agent's chat
    // history, and we must not leave an orphaned harness turn mid-flight.
    let persisted_user_evt = persist_user_message(&ctx, &user_content, &attachments)
        .await
        .map_err(|e| crate::error::map_chat_persist_storage_error(e, err_ctx.clone()))?;

    // Snapshot the persistence identifiers so we can advertise them in
    // SSE response headers for callers (e.g. the CEO's `send_to_agent`)
    // that want to locate the saved turn without draining the stream.
    let persist_snapshot: Option<(String, String)> =
        Some((ctx.session_id.clone(), ctx.project_id.clone()));

    let turn = SessionBridgeTurn {
        content: user_content,
        tool_hints: None,
        attachments: dto_attachments_to_protocol(&attachments),
    };
    let (is_new, rx, _) = get_or_create_delegated_chat_session(
        state,
        session_key,
        harness_mode,
        session_config,
        requested_model,
        turn,
    )
    .await?;

    let persist_rx = rx.resubscribe();

    // Fan out the now-persisted user turn onto the local WebSocket event
    // bus so the UI can live-refresh the target agent's chat panel when
    // another agent (e.g. the CEO) writes into its history. See
    // `useChatHistorySync` for the consumer.
    publish_user_message_event(&state.event_broadcast, &ctx, persisted_user_evt.id.as_str());

    spawn_chat_persist_task(persist_rx, ctx, state.event_broadcast.clone());

    let mut prefix: Vec<Result<Event, Infallible>> = Vec::new();
    if is_new {
        let progress_event = Event::default()
            .event("progress")
            .json_data(serde_json::json!({"type":"progress","stage":"connecting"}))
            .unwrap();
        prefix.push(Ok(progress_event));
    }

    let broadcast_stream = harness_broadcast_to_sse(rx);

    let stream = FuturesStreamExt::chain(futures_util::stream::iter(prefix), broadcast_stream);
    let boxed: SseStream = Box::pin(stream);

    Ok((
        sse_response_headers(persist_snapshot.as_ref()),
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
    // Resolve the target agent with the *caller's* JWT rather than the
    // ambient `SettingsStore::get_jwt()` cache. The cache is shared
    // in-memory state that races under concurrent requests (e.g. the
    // UI polling `remote_agent/state` for 12 agents in parallel while
    // the CEO issues `send_to_agent`), which previously caused
    // `get_agent_async` to query aura-network with the wrong bearer
    // and surface spurious 404s. The local shadow is only used as a
    // strict `NotFound` fallback; any other upstream failure bubbles
    // up as a 5xx so we don't mask transient network issues behind
    // "agent not found".
    let agent = match state
        .agent_service
        .get_agent_with_jwt(&jwt, &agent_id)
        .await
    {
        Ok(a) => a,
        Err(aura_os_agents::AgentError::NotFound) => state
            .agent_service
            .get_agent_local(&agent_id)
            .map_err(|_| {
                warn!(
                    %agent_id,
                    "agent resolution failed: not in network or local shadow",
                );
                ApiError::not_found(format!(
                    "agent {agent_id} not found in network or local shadow"
                ))
            })?,
        Err(e) => {
            warn!(%agent_id, error = %e, "agent resolution failed via network");
            return Err(ApiError::internal(format!(
                "resolving agent {agent_id}: {e}"
            )));
        }
    };
    require_credits_for_auth_source(&state, &jwt, &agent.auth_source).await?;
    info!(%agent_id, action = ?body.action, "Agent message stream requested");

    if agent.adapter_type != "aura_harness" {
        return Err(ApiError::bad_request(format!(
            "adapter `{}` is no longer supported; only `aura_harness` agents can be chatted with",
            agent.adapter_type
        )));
    }

    let force_new = body.new_session.unwrap_or(false);
    // `setup_agent_chat_persistence` and the history loader both need
    // the set of project agents bound to this agent id. Previously
    // each called `find_matching_project_agents` independently, which
    // doubled the `list_orgs` / `list_projects_by_org` /
    // `list_project_agents` fan-out on every turn. Fetch it once here
    // and thread it into both consumers.
    let session_key = format!("agent:{agent_id}");
    if force_new {
        remove_live_session(&state, &session_key).await;
    }
    let live_session = has_live_session(&state, &session_key).await;

    let (persist_ctx, conversation_messages) = if let Some(ref storage) = state.storage_client {
        let matching =
            find_matching_project_agents(&state, storage, &jwt, &agent_id.to_string()).await;

        let persist_fut = setup_agent_chat_persistence_with_matched(
            storage, &agent_id, &jwt, force_new, &matching,
        );

        // LLM context rebuild on cold start: load only the current
        // storage session, not the full multi-session aggregate. See
        // `load_current_session_events_for_agent` doc-comment for
        // rationale.
        let should_load_history = !force_new && !live_session;
        let history_fut = async {
            if !should_load_history {
                return None;
            }
            let stored = load_current_session_events_for_agent_with_matched(
                storage, &agent_id, &jwt, &matching,
            )
            .await;
            if stored.is_empty() {
                None
            } else {
                let bounded =
                    slice_recent_agent_events(stored, Some(DEFAULT_AGENT_HISTORY_WINDOW_LIMIT), 0);
                Some(session_events_to_conversation_history(&bounded))
            }
        };

        let (persist_ctx, conversation_messages) = tokio::join!(persist_fut, history_fut);
        (persist_ctx, conversation_messages)
    } else {
        (None, None)
    };

    if persist_ctx.is_none() {
        error!(%agent_id, "agent chat: persistence context unavailable — chat will NOT be saved");
    } else {
        info!(%agent_id, "agent chat: persistence context ready");
    }

    // Surface the byte size of the flat-text history we're about to
    // ship into the harness `SessionConfig`. This is the cold-start
    // payload (warm sessions skip it via `get_or_create_chat_session`).
    // A `warn!` above `CONVERSATION_HISTORY_WARN_BYTES` makes the next
    // context-bloat regression visible in logs without needing a user
    // bug report.
    if let Some(ref msgs) = conversation_messages {
        let total_bytes: usize = msgs.iter().map(|m| m.content.len()).sum();
        let count = msgs.len();
        if total_bytes > CONVERSATION_HISTORY_WARN_BYTES {
            warn!(
                %agent_id,
                history_messages = count,
                history_bytes = total_bytes,
                "agent chat: conversation history is large — possible context bloat"
            );
        } else {
            info!(
                %agent_id,
                history_messages = count,
                history_bytes = total_bytes,
                "agent chat: conversation history prepared"
            );
        }
    }
    // Project-state continuity: on cold start, load a specs+tasks snapshot
    // for the project we're resolving the chat under so it can be appended
    // to the harness system prompt. Warm sessions keep whatever snapshot
    // was wired into the existing session, so we skip the fetch entirely.
    let project_state_snapshot = if force_new || live_session {
        None
    } else {
        let snapshot_project_id = body
            .project_id
            .as_ref()
            .map(|project_id| project_id.to_string())
            .or_else(|| persist_ctx.as_ref().map(|ctx| ctx.project_id.clone()));
        match snapshot_project_id {
            Some(project_id) => load_project_state_snapshot(&state, &project_id, &jwt).await,
            None => None,
        }
    };

    let integration = resolve_integration(&state, &agent, &jwt).await?;
    let model = effective_model(&agent, integration.as_ref(), body.model.clone());

    // Fetch org integrations exactly once per turn and feed both the
    // tool catalog and the installed-integrations list from the same
    // slice. Previously each of those helpers called
    // `integrations_for_org_with_token` independently, doubling the
    // upstream round-trip on every chat message.
    let org_integrations = match agent.org_id.as_ref() {
        Some(org_id) => Some(
            crate::handlers::agents::workspace_tools::integrations_for_org_with_token(
                &state,
                org_id,
                Some(&jwt),
            )
            .await,
        ),
        None => None,
    };

    // Populate the dispatcher's permissions cache with the bundle the
    // session was opened under. Keyed by the same string the harness
    // will stamp as `X-Aura-Agent-Id`, so the dispatcher can answer
    // capability checks without resolving the agent over the network
    // (which 503s on local-only installs and was the original 403
    // source for `list_agents` / `get_fleet_status`). Normalising
    // here means session-open and dispatch agree on the bundle
    // post-CEO-promotion.
    // Resolve the project binding for this turn. Prefer the explicit
    // `body.project_id` (the interface sends it whenever the user is
    // talking to the agent in a project context), and fall back to
    // the `persist_ctx.project_id` inferred from the agent's
    // project-binding record (`find_matching_project_agents`) so the
    // splice fires even for legacy clients that don't thread the
    // project id through the chat body. Without this fallback the
    // CEO-agent flow — where the LLM asks the agent to operate on
    // specs for an implicit project — would still ship a bundle
    // missing `ReadProject`/`WriteProject`, and the harness would
    // deny `list_specs` / `create_spec` by name.
    let effective_project_id = body
        .project_id
        .as_deref()
        .filter(|pid| !pid.is_empty())
        .map(|pid| pid.to_string())
        .or_else(|| {
            persist_ctx
                .as_ref()
                .map(|ctx| ctx.project_id.clone())
                .filter(|pid| !pid.is_empty())
        });

    // When the turn is project-bound (either explicitly via the body
    // or implicitly via the persistence context), splice the
    // self-project `ReadProject` / `WriteProject` caps into the
    // agent's normalized bundle so project-scoped tools
    // (`get_project`, `list_specs`, `create_spec`, `create_task`,
    // `run_task`, …) survive the `permissions_satisfy_requirements`
    // filter in `build_cross_agent_tools`. Without this splice, a
    // non-CEO agent whose persisted `capabilities` column is empty
    // would ship an `installed_tools` manifest missing all of those,
    // and the harness kernel (fail-closed `allow_unlisted = false`)
    // would deny each call with `"Tool 'X' is not allowed"`. Unlike
    // `agent_instance_chat` — where the binding is part of the
    // instance record — this handler is also used for non-project
    // chats, so the splice is gated on a project id being resolvable.
    let base_perms = agent
        .permissions
        .clone()
        .normalized_for_identity(&agent.name, Some(agent.role.as_str()));
    let normalized_perms = match effective_project_id.as_deref() {
        Some(pid) => base_perms.with_project_self_caps(pid),
        None => base_perms,
    };

    let installed_tools = build_session_installed_tools_with_integrations(
        &state,
        agent.org_id.as_ref(),
        &normalized_perms,
        &jwt,
        "agent_chat",
        &agent_id.to_string(),
        &agent.machine_type,
        Some(body.content.as_str()),
        org_integrations.as_deref(),
        effective_project_id.as_deref(),
    )
    .await?;
    let installed_integrations = match (agent.org_id.as_ref(), org_integrations.as_ref()) {
        (Some(_), Some(ints)) => {
            let installed =
                crate::handlers::agents::workspace_tools::installed_workspace_integrations_with_integrations(
                    ints,
                );
            (!installed.is_empty()).then_some(installed)
        }
        _ => None,
    };
    let config = SessionConfig {
        system_prompt: Some(append_project_state_to_system_prompt(
            &agent.system_prompt,
            project_state_snapshot.as_deref(),
        )),
        agent_id: Some(agent_id.to_string()),
        user_id: Some(auth_session.user_id.clone()),
        agent_name: Some(agent.name.clone()),
        model: model.clone(),
        token: Some(jwt.clone()),
        conversation_messages,
        project_id: body.project_id.clone(),
        // Billing headers that aura-router uses to attribute usage per
        // org / session. The harness forwards these as X-Aura-Org-Id /
        // X-Aura-Session-Id on every /v1/messages call.
        aura_org_id: agent.org_id.as_ref().map(|o| o.to_string()),
        aura_session_id: persist_ctx.as_ref().map(|c| c.session_id.clone()),
        provider_config: build_harness_provider_config(
            &agent.auth_source,
            integration.as_ref(),
            model.as_deref(),
        )?,
        installed_tools,
        installed_integrations,
        // Use the same normalized bundle that `installed_tools` was
        // built from so the harness sees a single consistent view of
        // the agent's permissions. The raw `agent.permissions` bundle
        // can legitimately diverge after `normalized_for_identity`
        // promotes a legacy CEO record to the canonical preset — if
        // we ship tools via `normalized_perms` but declare
        // `agent_permissions` from the unnormalized source, the
        // harness dispatcher's capability checks disagree with the
        // surfaced toolset.
        agent_permissions: (&normalized_perms).into(),
        intent_classifier: agent.intent_classifier.clone(),
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
    Path((project_id, agent_instance_id)): Path<(ProjectId, AgentInstanceId)>,
) -> ApiResult<Json<Vec<SessionEvent>>> {
    if is_capture_access_token(&jwt)
        && project_id == demo_project_id()
        && agent_instance_id == demo_agent_instance_id()
    {
        return Ok(Json(demo_agent_events()));
    }

    // Project-scoped UI endpoint has no explicit limit parameter yet, but
    // the `AgentChatView` currently renders at most the last
    // `MAX_AGENT_HISTORY_WINDOW_LIMIT` messages — cap the load so we don't
    // walk every historical session just to throw most of it away.
    let target_size = Some(MAX_AGENT_HISTORY_WINDOW_LIMIT);
    let messages = load_project_session_history(&state, &agent_instance_id, &jwt, target_size)
        .await
        .map_err(map_storage_error)?;
    Ok(Json(messages))
}

pub(crate) async fn send_event_stream(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    crate::state::AuthSession(auth_session): crate::state::AuthSession,
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

    // Reject new chat turns when this agent is already running an
    // automation loop upstream. The harness enforces one in-flight
    // turn per `agent_id` (shared by `/v1/agents/{id}/sessions` and
    // `/v1/agents/{id}/automaton/start`), so a `UserMessage` posted
    // while the loop is active surfaces as the raw upstream error
    // "A turn is currently in progress; send cancel first" with no
    // way for the UI to cancel it. Catching the conflict here lets
    // the frontend render a targeted "stop automation to chat"
    // affordance instead. Paused automatons are *not* holding a turn
    // so we allow chat through; any race between this check and
    // `commands_tx.send(UserMessage)` still bubbles up the raw
    // harness error as a fallback.
    {
        let reg = state.automaton_registry.lock().await;
        if let Some(entry) = reg.get(&(project_id, agent_instance_id)) {
            let live = entry.alive.load(std::sync::atomic::Ordering::Acquire);
            if live && !entry.paused {
                let automaton_id = entry.automaton_id.clone();
                drop(reg);
                warn!(
                    %project_id,
                    %agent_instance_id,
                    %automaton_id,
                    "Rejecting chat turn: agent is running an automation loop",
                );
                return Err(ApiError::agent_busy(
                    "Agent is currently running an automation task. Stop the loop to chat.",
                    Some(automaton_id),
                ));
            }
        }
    }

    let session_key = format!("instance:{agent_instance_id}");
    let force_new = body.new_session.unwrap_or(false);
    let persist_ctx =
        setup_project_chat_persistence(&state, &project_id, &agent_instance_id, &jwt, force_new)
            .await;
    if force_new {
        remove_live_session(&state, &session_key).await;
    }
    // LLM context rebuild on cold start: load only the current storage
    // session, not the full multi-session aggregate. See
    // `load_current_session_events_for_instance` doc-comment for rationale.
    let (conversation_messages, project_state_snapshot) = if force_new {
        (None, None)
    } else if !has_live_session(&state, &session_key).await {
        let stored = load_current_session_events_for_instance(&state, &agent_instance_id, &jwt)
            .await
            .map_err(map_storage_error)?;
        let conversation_messages = if stored.is_empty() {
            None
        } else {
            Some(session_events_to_conversation_history(&stored))
        };
        let project_state_snapshot =
            load_project_state_snapshot(&state, &project_id.to_string(), &jwt).await;
        (conversation_messages, project_state_snapshot)
    } else {
        (None, None)
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
    let system_prompt =
        append_project_state_to_system_prompt(&system_prompt, project_state_snapshot.as_deref());

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
    let org_integrations = match instance.org_id.as_ref() {
        Some(org_id) => Some(
            crate::handlers::agents::workspace_tools::integrations_for_org_with_token(
                &state,
                org_id,
                Some(&jwt),
            )
            .await,
        ),
        None => None,
    };

    // Prefer the parent agent's **current** permissions bundle over
    // the instance-time snapshot so a toggle flip on the agent
    // template's `PermissionsTab` takes effect on the very next turn
    // of every project-bound chat. The snapshot in
    // `instance.permissions` was always documented as a
    // "parent-lookup-failed" fallback — without this lookup the
    // instance session was the only place that silently kept serving
    // stale capabilities, which is exactly the
    // "toggled ReadAgent on but `list_agents` still isn't available"
    // bug that prompted this change.
    //
    // If the parent agent can't be found (template deleted, network
    // down, stale instance record) we fall back to the stored
    // snapshot rather than failing the chat — same behavior as
    // before, just gated by an explicit attempt instead of
    // unconditionally trusting the snapshot.
    let fresh_parent_permissions = state
        .agent_service
        .get_agent_async("", &instance.agent_id)
        .await
        .or_else(|_| state.agent_service.get_agent_local(&instance.agent_id))
        .ok()
        .map(|parent| parent.permissions);
    let effective_permissions =
        fresh_parent_permissions.unwrap_or_else(|| instance.permissions.clone());

    // Populate the dispatcher's permissions cache for the instance
    // session. Keyed by `agent_instance_id` (NOT `instance.agent_id`)
    // because `stamp_agent_tool_auth` below passes the instance id
    // through as the value of `X-Aura-Agent-Id` — the dispatcher
    // reads the raw header value and must find an entry under that
    // string. Stamping the template `agent_id` here would silently
    // miss every project-agent-instance tool call.
    //
    // `with_project_self_caps` is unconditional here because an
    // instance is by construction bound to `pid_str`. Without the
    // splice, a non-CEO agent whose `capabilities` column is empty
    // (the common case for fresh / non-preset agents) fails the
    // `ReadProjectFromArg` / `WriteProjectFromArg` gate in
    // `build_cross_agent_tools`, which silently drops
    // `get_project` / `list_specs` / `create_spec` / `create_task` /
    // `run_task` / ... from the shipped manifest. The harness kernel
    // policy then denies each call with `"Tool 'X' is not allowed"`
    // because `allow_unlisted = false` is the fail-closed default.
    // Granting self-project caps here is not a privilege escalation:
    // the downstream aura-network / aura-storage handlers already
    // re-verify project membership via the session JWT on every real
    // API call — the cap gate was a redundant first-pass filter for
    // the one project the instance is bound to.
    let base_instance_perms = effective_permissions
        .clone()
        .normalized_for_identity(&instance.name, Some(instance.role.as_str()));
    let normalized_instance_perms = base_instance_perms.with_project_self_caps(&pid_str);

    let installed_tools = build_session_installed_tools_with_integrations(
        &state,
        instance.org_id.as_ref(),
        &normalized_instance_perms,
        &jwt,
        "instance_chat",
        &agent_instance_id.to_string(),
        &instance.machine_type,
        Some(body.content.as_str()),
        org_integrations.as_deref(),
        Some(pid_str.as_str()),
    )
    .await?;
    let installed_integrations = match (instance.org_id.as_ref(), org_integrations.as_ref()) {
        (Some(_), Some(ints)) => {
            let installed =
                crate::handlers::agents::workspace_tools::installed_workspace_integrations_with_integrations(
                    ints,
                );
            (!installed.is_empty()).then_some(installed)
        }
        _ => None,
    };
    let config = SessionConfig {
        system_prompt: Some(system_prompt),
        agent_id: Some(instance.agent_id.to_string()),
        user_id: Some(auth_session.user_id.clone()),
        agent_name: Some(instance.name.clone()),
        model: model.clone(),
        token: Some(jwt),
        conversation_messages,
        project_id: Some(pid_str),
        project_path,
        // Billing headers that aura-router uses to attribute usage per
        // org / session. The harness forwards these as X-Aura-Org-Id /
        // X-Aura-Session-Id on every /v1/messages call.
        aura_org_id: instance.org_id.as_ref().map(|o| o.to_string()),
        aura_session_id: persist_ctx.as_ref().map(|c| c.session_id.clone()),
        provider_config: build_harness_provider_config(
            &instance.auth_source,
            integration.as_ref(),
            model.as_deref(),
        )?,
        installed_tools,
        installed_integrations,
        // Ship the *spliced* bundle to the harness, not the raw
        // `effective_permissions`. If we shipped the pre-splice bundle
        // here the kernel's capability check would reject calls whose
        // tool survived the manifest filter (which uses the spliced
        // bundle), since the manifest gate and the per-call gate
        // would disagree on whether `ReadProject { id: pid_str }` is
        // granted. Keeping both sides aligned on
        // `normalized_instance_perms` makes the kernel's first-pass
        // manifest filter and its per-call `holds_capability` check
        // consistent, which is the invariant the harness relies on to
        // avoid "tool was in `installed_tools` but denied at call time"
        // surprises.
        agent_permissions: (&normalized_instance_perms).into(),
        intent_classifier: instance.intent_classifier.clone(),
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
    use aura_os_core::{parse_dt, SessionEventId};
    use aura_os_storage::StorageSession;

    fn storage_session(
        id: &str,
        started_at: Option<&str>,
        created_at: Option<&str>,
    ) -> StorageSession {
        StorageSession {
            id: id.to_string(),
            project_agent_id: None,
            project_id: None,
            org_id: None,
            model: None,
            status: None,
            context_usage_estimate: None,
            total_input_tokens: None,
            total_output_tokens: None,
            summary_of_previous_context: None,
            tasks_worked_count: None,
            ended_at: None,
            started_at: started_at.map(str::to_string),
            created_at: created_at.map(str::to_string),
            updated_at: None,
        }
    }

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

    #[test]
    fn latest_storage_session_prefers_newest_started_at() {
        let older = storage_session("older", Some("2026-04-14T10:00:00Z"), None);
        let newer = storage_session("newer", Some("2026-04-15T10:00:00Z"), None);

        let selected = latest_storage_session(&[older, newer]).map(|session| session.id.clone());

        assert_eq!(selected.as_deref(), Some("newer"));
    }

    #[test]
    fn latest_storage_session_falls_back_to_created_at() {
        let older = storage_session("older", None, Some("2026-04-14T10:00:00Z"));
        let newer = storage_session("newer", None, Some("2026-04-15T10:00:00Z"));

        let selected = latest_storage_session(&[older, newer]).map(|session| session.id.clone());

        assert_eq!(selected.as_deref(), Some("newer"));
    }

    #[test]
    fn latest_storage_session_handles_mixed_timestamp_formats() {
        // Regression: `started_at` written by different storage backends or
        // client versions can come back with and without explicit offsets or
        // fractional seconds. A raw string compare would sort "2026-04-15T10:00:00Z"
        // *before* "2026-04-15T10:00:00.123+00:00" even though the latter is
        // later in wall-clock time, so the reader could pick a stale session
        // and the UI would only show part of the conversation.
        let earlier = storage_session("earlier", Some("2026-04-15T10:00:00Z"), None);
        let later = storage_session("later", Some("2026-04-15T10:00:00.123+00:00"), None);

        let selected = latest_storage_session(&[earlier, later]).map(|session| session.id.clone());

        assert_eq!(selected.as_deref(), Some("later"));
    }

    #[test]
    fn latest_storage_session_prefers_parseable_timestamp_over_missing() {
        // A session without any recency signal must never beat a session
        // with a valid `started_at`, even if they happen to be in an order
        // where a string compare of "" vs "2026-..." would make the empty
        // value larger (it doesn't, but defense-in-depth against future
        // field additions).
        let missing = storage_session("missing", None, None);
        let dated = storage_session("dated", Some("2024-01-01T00:00:00Z"), None);

        let selected = latest_storage_session(&[missing, dated]).map(|session| session.id.clone());

        assert_eq!(selected.as_deref(), Some("dated"));
    }

    fn assistant_event(content: &str, blocks: Option<Vec<ChatContentBlock>>) -> SessionEvent {
        SessionEvent {
            event_id: SessionEventId::new(),
            agent_instance_id: AgentInstanceId::nil(),
            project_id: ProjectId::nil(),
            role: ChatRole::Assistant,
            content: content.to_string(),
            content_blocks: blocks,
            thinking: None,
            thinking_duration_ms: None,
            created_at: parse_dt(&None),
            in_flight: None,
        }
    }

    #[test]
    fn conversation_history_renders_tool_only_assistant_turn_to_text() {
        // Regression: on app reopen, a tool-only assistant turn (empty
        // `content`, populated `content_blocks`) used to be filtered out of
        // the harness conversation history, so the model lost all memory of
        // prior tool calls.
        let user = SessionEvent {
            event_id: SessionEventId::new(),
            agent_instance_id: AgentInstanceId::nil(),
            project_id: ProjectId::nil(),
            role: ChatRole::User,
            content: "make a spec".into(),
            content_blocks: None,
            thinking: None,
            thinking_duration_ms: None,
            created_at: parse_dt(&None),
            in_flight: None,
        };
        let assistant = assistant_event(
            "",
            Some(vec![
                ChatContentBlock::ToolUse {
                    id: "tool-1".into(),
                    name: "create_spec".into(),
                    input: serde_json::json!({ "title": "hello" }),
                },
                ChatContentBlock::ToolResult {
                    tool_use_id: "tool-1".into(),
                    content: "spec-123".into(),
                    is_error: Some(false),
                },
            ]),
        );

        let history = session_events_to_conversation_history(&[user, assistant]);

        assert_eq!(history.len(), 2);
        assert_eq!(history[0].role, "user");
        assert_eq!(history[1].role, "assistant");
        assert!(
            history[1].content.contains("tool_use create_spec"),
            "assistant turn must carry tool call into LLM context, got: {}",
            history[1].content
        );
        assert!(
            history[1].content.contains("tool_result spec-123"),
            "assistant turn must carry tool result into LLM context, got: {}",
            history[1].content
        );
    }

    #[test]
    fn conversation_history_preserves_text_plus_tool_turns() {
        // Healthy cycle: assistant emits narration + tool_use, tool result
        // arrives in a subsequent event. Both narration and tool call must
        // survive. (A dangling tool_use with no matching tool_result is
        // stripped as a crash signature — see the
        // `conversation_history_strips_dangling_tool_use_block` integration
        // test in tests/chat_events_test.rs.)
        let assistant = assistant_event(
            "Sure, creating now.",
            Some(vec![ChatContentBlock::ToolUse {
                id: "tool-1".into(),
                name: "create_spec".into(),
                input: serde_json::json!({ "title": "hello" }),
            }]),
        );
        let tool_result = assistant_event(
            "",
            Some(vec![ChatContentBlock::ToolResult {
                tool_use_id: "tool-1".into(),
                content: "spec-123".into(),
                is_error: Some(false),
            }]),
        );

        let history = session_events_to_conversation_history(&[assistant, tool_result]);
        assert!(
            history
                .iter()
                .any(|m| m.content.starts_with("Sure, creating now.")
                    && m.content.contains("tool_use create_spec")),
            "narration and tool_use must both survive, got: {history:?}"
        );
    }

    #[test]
    fn conversation_history_drops_fully_empty_assistant_turns() {
        let empty = assistant_event("", None);
        let history = session_events_to_conversation_history(&[empty]);
        assert!(history.is_empty());
    }

    #[test]
    fn truncate_for_history_is_noop_below_cap() {
        let s = "hello world";
        assert_eq!(truncate_for_history(s, 2048), s);
    }

    #[test]
    fn truncate_for_history_keeps_prefix_and_marker() {
        let big = "X".repeat(10_000);
        let truncated = truncate_for_history(&big, 128);
        assert!(truncated.len() < 512);
        assert!(truncated.starts_with("XXXX"));
        assert!(truncated.contains("[truncated 10000 bytes]"));
    }

    #[test]
    fn truncate_for_history_respects_char_boundary() {
        // A 4-byte UTF-8 char right at the cap must not split.
        let s = format!("abc{}", "🦀".repeat(10));
        let truncated = truncate_for_history(&s, 5);
        assert!(truncated.starts_with("abc"));
        assert!(truncated.contains("[truncated"));
    }

    #[test]
    fn render_conversation_text_truncates_oversized_tool_result() {
        let big = "Z".repeat(10_000);
        let blocks = vec![
            ChatContentBlock::ToolUse {
                id: "tool-1".into(),
                name: "list_agents".into(),
                input: serde_json::json!({}),
            },
            ChatContentBlock::ToolResult {
                tool_use_id: "tool-1".into(),
                content: big.clone(),
                is_error: Some(false),
            },
        ];
        let referenced: std::collections::HashSet<String> =
            std::iter::once("tool-1".to_string()).collect();
        let rendered = render_conversation_text("", Some(&blocks), &referenced, 512);
        assert!(
            rendered.len() < 2_000,
            "rendered still large: {}",
            rendered.len()
        );
        assert!(rendered.contains("[truncated 10000 bytes]"));
        assert!(!rendered.contains(&big));
    }

    #[test]
    fn conversation_history_uses_tight_cap_for_old_tool_results() {
        // Ten assistant tool-result turns followed by two user turns so
        // the first assistant turn sits well outside the recent window.
        let big_old = "OLD".repeat(4_000); // 12_000 bytes
        let big_recent = "NEW".repeat(4_000);

        let old_assistant = assistant_event(
            "",
            Some(vec![
                ChatContentBlock::ToolUse {
                    id: "tool-old".into(),
                    name: "list_agents".into(),
                    input: serde_json::json!({}),
                },
                ChatContentBlock::ToolResult {
                    tool_use_id: "tool-old".into(),
                    content: big_old.clone(),
                    is_error: Some(false),
                },
            ]),
        );
        let user_a = SessionEvent {
            event_id: SessionEventId::new(),
            agent_instance_id: AgentInstanceId::nil(),
            project_id: ProjectId::nil(),
            role: ChatRole::User,
            content: "first turn".into(),
            content_blocks: None,
            thinking: None,
            thinking_duration_ms: None,
            created_at: parse_dt(&None),
            in_flight: None,
        };
        let recent_assistant = assistant_event(
            "",
            Some(vec![
                ChatContentBlock::ToolUse {
                    id: "tool-new".into(),
                    name: "list_agents".into(),
                    input: serde_json::json!({}),
                },
                ChatContentBlock::ToolResult {
                    tool_use_id: "tool-new".into(),
                    content: big_recent.clone(),
                    is_error: Some(false),
                },
            ]),
        );
        let user_b = SessionEvent {
            event_id: SessionEventId::new(),
            agent_instance_id: AgentInstanceId::nil(),
            project_id: ProjectId::nil(),
            role: ChatRole::User,
            content: "second turn".into(),
            content_blocks: None,
            thinking: None,
            thinking_duration_ms: None,
            created_at: parse_dt(&None),
            in_flight: None,
        };

        let history = session_events_to_conversation_history(&[
            old_assistant,
            user_a,
            recent_assistant,
            user_b,
        ]);

        // Old turn: capped at TOOL_BLOB_OLD_MAX_BYTES (256).
        let old_rendered = &history[0].content;
        assert!(
            old_rendered.len() < 1_000,
            "old assistant turn should be tightly capped, got {} bytes",
            old_rendered.len()
        );
        assert!(old_rendered.contains("[truncated 12000 bytes]"));

        // Recent turn: capped at TOOL_BLOB_MAX_BYTES (2048), so bigger
        // than old but still well under the raw 12KB.
        let recent_rendered = &history[2].content;
        assert!(
            recent_rendered.len() > old_rendered.len(),
            "recent window must keep more context than old window"
        );
        assert!(recent_rendered.contains("[truncated 12000 bytes]"));
        assert!(recent_rendered.len() < 4_000);
    }

    fn spec(title: &str, order_index: u32) -> Spec {
        Spec {
            spec_id: aura_os_core::SpecId::new(),
            project_id: ProjectId::nil(),
            title: title.to_string(),
            order_index,
            markdown_contents: String::new(),
            created_at: parse_dt(&None),
            updated_at: parse_dt(&None),
        }
    }

    fn task(title: &str, spec_id: aura_os_core::SpecId) -> Task {
        Task {
            task_id: aura_os_core::TaskId::new(),
            project_id: ProjectId::nil(),
            spec_id,
            title: title.to_string(),
            description: String::new(),
            status: aura_os_core::TaskStatus::Backlog,
            order_index: 0,
            dependency_ids: Vec::new(),
            parent_task_id: None,
            skip_auto_decompose: false,
            assigned_agent_instance_id: None,
            completed_by_agent_instance_id: None,
            session_id: None,
            execution_notes: String::new(),
            files_changed: Vec::new(),
            live_output: String::new(),
            build_steps: Vec::new(),
            test_steps: Vec::new(),
            user_id: None,
            model: None,
            total_input_tokens: 0,
            total_output_tokens: 0,
            created_at: parse_dt(&None),
            updated_at: parse_dt(&None),
        }
    }

    #[test]
    fn project_state_snapshot_formats_recent_specs_and_tasks() {
        let lemonade = spec("01: Make Lemonade", 1);
        let tea = spec("02: Make Tea", 2);
        let tasks = vec![
            task("Gather ingredients and tools", lemonade.spec_id),
            task("Juice and mix lemonade", lemonade.spec_id),
            task("Boil water", tea.spec_id),
        ];

        let snapshot =
            format_project_state_snapshot(&[lemonade.clone(), tea.clone()], &tasks).unwrap();

        assert!(snapshot.contains("Recent specs:"));
        assert!(snapshot.contains("01: Make Lemonade"));
        assert!(snapshot.contains("Recent tasks:"));
        assert!(snapshot.contains("Gather ingredients and tools"));
        assert!(snapshot.contains("(spec: 01: Make Lemonade)"));
    }

    #[test]
    fn project_state_snapshot_prompt_appends_snapshot_safely() {
        let prompt = append_project_state_to_system_prompt(
            "You are a helpful coding agent.",
            Some("Current durable project state from persisted Aura records:\nRecent specs:\n- 01: Make Lemonade"),
        );

        assert!(prompt.contains("You are a helpful coding agent."));
        assert!(prompt.contains("persisted Aura records"));
        assert!(prompt.contains("01: Make Lemonade"));
    }
}
