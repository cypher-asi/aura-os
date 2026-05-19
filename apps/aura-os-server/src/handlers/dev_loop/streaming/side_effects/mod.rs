//! Side-effects triggered by individual harness events: enriches the payload, broadcasts to live subscribers + the topic-scoped event hub, and dispatches into focused submodules (failure persistence + test-evidence override, retry plumbing, git checkpoints, task-output cache, cross-turn file-change merging).

mod common;
mod failure;
mod files;
mod git;
mod retry;
mod task_output;

use std::str::FromStr;

use aura_os_core::{AgentInstanceId, ProjectId, SessionId, TaskId};
use aura_os_events::{DomainEvent, LegacyJsonEvent};

use super::super::session::record_task_worked;
use super::super::signals::extract_task_failure_context;
use super::super::types::LoopRetryState;
use crate::state::AppState;

use common::{enrich_event, set_current_task};

pub(crate) use failure::extract_task_failure_reason;
pub(crate) use task_output::seed_task_output;

#[allow(clippy::too_many_arguments)]
pub(super) async fn record_event_side_effects(
    state: &AppState,
    project_id: ProjectId,
    agent_instance_id: AgentInstanceId,
    fallback_task_id: Option<String>,
    event: serde_json::Value,
    event_type: &str,
    jwt: Option<&str>,
    session_id: Option<SessionId>,
    retry_state: &LoopRetryState,
) {
    let task_id = event
        .get("task_id")
        .and_then(|value| value.as_str())
        .map(str::to_string)
        .or(fallback_task_id);
    let mut enriched = enrich_event(
        event.clone(),
        project_id,
        agent_instance_id,
        task_id.as_deref(),
        session_id,
    );
    if event_type == "task_failed" {
        let reason = extract_task_failure_reason(&enriched);
        let ctx = extract_task_failure_context(&enriched, reason.as_deref());
        if ctx.has_any() {
            if let Some(object) = enriched.as_object_mut() {
                ctx.merge_into(object);
            }
        }
    }

    // Tests-as-truth override: if this is a CompletionContract
    // `task_failed` and we accumulated successful test-runner evidence
    // earlier in the run, transition the task to Done in storage and
    // **replace** the broadcast payload with a synthetic
    // `task_completed`. Doing this before any broadcast avoids
    // briefly showing the failure to live subscribers when we already
    // know we're going to override it.
    let mut effective_event_type: &str = event_type;
    let mut broadcast_payload = enriched;
    if event_type == "task_failed" {
        if let (Some(task_id_str), Some(jwt)) = (task_id.as_deref(), jwt) {
            if let Some(synthetic) = failure::maybe_apply_test_evidence_override(
                state,
                project_id,
                agent_instance_id,
                task_id_str,
                jwt,
                &event,
                session_id,
            )
            .await
            {
                broadcast_payload = synthetic;
                effective_event_type = "task_completed";
            }
        }
    }

    let _ = state.event_broadcast.send(broadcast_payload.clone());
    state
        .event_hub
        .publish(DomainEvent::LegacyJson(LegacyJsonEvent {
            project_id: Some(project_id),
            agent_instance_id: Some(agent_instance_id),
            session_id,
            loop_id: None,
            payload: broadcast_payload,
        }));

    apply_event_side_effect(
        state,
        project_id,
        agent_instance_id,
        effective_event_type,
        task_id.as_deref(),
        &event,
        jwt,
        session_id,
        retry_state,
    )
    .await;
}

#[allow(clippy::too_many_arguments)]
async fn apply_event_side_effect(
    state: &AppState,
    project_id: ProjectId,
    agent_instance_id: AgentInstanceId,
    event_type: &str,
    task_id: Option<&str>,
    event: &serde_json::Value,
    jwt: Option<&str>,
    session_id: Option<SessionId>,
    retry_state: &LoopRetryState,
) {
    match event_type {
        "task_started" => {
            if let Some(task_id) = task_id {
                seed_task_output(state, project_id, agent_instance_id, task_id).await;
                set_current_task(
                    state,
                    project_id,
                    agent_instance_id,
                    Some(task_id.to_string()),
                )
                .await;
                // Increment `tasks_worked_count` on the storage session
                // so per-session stats reflect automation activity too.
                if let Some(session_id) = session_id {
                    record_task_worked(
                        &state.session_service,
                        project_id,
                        agent_instance_id,
                        session_id,
                        task_id,
                    )
                    .await;
                }
            }
        }
        "task_completed" => {
            set_current_task(state, project_id, agent_instance_id, None).await;
            // Clear the per-task retry counters now that the task has
            // reached a clean terminal: a subsequent run of the same
            // task (e.g. via the manual rerun path) starts from a
            // fresh budget rather than inheriting stale failures.
            if let Some(task_uuid) = task_id.and_then(|s| TaskId::from_str(s).ok()) {
                retry_state.tool_retry.clear(task_uuid);
                retry_state.task_retry.clear(task_uuid);
            }
            // Drain the in-memory `task_output_cache` (tokens, files-
            // changed, live output, build/test/git steps) into the
            // persisted aura-storage task record + session events.
            // Without this, tokens accumulated in `update_usage_cache`
            // are silently discarded when the cache is evicted,
            // leaving the dashboard "Tokens" stat at 0.
            if let (Some(task_id), Some(jwt)) = (task_id, jwt) {
                task_output::persist_cached_task_output(state, project_id, jwt, task_id).await;
            }
        }
        "task_failed" => {
            set_current_task(state, project_id, agent_instance_id, None).await;
            // Persist the fail reason onto `tasks.execution_notes` so
            // it survives a page reload. The live WebSocket path
            // already carries the reason to `useTaskStatus`, but that
            // state resets to `null` on mount; without this write,
            // "Copy All Output" on a reloaded failed task has no
            // reason to render (the hook has nothing to seed from).
            //
            // Section B: when the harness emits `task_failed` without
            // a usable reason field, the persistence helper falls
            // back to `synthesize_failure_reason` so the row never
            // shows the silent "Task failed without producing
            // output" state on reload.
            if let (Some(task_id), Some(jwt)) = (task_id, jwt) {
                failure::persist_task_failure_reason(state, jwt, task_id, event).await;
                // Same accumulator drain as task_completed: failed tasks
                // also have token usage that should appear in stats.
                task_output::persist_cached_task_output(state, project_id, jwt, task_id).await;
                // Section E: task-level auto-retry. We only push the
                // task back to `Ready` when the failure reason is
                // retryable (transient classifier accepted it) and
                // the per-task task-level budget has not been
                // exhausted. On `GiveUp` the task stays `Failed` and
                // the existing surfaces handle it.
                retry::maybe_apply_task_level_retry(
                    state,
                    jwt,
                    task_id,
                    event,
                    retry_state,
                    project_id,
                    agent_instance_id,
                    session_id,
                )
                .await;
            }
        }
        "tool_call_completed" => {
            if let Some(task_id) = task_id {
                task_output::record_test_pass_evidence(state, project_id, task_id, event).await;
                git::record_git_commit_push_timeout(state, project_id, task_id, event).await;
            }
        }
        "tool_result" => {
            // Section D: track tool-call failures against
            // `TOOL_CALL_RETRY_BUDGET`. On `Retry`, emit a
            // `task_retrying` UI signal carrying the current attempt
            // count so the surface can render the recovery state.
            // On `GiveUp`, fall through silently — the
            // `task_failed` arm (above) will fire next and handle
            // the terminal path.
            if let Some(task_id) = task_id {
                retry::maybe_track_tool_call_failure(
                    state,
                    project_id,
                    agent_instance_id,
                    task_id,
                    event,
                    retry_state,
                    session_id,
                )
                .await;
            }
        }
        "git_committed" | "commit_created" | "git_commit_failed" | "git_pushed"
        | "push_succeeded" | "git_push_failed" | "push_failed" => {
            if let Some(task_id) = task_id {
                git::record_git_checkpoint(state, project_id, task_id, event_type, event).await;
            }
        }
        "text_delta" => {
            if let Some((task_id, text)) = task_id.zip(common::event_text(event)) {
                task_output::append_task_output(state, project_id, task_id, text).await;
            }
        }
        "token_usage" | "assistant_message_end" | "usage" | "session_usage" => {
            if let Some(task_id) = task_id.as_deref() {
                task_output::update_usage_cache(state, project_id, task_id, event).await;
            }
            if event_type == "assistant_message_end" {
                if let Some(task_id) = task_id.as_deref() {
                    files::record_files_changed(state, project_id, task_id, event).await;
                }
            }
        }
        _ => {}
    }
}
