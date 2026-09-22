//! Create-session / persist-prompt / link / attach-and-drain steps for
//! one spawned subagent. Split out of `mod.rs` so each step is a small,
//! single-purpose helper.

use serde_json::json;
use tracing::warn;

use aura_os_core::SessionId;
use aura_os_harness::{HarnessOutbound, HarnessSession};
use aura_os_sessions::CreateSessionParams;
use tokio::sync::broadcast;

use super::super::persist::{persist_user_message, ChatPersistCtx};
use super::super::persist_task::{
    is_terminal_turn_event, persist_event, reset_per_turn_state, PersistTaskState,
};
use super::super::persist_task_dispatch::handle_outbound;
use super::{SubagentCaptureCtx, SUBAGENT_SESSION_LINK_EVENT, SUBAGENT_SESSION_SUMMARY_MARKER};

/// The fields of a `SubagentSpawned` event the capture path needs. Owned
/// so the watcher can hand it across the `.await` boundary without
/// borrowing the harness event.
pub(super) struct SpawnInfo {
    pub(super) child_run_id: String,
    pub(super) parent_tool_use_id: Option<String>,
    pub(super) subagent_type: String,
    pub(super) prompt: String,
}

/// Capture one spawned subagent: create its session, persist the spawn
/// prompt as the opening user turn, link it back to the parent session,
/// then attach to the child run and drain its transcript.
pub(super) async fn capture_spawned_subagent(ctx: &SubagentCaptureCtx, info: SpawnInfo) {
    let Some(sub_session_id) = create_subagent_session(ctx).await else {
        return;
    };
    let child_ctx = build_persist_ctx(ctx, sub_session_id);
    if let Err(error) = persist_user_message(&child_ctx, &info.prompt, &None).await {
        warn!(
            %error,
            child_run_id = %info.child_run_id,
            "subagent capture: failed to persist spawn prompt"
        );
    }
    write_session_link(ctx, &info, &sub_session_id).await;
    attach_and_drain(ctx, child_ctx, &info.child_run_id).await;
}

/// Create the dedicated storage session that holds the subagent's
/// transcript, tagged with the subagent sentinel summary so it stays out
/// of the user's chat sidebar. Returns `None` (and logs) on any failure
/// so a capture problem never takes down the parent turn.
async fn create_subagent_session(ctx: &SubagentCaptureCtx) -> Option<SessionId> {
    let agent_instance_id = ctx
        .project_agent_id
        .parse()
        .map_err(|error| {
            warn!(%error, project_agent_id = %ctx.project_agent_id, "subagent capture: bad project_agent_id");
        })
        .ok()?;
    let project_id = ctx
        .project_id
        .parse()
        .map_err(|error| {
            warn!(%error, project_id = %ctx.project_id, "subagent capture: bad project_id");
        })
        .ok()?;
    let params = CreateSessionParams {
        agent_instance_id,
        project_id,
        active_task_id: None,
        summary: SUBAGENT_SESSION_SUMMARY_MARKER.to_string(),
        user_id: None,
        model: ctx.model.clone(),
    };
    match ctx.session_service.create_session(params).await {
        Ok(session) => Some(session.session_id),
        Err(error) => {
            warn!(%error, "subagent capture: failed to create subagent session");
            None
        }
    }
}

/// Build a [`ChatPersistCtx`] targeting `session_id` under the parent's
/// project/agent binding. Used for both the subagent session (child
/// transcript) and the parent session (linkage event).
fn build_persist_ctx(ctx: &SubagentCaptureCtx, session_id: SessionId) -> ChatPersistCtx {
    ChatPersistCtx {
        storage: ctx.storage.clone(),
        jwt: ctx.jwt.clone(),
        user_id: ctx.user_id.clone(),
        session_id,
        project_agent_id: ctx.project_agent_id.clone(),
        project_id: ctx.project_id.clone(),
        agent_id: None,
        originating_agent_id: None,
        cross_agent_depth: 0,
        from_agent_id: None,
    }
}

/// Persist the child-run → subagent-session mapping into the PARENT
/// session so a history reopen can locate (and fetch) the child
/// transcript after the live run has been reaped.
async fn write_session_link(
    ctx: &SubagentCaptureCtx,
    info: &SpawnInfo,
    sub_session_id: &SessionId,
) {
    let parent_ctx = build_persist_ctx(ctx, ctx.parent_session_id);
    let persisted = persist_event(
        &parent_ctx,
        SUBAGENT_SESSION_LINK_EVENT,
        json!({
            "child_run_id": info.child_run_id,
            "subagent_session_id": sub_session_id.to_string(),
            "parent_tool_use_id": info.parent_tool_use_id,
            "subagent_type": info.subagent_type,
        }),
    )
    .await;
    if !persisted {
        warn!(
            child_run_id = %info.child_run_id,
            "subagent capture: failed to write subagent_session link into parent session"
        );
    }
}

/// Attach server-side to the child harness run and spawn the multi-turn
/// drain that persists its transcript. Best-effort: a failed attach is
/// logged and skipped (the spawn prompt + linkage are already saved).
async fn attach_and_drain(ctx: &SubagentCaptureCtx, child_ctx: ChatPersistCtx, child_run_id: &str) {
    match ctx
        .harness
        .attach_run(child_run_id, Some(&ctx.jwt), false)
        .await
    {
        Ok(mut session) => {
            // Adopt the primed receiver so the child run's replay-on-attach
            // burst is persisted even when the run already finished before
            // capture attached (a late `events_tx.subscribe()` would drop
            // it, leaving the persisted transcript empty after reload).
            let rx = session
                .events_rx
                .take()
                .unwrap_or_else(|| session.events_tx.subscribe());
            tokio::spawn(run_subagent_persist_loop(rx, child_ctx, session));
        }
        Err(error) => {
            warn!(
                %error,
                %child_run_id,
                "subagent capture: failed to attach to child run; transcript not persisted"
            );
        }
    }
}

/// Drain a child run's harness events into its subagent session. Unlike
/// the single-turn chat persist loop this keeps draining across every
/// assistant turn (a subagent runs many turns autonomously), resetting
/// per-turn accumulators between turns, until the child run terminates
/// and closes the broadcast. Owns `_session` so the child WS stays alive
/// until the run ends even if no UI client ever attaches.
async fn run_subagent_persist_loop(
    mut rx: broadcast::Receiver<HarnessOutbound>,
    ctx: ChatPersistCtx,
    _session: HarnessSession,
) {
    // Orphaned sink: `handle_outbound` publishes chat-shaped WS events on
    // its terminal arms; the subagent session has no chat panel, so we
    // drop those into a receiver-less channel instead of leaking them
    // onto the real event bus.
    let (event_bus, _) = broadcast::channel::<serde_json::Value>(1);
    let mut state = PersistTaskState::new();
    loop {
        match rx.recv().await {
            Ok(evt) => {
                state.seq += 1;
                let _ = handle_outbound(&mut state, &ctx, &event_bus, &evt, None).await;
                if is_terminal_turn_event(&evt) {
                    reset_per_turn_state(&mut state);
                }
            }
            Err(broadcast::error::RecvError::Closed) => break,
            Err(broadcast::error::RecvError::Lagged(skipped)) => {
                warn!(
                    session_id = %ctx.session_id,
                    skipped,
                    "subagent persist loop lagged; continuing to drain child stream"
                );
            }
        }
    }
}
