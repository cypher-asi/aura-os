//! Chat session resolution: pick the candidate session for a turn
//! (force-new vs pinned vs latest), close stale active sessions
//! before minting a fresh one, and run the auto-fork check on the
//! candidate before handing it back to the caller.

use aura_os_core::SessionId;
use aura_os_storage::StorageClient;
use chrono::Utc;
use tracing::{error, warn};

use super::super::discovery::storage_session_sort_key;
use super::context::{ChatPersistRequest, ChatSessionResolveDeps};
use super::fork::{maybe_auto_fork_chat_session, ResolvedChatSession};

pub(crate) async fn resolve_chat_session_with_pin(
    storage: &StorageClient,
    project_agent_id: &str,
    project_id: &str,
    request: &ChatPersistRequest<'_>,
    deps: &ChatSessionResolveDeps<'_>,
) -> Option<ResolvedChatSession> {
    let candidate = pick_candidate_session(
        storage,
        request.jwt,
        project_agent_id,
        project_id,
        request.force_new,
        request.pinned_session_id,
    )
    .await?;
    // Phase 3 auto-fork: if the candidate session already crossed the
    // context-pressure threshold (either because the persist task
    // flagged it `rolled_over` after the previous turn, or because the
    // persisted `context_usage_estimate` is past the auto-fork mark),
    // mint a fresh session here and route the user message into it.
    // Forking happens NOW (before this user's turn opens) so the
    // harness session config sees the new `aura_session_id` and the
    // SSE stream can emit `progress: forked_for_context` to update
    // `?session=` in the URL.
    match maybe_auto_fork_chat_session(
        storage,
        request.jwt,
        project_agent_id,
        project_id,
        &candidate,
        deps.session_service,
        deps.auto_fork_threshold,
    )
    .await
    {
        Some(fork) => Some(ResolvedChatSession {
            session_id: fork.new_session_id,
            fork: Some(fork),
        }),
        None => Some(ResolvedChatSession {
            session_id: candidate,
            fork: None,
        }),
    }
}

async fn pick_candidate_session(
    storage: &StorageClient,
    jwt: &str,
    project_agent_id: &str,
    project_id: &str,
    force_new: bool,
    pinned_session_id: Option<&SessionId>,
) -> Option<SessionId> {
    // `force_new` wins over `pinned_session_id`: callers that
    // explicitly want a brand-new session (the chat-input "+" button)
    // shouldn't accidentally land in an old session because their
    // URL still has `?session=...`.
    if !force_new {
        if let Some(pinned) = pinned_session_id {
            // Trust the pin if it survived `try_pin_session` upstream;
            // re-validating here would double the round-trip on
            // every turn. Callers (the chat handlers) validate up
            // front and 400 on mismatch before reaching here.
            return Some(*pinned);
        }
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
) -> Option<SessionId> {
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
            let latest = sessions
                .iter()
                .max_by_key(|s| storage_session_sort_key(s))?;
            parse_storage_session_id(&latest.id, project_agent_id)
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
) -> Option<SessionId> {
    let req = aura_os_storage::CreateSessionRequest {
        project_id: project_id.to_string(),
        org_id: None,
        model: None,
        status: Some("active".to_string()),
        context_usage_estimate: None,
        summary_of_previous_context: None,
    };
    match storage.create_session(project_agent_id, jwt, &req).await {
        Ok(session) => parse_storage_session_id(&session.id, project_agent_id),
        Err(e) => {
            error!(error = %e, %project_agent_id, "Failed to create chat session in storage");
            None
        }
    }
}

/// Parse a storage-returned session id into the typed [`SessionId`]
/// at the producer side of the chat persist pipeline. Storage
/// session ids are UUIDs in production; any non-UUID would have to
/// have been written by a bug or an external tool, and we'd rather
/// degrade to "no resolved session" (the chat path's existing
/// soft-fail mode) than carry a poison value through every consumer
/// downstream. The warn! makes the regression visible on the
/// first turn rather than at some downstream point that no longer
/// has the original id in scope.
fn parse_storage_session_id(raw: &str, project_agent_id: &str) -> Option<SessionId> {
    match raw.parse::<SessionId>() {
        Ok(id) => Some(id),
        Err(error) => {
            warn!(
                session_id = %raw,
                %project_agent_id,
                %error,
                "storage returned a non-UUID session id; treating as unresolved \
                 (chat will fall through to the unresolved-session error path)"
            );
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
