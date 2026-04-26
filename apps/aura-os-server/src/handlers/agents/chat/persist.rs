//! Chat persistence context and the lowest-level write paths used by the
//! chat handler: session resolution, retiring stale sessions, and writing
//! the inbound user message.

use std::sync::Arc;

use aura_os_storage::StorageClient;
use chrono::Utc;
use tracing::{error, warn};

use crate::dto::ChatAttachmentDto;

use super::discovery::storage_session_sort_key;

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

pub(super) async fn resolve_chat_session(
    storage: &StorageClient,
    jwt: &str,
    project_agent_id: &str,
    project_id: &str,
    force_new: bool,
) -> Option<String> {
    if !force_new {
        if let Some(existing) = existing_session_for_agent(storage, jwt, project_agent_id).await {
            return Some(existing);
        }
    }
    close_active_sessions_for_agent(storage, jwt, project_agent_id).await;
    create_new_chat_session(storage, jwt, project_agent_id, project_id).await
}

async fn existing_session_for_agent(
    storage: &StorageClient,
    jwt: &str,
    project_agent_id: &str,
) -> Option<String> {
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
            sessions
                .iter()
                .max_by_key(|s| storage_session_sort_key(s))
                .map(|s| s.id.clone())
        }
        Err(e) => {
            warn!(
                %project_agent_id,
                error = %e,
                "Failed to list sessions for chat resolution"
            );
            None
        }
    }
}

async fn create_new_chat_session(
    storage: &StorageClient,
    jwt: &str,
    project_agent_id: &str,
    project_id: &str,
) -> Option<String> {
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
pub(super) async fn close_active_sessions_for_agent(
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
    let payload = build_user_message_payload(content, attachments);
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
            log_user_message_persist_failure(ctx, &e);
            Err(e)
        }
    }
}

fn build_user_message_payload(
    content: &str,
    attachments: &Option<Vec<ChatAttachmentDto>>,
) -> serde_json::Value {
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
    payload
}

fn log_user_message_persist_failure(ctx: &ChatPersistCtx, err: &aura_os_storage::StorageError) {
    let (upstream_status, body_preview) = match err {
        aura_os_storage::StorageError::Server { status, body } => {
            (Some(*status), body.chars().take(400).collect::<String>())
        }
        _ => (None, String::new()),
    };
    error!(
        error = %err,
        upstream_status = ?upstream_status,
        body_preview = %body_preview,
        session_id = %ctx.session_id,
        project_agent_id = %ctx.project_agent_id,
        project_id = %ctx.project_id,
        "Failed to persist user message event"
    );
}
