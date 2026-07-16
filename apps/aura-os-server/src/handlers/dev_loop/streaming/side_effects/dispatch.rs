//! Per-event-type dispatch helpers for the dev-loop side-effects
//! pipeline. The orchestrator in `mod.rs` calls
//! [`apply_event_side_effect`] once per event after enrichment and
//! workspace-health gating; this module owns the thin `match` and the
//! per-arm helpers it routes into. No business logic lives here ---
//! each arm just calls into the existing focused submodule
//! (`failure`, `files`, `git`, `retry`, `task_output`).

use std::str::FromStr;

use aura_os_core::TaskId;
use tracing::info;

use super::super::super::session::{record_task_worked, RecordTaskWorkedInputs};
use super::super::super::signals::{health_gate_enabled, snapshot_workspace_health};
use super::common::{event_text, set_current_task};
use super::{failure, files, git, retry, task_output, SideEffectCtx};
use crate::handlers::projects_helpers::{
    resolve_agent_instance_workspace_path, server_can_inspect_agent_workspace,
};

/// Route an enriched (and possibly health-gate-demoted) engine event
/// into the per-arm helper that owns the side-effects for that event
/// type. The match is the single source of truth for which event
/// types currently produce a side-effect; everything else falls
/// through to the catch-all and is forwarded only via the upstream
/// broadcast.
pub(super) async fn apply_event_side_effect(
    ctx: &SideEffectCtx<'_>,
    event_type: &str,
    task_id: Option<&str>,
    event: &serde_json::Value,
) {
    match event_type {
        "task_started" => task_started_side_effects(ctx, task_id).await,
        "task_completed" => task_completed(ctx, task_id).await,
        "task_failed" => task_failed(ctx, task_id, event).await,
        "tool_call_completed" => tool_call_completed(ctx, task_id, event).await,
        "git_committed" | "commit_created" | "git_commit_failed" | "git_pushed"
        | "push_succeeded" | "git_push_failed" | "push_failed" => {
            git_lifecycle(ctx, task_id, event_type, event).await;
        }
        "text_delta" => text_delta(ctx, task_id, event).await,
        "token_usage" | "assistant_message_end" | "usage" | "session_usage" => {
            usage_or_turn_end(ctx, task_id, event_type, event).await;
        }
        _ => {}
    }
}

/// Shared body for explicit `task_started` events and the implicit
/// bind shim in [`super::implicit_task`].
pub(super) async fn task_started_side_effects(ctx: &SideEffectCtx<'_>, task_id: Option<&str>) {
    let Some(task_id) = task_id else { return };
    info!(
        target: "aura::automation",
        project_id = %ctx.project_id,
        agent_instance_id = %ctx.agent_instance_id,
        task_id = task_id,
        "automation task started"
    );
    task_output::seed_task_output(
        ctx.state,
        ctx.project_id,
        ctx.agent_instance_id,
        ctx.session_id,
        task_id,
    )
    .await;
    set_current_task(ctx.loop_handle, Some(task_id.to_string())).await;
    if let Some(session_id) = ctx.session_id {
        record_task_worked(RecordTaskWorkedInputs {
            state: ctx.state,
            jwt: ctx.jwt,
            project_id: ctx.project_id,
            agent_instance_id: ctx.agent_instance_id,
            session_id,
            task_id_str: task_id,
        })
        .await;
    }
    spawn_health_baseline_snapshot(ctx, task_id).await;
}

/// Workspace-health baseline. Captures the build state at task start
/// so the completion gate can compare against task_done. Runs in the
/// background so it never adds claim latency; if it doesn't finish
/// before task_done, the gate falls back to "unknown baseline".
async fn spawn_health_baseline_snapshot(ctx: &SideEffectCtx<'_>, task_id: &str) {
    if !health_gate_enabled()
        || !server_can_inspect_agent_workspace(ctx.state, &ctx.project_id, ctx.agent_instance_id)
            .await
    {
        return;
    }
    let Ok(task_uuid) = TaskId::from_str(task_id) else {
        return;
    };
    let Some(workspace_path) = resolve_agent_instance_workspace_path(
        ctx.state,
        &ctx.project_id,
        Some(ctx.agent_instance_id),
    )
    .await
    else {
        return;
    };
    let retry_state_for_snapshot = ctx.retry_state.clone();
    tokio::spawn(async move {
        let health = snapshot_workspace_health(workspace_path).await;
        retry_state_for_snapshot
            .health_baseline
            .record(task_uuid, health);
    });
}

/// `task_completed`: clear the current-task pointer, drop the
/// workspace-health baseline (so a rerun starts fresh), and drain the
/// in-memory `task_output_cache` into the persisted aura-storage
/// record. Without the drain, tokens accumulated in
/// `update_usage_cache` are silently discarded when the cache is
/// evicted, leaving the dashboard "Tokens" stat at 0.
async fn task_completed(ctx: &SideEffectCtx<'_>, task_id: Option<&str>) {
    info!(
        target: "aura::automation",
        project_id = %ctx.project_id,
        agent_instance_id = %ctx.agent_instance_id,
        task_id = task_id.unwrap_or(""),
        "automation task completed"
    );
    set_current_task(ctx.loop_handle, None).await;
    if let Some(task_uuid) = task_id.and_then(|s| TaskId::from_str(s).ok()) {
        ctx.retry_state.health_baseline.clear(task_uuid);
    }
    if let (Some(task_id), Some(jwt)) = (task_id, ctx.jwt) {
        task_output::persist_cached_task_output(
            ctx.state,
            ctx.project_id,
            jwt,
            task_id,
            ctx.session_id,
        )
        .await;
    }
}

/// `task_failed`: clear the current-task pointer and the
/// workspace-health baseline, persist the fail reason onto
/// `tasks.execution_notes` (so "Copy All Output" on a reloaded failed
/// task has something to render), drain the token-usage cache, and
/// finally dispatch to the task-level auto-retry helper which decides
/// whether to push the task back to `Ready` based on
/// `HarnessFailureKind::is_retryable` and the persisted attempts
/// counter.
async fn task_failed(ctx: &SideEffectCtx<'_>, task_id: Option<&str>, event: &serde_json::Value) {
    info!(
        target: "aura::automation",
        project_id = %ctx.project_id,
        agent_instance_id = %ctx.agent_instance_id,
        task_id = task_id.unwrap_or(""),
        reason = failure::extract_task_failure_reason(event).as_deref().unwrap_or(""),
        "automation task failed"
    );
    set_current_task(ctx.loop_handle, None).await;
    if let Some(task_uuid) = task_id.and_then(|s| TaskId::from_str(s).ok()) {
        ctx.retry_state.health_baseline.clear(task_uuid);
    }
    let (Some(task_id), Some(jwt)) = (task_id, ctx.jwt) else {
        return;
    };
    failure::persist_task_failure_reason(ctx.state, jwt, task_id, event).await;
    task_output::persist_cached_task_output(
        ctx.state,
        ctx.project_id,
        jwt,
        task_id,
        ctx.session_id,
    )
    .await;
    retry::maybe_apply_task_level_retry(ctx, task_id, event).await;
}

/// `tool_call_completed`: record test-pass evidence (so a completion
/// that claims tests pass can be verified against the harness's
/// actual tool calls) and stamp git push/commit timeouts on the task
/// row for the dashboard.
async fn tool_call_completed(
    ctx: &SideEffectCtx<'_>,
    task_id: Option<&str>,
    event: &serde_json::Value,
) {
    let Some(task_id) = task_id else { return };
    let input_summary = super::super::tool_summary::tool_input_summary(event).unwrap_or_default();
    let result_preview = super::super::tool_summary::tool_result_preview(event).unwrap_or_default();
    let duration_ms = super::super::tool_summary::event_duration_ms(event);
    info!(
        target: "aura::automation",
        project_id = %ctx.project_id,
        agent_instance_id = %ctx.agent_instance_id,
        task_id = task_id,
        tool = %tool_name(event),
        input = %input_summary,
        is_error = event.get("is_error").and_then(|v| v.as_bool()).unwrap_or(false),
        duration_ms = ?duration_ms,
        result = %result_preview,
        "automation tool call completed"
    );
    task_output::record_test_pass_evidence(ctx.state, ctx.project_id, task_id, event).await;
    git::record_git_commit_push_timeout(ctx.state, ctx.project_id, task_id, event).await;
}

/// Tool name from a `tool_call_completed` event payload, falling
/// back to a generic label. Kept local to this module so the
/// dispatch arm doesn't reach into the harness collector's private
/// helpers; mirrors the same key precedence the activity-side
/// helper uses.
fn tool_name(event: &serde_json::Value) -> &str {
    event
        .get("name")
        .and_then(|v| v.as_str())
        .or_else(|| event.get("tool_name").and_then(|v| v.as_str()))
        .or_else(|| event.get("tool").and_then(|v| v.as_str()))
        .unwrap_or("tool")
}

/// Git checkpoint events (commit / push, success / failure). Each
/// arm fans out to the same persistence helper which records the
/// checkpoint kind verbatim so the dashboard can render the git
/// activity timeline.
async fn git_lifecycle(
    ctx: &SideEffectCtx<'_>,
    task_id: Option<&str>,
    event_type: &str,
    event: &serde_json::Value,
) {
    let Some(task_id) = task_id else { return };
    info!(
        target: "aura::automation",
        project_id = %ctx.project_id,
        agent_instance_id = %ctx.agent_instance_id,
        task_id = task_id,
        event_type = event_type,
        "automation git checkpoint"
    );
    git::record_git_checkpoint(ctx.state, ctx.project_id, task_id, event_type, event).await;
}

/// `text_delta`: append the streamed text fragment to the per-task
/// live-output buffer so the dashboard's "Live Output" panel renders
/// the LLM's running response without waiting for the assistant turn
/// to end.
async fn text_delta(ctx: &SideEffectCtx<'_>, task_id: Option<&str>, event: &serde_json::Value) {
    if let Some((task_id, text)) = task_id.zip(event_text(event)) {
        task_output::append_task_output(ctx.state, ctx.project_id, task_id, text).await;
    }
}

/// Usage / turn-end events: update the in-memory token-usage cache
/// for the active task and, on `assistant_message_end`, also record
/// the cross-turn files-changed set so the dashboard's files-touched
/// count merges across turns instead of being overwritten by the
/// last turn's view.
async fn usage_or_turn_end(
    ctx: &SideEffectCtx<'_>,
    task_id: Option<&str>,
    event_type: &str,
    event: &serde_json::Value,
) {
    if let Some(task_id) = task_id {
        task_output::update_usage_cache(ctx.state, ctx.project_id, task_id, event).await;
    }
    if event_type == "assistant_message_end" {
        if let Some(task_id) = task_id {
            files::record_files_changed(ctx.state, ctx.project_id, task_id, event).await;
        }
    }
}
