//! Side-effects triggered by individual harness events. Enriches the
//! payload, broadcasts to live subscribers and the topic-scoped event
//! hub, and dispatches into focused submodules (failure persistence
//! with test-evidence override, retry plumbing, git checkpoints,
//! task-output cache, cross-turn file-change merging, log-line
//! surfacing, and the opt-in workspace-health diff gate). The per-arm
//! dispatch lives in [`dispatch`]; this file is the orchestrator
//! plus shared context glue.

mod common;
mod dispatch;
mod failure;
mod files;
mod git;
mod health_gate;
mod implicit_task;
mod log_lines;
mod retry;
mod task_output;

use std::sync::Arc;

use aura_os_core::{AgentInstanceId, ProjectId, SessionId};
use aura_os_events::{DomainEvent, LegacyJsonEvent};
use aura_os_loops::LoopHandle;

use super::super::signals::extract_task_failure_context;
use super::super::types::LoopRetryState;
use crate::state::AppState;

use common::enrich_event;

pub(crate) use failure::extract_task_failure_reason;
#[cfg(test)]
pub(super) use log_lines::log_line_for_event;
pub(crate) use task_output::seed_task_output;

// Re-export the cross-cutting attempt budget defined in `dev_loop::limits` so
// call sites in `retry.rs` can keep the short `super::MAX_TASK_ATTEMPTS` path.
pub(super) use super::super::limits::MAX_TASK_ATTEMPTS;

/// Bundle of context the side-effects pipeline needs for every
/// event. Grouped into a struct so [`record_event_side_effects`] and
/// [`dispatch::apply_event_side_effect`] stay under the project's
/// argument-count budget (`rules-rust.md`) without needing
/// `#[allow(clippy::too_many_arguments)]`.
///
/// The `loop_handle` borrow is the bug-fix-bearing addition: the
/// forwarder owns an `Arc<LoopHandle>` for the run currently being
/// driven, and we need it here so `task_started` / `task_completed`
/// / `task_failed` can push the typed `TaskId` onto
/// `LoopActivity.current_task_id`. Without that update the per-task
/// UI spinner in `TaskList` cannot bind to a task row and the run
/// looks idle even while the harness is working.
pub(super) struct SideEffectCtx<'a> {
    pub state: &'a AppState,
    pub project_id: ProjectId,
    pub agent_instance_id: AgentInstanceId,
    pub loop_handle: &'a LoopHandle,
    pub jwt: Option<&'a str>,
    pub session_id: Option<SessionId>,
    /// Per-loop retry state, held as a borrow on the Arc the
    /// forwarder owns so the side-effects pipeline can both read
    /// the trackers directly (auto-deref through `Arc`) and clone
    /// the Arc into a `tokio::spawn`ed task without re-wrapping ---
    /// used by the `task_started` workspace-health snapshot to stash
    /// the captured baseline back onto
    /// [`LoopRetryState::health_baseline`].
    pub retry_state: &'a Arc<LoopRetryState>,
}

/// Single entry point for the side-effects pipeline. Enriches the
/// payload, merges any task-failure context, applies the optional
/// workspace-health demotion (`task_completed` -> `task_failed` when
/// the workspace regressed), broadcasts on both event channels,
/// surfaces any free-text log-line for the event, and finally hands
/// off to the per-arm dispatcher.
pub(super) async fn record_event_side_effects(
    ctx: &SideEffectCtx<'_>,
    fallback_task_id: Option<String>,
    event: serde_json::Value,
    event_type: &str,
) {
    let task_id = event
        .get("task_id")
        .and_then(|value| value.as_str())
        .map(str::to_string)
        .or(fallback_task_id);
    implicit_task::maybe_bind_implicit_task(ctx, event_type, task_id.as_deref()).await;
    let mut enriched = enrich_event(
        event.clone(),
        ctx.project_id,
        ctx.agent_instance_id,
        task_id.as_deref(),
        ctx.session_id,
    );
    if event_type == "task_failed" {
        merge_task_failure_context(&mut enriched);
    }
    let (effective_event_type, broadcast_payload) =
        match health_gate::maybe_demote_completed_to_failed(
            ctx,
            event_type,
            task_id.as_deref(),
            &enriched,
        )
        .await
        {
            Some(demoted) => ("task_failed", demoted),
            None => (event_type, enriched),
        };
    broadcast_event(ctx, broadcast_payload);
    log_lines::surface_log_lines_for_event(ctx, effective_event_type, task_id.as_deref(), &event);
    dispatch::apply_event_side_effect(ctx, effective_event_type, task_id.as_deref(), &event).await;
}

/// Merge task-failure context (synthesised reason, structured
/// failure fields) into a `task_failed` enriched payload so
/// downstream subscribers see the same `reason` text the harness
/// classifier consumed.
fn merge_task_failure_context(enriched: &mut serde_json::Value) {
    let reason = extract_task_failure_reason(enriched);
    let failure_ctx = extract_task_failure_context(enriched, reason.as_deref());
    if !failure_ctx.has_any() {
        return;
    }
    if let Some(object) = enriched.as_object_mut() {
        failure_ctx.merge_into(object);
    }
}

/// Forward the broadcast payload onto both the live subscriber
/// channel (`event_broadcast`) and the topic-scoped event hub
/// (`event_hub`). Cloning is intentional: the broadcaster needs to
/// keep its copy for the channel send, and the hub takes ownership
/// for the typed-domain-event publish.
fn broadcast_event(ctx: &SideEffectCtx<'_>, mut payload: serde_json::Value) {
    // Mirror `emit_domain_event_with_session`: guarantee top-level routing
    // keys on every forwarder-routed frame so `/ws/events` consumers can
    // bind rows without peeking into nested payload fields.
    if let Some(object) = payload.as_object_mut() {
        object.insert("project_id".to_string(), ctx.project_id.to_string().into());
        object.insert(
            "agent_instance_id".to_string(),
            ctx.agent_instance_id.to_string().into(),
        );
        if let Some(session_id) = ctx.session_id {
            object.insert("session_id".to_string(), session_id.to_string().into());
        }
        if let Some(user_id) = ctx
            .jwt
            .and_then(|jwt| ctx.state.validation_cache.get(jwt))
            .map(|cached| cached.session.user_id.clone())
        {
            object.insert("user_id".to_string(), user_id.into());
        }
    }
    let _ = ctx.state.event_broadcast.send(payload.clone());
    ctx.state
        .event_hub
        .publish(DomainEvent::LegacyJson(LegacyJsonEvent {
            project_id: Some(ctx.project_id),
            agent_instance_id: Some(ctx.agent_instance_id),
            session_id: ctx.session_id,
            loop_id: None,
            payload,
        }));
}
