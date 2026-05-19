//! Section D / E retry plumbing: classify `tool_result` failures against the per-task tool-call budget, escalate to a task-level `safe_transition(Failed -> Ready)` once the tool budget is exhausted, and emit `task_retrying` signals to live subscribers.

use std::str::FromStr;

use tracing::{info, warn};

use aura_os_automation::{
    should_restart_on_error, RetryDecision, TASK_LEVEL_RETRY_BUDGET, TOOL_CALL_RETRY_BUDGET,
};
use aura_os_core::{AgentInstanceId, ProjectId, SessionId, TaskId, TaskStatus};
use aura_os_events::{DomainEvent, LegacyJsonEvent};

use super::super::super::types::LoopRetryState;
use super::failure::resolve_failure_reason_for_persistence;
use crate::state::AppState;

/// Section D: when a `tool_result` arrives with `is_error: true`
/// and the reason is classified as restartable, increment the
/// per-task tool-call retry tracker and emit a `task_retrying`
/// signal while we are still under
/// [`TOOL_CALL_RETRY_BUDGET`].
///
/// Non-retryable reasons (terminal classifier verdicts like "agent
/// is stuck") are deliberately not tracked here — they fall through
/// to the existing `task_failed` flow without burning the budget.
#[allow(clippy::too_many_arguments)]
pub(super) async fn maybe_track_tool_call_failure(
    state: &AppState,
    project_id: ProjectId,
    agent_instance_id: AgentInstanceId,
    task_id: &str,
    event: &serde_json::Value,
    retry_state: &LoopRetryState,
    session_id: Option<SessionId>,
) {
    if event.get("is_error").and_then(|v| v.as_bool()) != Some(true) {
        return;
    }
    let Some(reason) = tool_result_error_reason(event) else {
        return;
    };
    if !should_restart_on_error(&reason) {
        // Terminal classifier verdict (agent-stuck signal, syntax
        // error, ...): not a retryable infra failure. Leave the
        // budget untouched and let the existing failure path take
        // over.
        return;
    }
    let Ok(task_uuid) = TaskId::from_str(task_id) else {
        return;
    };
    let decision = retry_state.tool_retry.record_failure(task_uuid);
    match decision {
        RetryDecision::Retry { attempt } => {
            emit_task_retrying_signal(
                state,
                project_id,
                agent_instance_id,
                task_id,
                attempt,
                TOOL_CALL_RETRY_BUDGET,
                "tool_call",
                &reason,
                session_id,
            );
        }
        RetryDecision::GiveUp => {
            warn!(
                %task_id,
                budget = TOOL_CALL_RETRY_BUDGET,
                "tool-call retry budget exhausted; falling through to task_failed path"
            );
        }
    }
}

/// Section E: after persisting the failure reason, decide whether
/// the task itself should be pushed back to `Ready` via
/// `safe_transition` so the scheduler can pick it up again.
///
/// Gated by both:
/// * the transient classifier ([`should_restart_on_error`]) accepting
///   the reason — terminal failures (agent-stuck, syntax errors,
///   non-transient provider errors) are not auto-retried; and
/// * the tool-call budget already being exhausted on this task —
///   otherwise the per-tool retry path is still the right recovery
///   surface and a coarser task-level retry would just compound
///   wasted work.
#[allow(clippy::too_many_arguments)]
pub(super) async fn maybe_apply_task_level_retry(
    state: &AppState,
    jwt: &str,
    task_id: &str,
    event: &serde_json::Value,
    retry_state: &LoopRetryState,
    project_id: ProjectId,
    agent_instance_id: AgentInstanceId,
    session_id: Option<SessionId>,
) {
    let Some(storage) = state.storage_client.as_ref() else {
        return;
    };
    let reason = resolve_failure_reason_for_persistence(event);
    if !should_restart_on_error(&reason) {
        return;
    }
    let Ok(task_uuid) = TaskId::from_str(task_id) else {
        return;
    };
    // Only escalate to a task-level retry once the tool-call budget
    // has already exhausted itself. Otherwise the per-tool retry is
    // the right surface and stacking another task-level hop on top
    // just thrashes storage with `Failed -> Ready` cycles.
    if retry_state.tool_retry.attempts(task_uuid) < TOOL_CALL_RETRY_BUDGET {
        return;
    }
    let decision = retry_state.task_retry.record_failure(task_uuid);
    let RetryDecision::Retry { attempt } = decision else {
        return;
    };
    if let Err(error) =
        aura_os_tasks::safe_transition(storage, jwt, task_id, TaskStatus::Ready).await
    {
        warn!(
            %task_id,
            %error,
            "task-level retry: safe_transition(Failed -> Ready) failed; \
             leaving task in Failed"
        );
        return;
    }
    info!(
        %task_id,
        attempt,
        budget = TASK_LEVEL_RETRY_BUDGET,
        "task-level retry: pushed task from Failed back to Ready"
    );
    emit_task_retrying_signal(
        state,
        project_id,
        agent_instance_id,
        task_id,
        attempt,
        TASK_LEVEL_RETRY_BUDGET,
        "task_level",
        &reason,
        session_id,
    );
}

/// Pull a usable error reason out of a `tool_result` payload.
///
/// Mirrors `super::common::event_reason` but checks the keys the
/// harness most commonly puts on `tool_result` error blocks
/// (`result`, `error`, `message`, `text`, ...). Returns `None` when
/// no string-typed field is populated; the caller skips the retry
/// path in that case because there is nothing to classify.
fn tool_result_error_reason(event: &serde_json::Value) -> Option<String> {
    for key in ["error", "message", "result", "result_preview", "text"] {
        if let Some(value) = event.get(key).and_then(|v| v.as_str()) {
            let trimmed = value.trim();
            if !trimmed.is_empty() {
                return Some(trimmed.to_string());
            }
        }
    }
    None
}

/// Emit a `task_retrying` event onto both the legacy
/// `event_broadcast` firehose and the topic-scoped event hub so
/// live subscribers (`useTaskStatus`, dev-loop UI) can render the
/// retry banner without polling. Mirrors the JSON shape of
/// `task_failed` / `task_completed` so existing front-end handlers
/// can decode the same fields.
#[allow(clippy::too_many_arguments)]
fn emit_task_retrying_signal(
    state: &AppState,
    project_id: ProjectId,
    agent_instance_id: AgentInstanceId,
    task_id: &str,
    attempt: u32,
    budget: u32,
    scope: &'static str,
    reason: &str,
    session_id: Option<SessionId>,
) {
    let mut payload = serde_json::json!({
        "type": "task_retrying",
        "task_id": task_id,
        "project_id": project_id.to_string(),
        "agent_instance_id": agent_instance_id.to_string(),
        "attempt": attempt,
        "budget": budget,
        "scope": scope,
        "reason": reason,
    });
    if let Some(session_id) = session_id {
        if let Some(object) = payload.as_object_mut() {
            object.insert("session_id".to_string(), session_id.to_string().into());
        }
    }
    let _ = state.event_broadcast.send(payload.clone());
    state
        .event_hub
        .publish(DomainEvent::LegacyJson(LegacyJsonEvent {
            project_id: Some(project_id),
            agent_instance_id: Some(agent_instance_id),
            session_id,
            loop_id: None,
            payload,
        }));
}
