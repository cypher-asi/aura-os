//! Context-pressure auto-fork: when the candidate chat session has
//! crossed the rollover threshold, mint a fresh follow-up session
//! and surface the `(previous, new)` id pair so the SSE stream can
//! emit `progress: forked_for_context`.

use aura_os_core::{ProjectId, SessionId};
use aura_os_sessions::SessionService;
use aura_os_storage::StorageClient;
use tracing::{info, warn};

/// Carries the previous-vs-new session id pair when
/// [`super::resolve_chat_session_with_pin`] detected a
/// context-pressure auto-fork (or fell back to the
/// `context_usage_estimate >= threshold` rule when the persist
/// task's `rolled_over` flag never landed). Surfaces through the
/// chat `OpenChatStreamArgs` into `build_sse_stream`, which prepends
/// a single `progress: forked_for_context` SSE event before the
/// usual `connecting` / `queued` prefix so the chat panel can swap
/// `?session=<old>` → `?session=<new>` and show a one-shot soft
/// banner without the user having to click `+`.
///
/// Both ids are typed [`SessionId`]s in memory — the
/// `progress: forked_for_context` SSE payload stringifies them at
/// the emit site so the wire shape (`previous_session_id` /
/// `new_session_id` strings) stays byte-identical.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct ForkInfo {
    pub(crate) previous_session_id: SessionId,
    pub(crate) new_session_id: SessionId,
}

/// Output of [`super::resolve_chat_session_with_pin`]. The new shape
/// carries the resolved `session_id` PLUS the optional [`ForkInfo`]
/// that `build_sse_stream` needs to emit the
/// `progress: forked_for_context` event. Returning a tuple instead
/// of widening `Option<SessionId>` keeps the migration mechanical
/// at the call sites and avoids hiding the fork signal inside an
/// unrelated wrapper.
#[derive(Debug, Clone, Copy)]
pub(crate) struct ResolvedChatSession {
    pub(crate) session_id: SessionId,
    pub(crate) fork: Option<ForkInfo>,
}

/// Inspect the candidate storage session and, if it qualifies for an
/// auto-fork (status `rolled_over` set by the persist task, or
/// `context_usage_estimate` past the configured threshold as a
/// fallback when the summary write failed), mint a fresh session via
/// [`SessionService::create_chat_followup_session`] carrying the
/// previous summary forward.
///
/// Returns `None` when no fork is needed or when minting the new
/// session fails — in the latter case the caller falls back to the
/// candidate so the chat at least lands somewhere instead of erroring
/// the user out of their conversation.
pub(super) async fn maybe_auto_fork_chat_session(
    storage: &StorageClient,
    jwt: &str,
    project_agent_id: &str,
    project_id: &str,
    candidate_session_id: &SessionId,
    session_service: &SessionService,
    auto_fork_threshold: f64,
) -> Option<ForkInfo> {
    // Stringify once at the storage boundary; the rest of this
    // function works with the typed id.
    let candidate_id_str = candidate_session_id.to_string();
    let candidate = match storage.get_session(&candidate_id_str, jwt).await {
        Ok(s) => s,
        Err(error) => {
            warn!(
                session_id = %candidate_session_id,
                %error,
                "auto-fork check: failed to load candidate session; skipping fork"
            );
            return None;
        }
    };

    let is_rolled_over = candidate.status.as_deref() == Some("rolled_over");
    let usage_over_threshold = candidate
        .context_usage_estimate
        .map(|usage| usage >= auto_fork_threshold)
        .unwrap_or(false);
    if !is_rolled_over && !usage_over_threshold {
        return None;
    }

    let parsed_project_id = match project_id.parse::<ProjectId>() {
        Ok(p) => p,
        Err(error) => {
            warn!(
                %project_id,
                %error,
                "auto-fork check: project_id is not a valid UUID; skipping fork"
            );
            return None;
        }
    };

    let summary = lookup_rollover_summary(storage, jwt, &candidate_id_str).await;
    let summary = if summary.trim().is_empty() {
        // Fallback path: the persist task failed to write the summary
        // event (or this is the `usage_over_threshold` branch where the
        // `rolled_over` flag never landed). Carry forward a static
        // label so the fresh session at least signals continuity to
        // the user.
        "Continued from a long conversation (no summary available).".to_string()
    } else {
        summary
    };

    match session_service
        .create_chat_followup_session(
            &parsed_project_id,
            project_agent_id,
            candidate_session_id,
            summary,
            candidate.model.clone(),
        )
        .await
    {
        Ok(new_session_id) => {
            info!(
                previous_session_id = %candidate_session_id,
                new_session_id = %new_session_id,
                project_agent_id = %project_agent_id,
                trigger = if is_rolled_over { "rolled_over_flag" } else { "usage_estimate" },
                "Auto-forked chat session at context pressure"
            );
            Some(ForkInfo {
                previous_session_id: *candidate_session_id,
                new_session_id,
            })
        }
        Err(error) => {
            warn!(
                session_id = %candidate_session_id,
                %error,
                "Auto-fork: create_chat_followup_session failed; staying on the candidate session"
            );
            None
        }
    }
}

/// Pull the most recent `rollover_summary` event for `session_id` and
/// extract its `summary` text. Returns the empty string when nothing
/// usable was found (the caller substitutes a static fallback). The
/// chat persist task writes one of these events per auto-fork-trigger
/// turn; reading them here lets the next user send carry the
/// conversation summary forward without re-running the LLM call.
async fn lookup_rollover_summary(storage: &StorageClient, jwt: &str, session_id: &str) -> String {
    let events = match storage.list_events(session_id, jwt, None, None).await {
        Ok(events) => events,
        Err(error) => {
            warn!(
                %session_id,
                %error,
                "auto-fork: list_events failed while looking up rollover_summary"
            );
            return String::new();
        }
    };
    events
        .iter()
        .rev()
        .filter(|evt| evt.event_type.as_deref() == Some("rollover_summary"))
        .find_map(|evt| {
            evt.content
                .as_ref()
                .and_then(|c| c.get("summary"))
                .and_then(|v| v.as_str())
                .map(|s| s.to_string())
        })
        .unwrap_or_default()
}
