//! Server-side capture of subagent (child `task` run) transcripts into
//! their own durable storage session, so a subagent thread persists and
//! reloads like a normal chat instead of vanishing when the live child
//! harness run is reaped.
//!
//! A parent chat turn that calls the `task` tool spawns a child harness
//! run and emits `SubagentSpawned` on the PARENT stream.
//! [`maybe_spawn_subagent_capture`] subscribes a fresh receiver to that
//! parent broadcast and, for each spawned child, creates a dedicated
//! subagent session, persists the spawn prompt, writes a
//! [`SUBAGENT_SESSION_LINK_EVENT`] linkage row into the parent session
//! (so a history reopen can find the child session), and drains the
//! child run's events into the subagent session via the same per-event
//! dispatch the chat task uses.

mod capture;

use std::sync::Arc;

use aura_os_core::SessionId;
use aura_os_harness::{HarnessLink, HarnessOutbound};
use aura_os_sessions::SessionService;
use aura_os_storage::StorageClient;
use tokio::sync::broadcast;
use tracing::warn;

use super::persist::ChatPersistCtx;
use crate::state::AppState;

use capture::{capture_spawned_subagent, SpawnInfo};

/// Event type written into the PARENT session linking a child run to the
/// dedicated subagent storage session that holds its transcript. Read by
/// the session-history reconstruction fold to stamp `subagent_session_id`
/// onto the originating `task` tool_use block so a history-reopened card
/// can fetch the persisted child transcript.
pub(crate) const SUBAGENT_SESSION_LINK_EVENT: &str = "subagent_session";

/// Sentinel stored in a subagent session's `summary_of_previous_context`
/// so the user-facing session-list handlers can filter these nested
/// sessions out of the sidebar — they surface inside the parent chat as
/// subagent panes, never as top-level chats. The `\u{1}` prefix keeps the
/// marker out of any plausible human-authored summary.
pub(crate) const SUBAGENT_SESSION_SUMMARY_MARKER: &str = "\u{1}aura:subagent-session";

/// `true` when a session summary carries the subagent sentinel, i.e. the
/// session is a nested subagent transcript that must not appear in the
/// user's chat sidebar.
pub(crate) fn is_subagent_session_summary(summary: &str) -> bool {
    summary == SUBAGENT_SESSION_SUMMARY_MARKER
}

/// Handles needed to capture a parent turn's subagents. Cloned out of
/// `AppState` at the orchestration boundary so the spawned watcher owns
/// its dependencies for the lifetime of the turn.
#[derive(Clone)]
pub(crate) struct SubagentCaptureCtx {
    pub(super) storage: Arc<StorageClient>,
    pub(super) session_service: Arc<SessionService>,
    pub(super) harness: Arc<dyn HarnessLink>,
    pub(super) jwt: String,
    pub(super) user_id: Option<String>,
    pub(super) parent_session_id: SessionId,
    pub(super) project_agent_id: String,
    pub(super) project_id: String,
    pub(super) model: Option<String>,
}

/// Spawn a per-turn watcher that captures every subagent the parent turn
/// spawns. No-op when storage is not configured (subagent transcripts
/// have nowhere durable to land). Subscribes a FRESH receiver to the
/// parent harness broadcast so it observes `SubagentSpawned` without
/// stealing frames from the SSE / persist fan-out.
pub(crate) fn maybe_spawn_subagent_capture(
    state: &AppState,
    parent_ctx: &ChatPersistCtx,
    events_tx: &broadcast::Sender<HarnessOutbound>,
    model: Option<String>,
) {
    let Some(storage) = state.storage_client.clone() else {
        return;
    };
    let ctx = SubagentCaptureCtx {
        storage,
        session_service: state.session_service.clone(),
        harness: state.local_harness.clone(),
        jwt: parent_ctx.jwt.clone(),
        user_id: parent_ctx.user_id.clone(),
        parent_session_id: parent_ctx.session_id,
        project_agent_id: parent_ctx.project_agent_id.clone(),
        project_id: parent_ctx.project_id.clone(),
        model,
    };
    spawn_capture_watcher(ctx, events_tx.subscribe());
}

/// Per-turn watcher loop. Captures each `SubagentSpawned` on the parent
/// broadcast and stops at the turn's terminal event so it never double-
/// captures a child already handled by a prior turn's watcher (the parent
/// broadcast is reused across turns).
fn spawn_capture_watcher(ctx: SubagentCaptureCtx, mut rx: broadcast::Receiver<HarnessOutbound>) {
    tokio::spawn(async move {
        loop {
            match rx.recv().await {
                Ok(HarnessOutbound::SubagentSpawned(spawned)) => {
                    capture_spawned_subagent(
                        &ctx,
                        SpawnInfo {
                            child_run_id: spawned.child_run_id,
                            parent_tool_use_id: spawned.parent_tool_use_id,
                            subagent_type: spawned.subagent_type,
                            prompt: spawned.prompt,
                        },
                    )
                    .await;
                }
                Ok(HarnessOutbound::AssistantMessageEnd(_)) | Ok(HarnessOutbound::Error(_)) => {
                    break;
                }
                Ok(_) => {}
                Err(broadcast::error::RecvError::Closed) => break,
                Err(broadcast::error::RecvError::Lagged(skipped)) => {
                    warn!(
                        parent_session_id = %ctx.parent_session_id,
                        skipped,
                        "subagent capture watcher lagged; continuing to drain parent stream"
                    );
                }
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn subagent_summary_marker_is_recognized() {
        assert!(is_subagent_session_summary(SUBAGENT_SESSION_SUMMARY_MARKER));
    }

    #[test]
    fn ordinary_summaries_are_not_treated_as_subagent_sessions() {
        assert!(!is_subagent_session_summary(""));
        assert!(!is_subagent_session_summary("Logo Addition Request"));
        assert!(!is_subagent_session_summary("aura:subagent-session"));
    }
}
