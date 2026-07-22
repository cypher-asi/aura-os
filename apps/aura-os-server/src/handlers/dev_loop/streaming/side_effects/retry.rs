//! Task-level retry plumbing for the dev-loop forwarder.
//!
//! Collapses the `task_failed` arm into a single decision:
//!
//! ```text
//! on task_failed:
//!     kind = HarnessFailureKind from event.reason
//!     action = kind.retry_action(task.attempts)
//!     if action == Retry && task.attempts < MAX_TASK_ATTEMPTS:
//!         storage.update_task(attempts = task.attempts + 1)
//!         safe_transition(Failed -> Ready)
//!         emit task_retrying (carries `action`)
//!     else:
//!         leave task in Failed
//! ```
//!
//! The persisted `tasks.attempts` counter (see
//! `docs/migrations/2026-05-21-task-attempts-column.md`) holds the
//! per-task budget. The retry ladder is now flat:
//! `{Retry, Terminal}` — transient infra kinds retry up to three
//! times; task-shape and terminal kinds are `Terminal` from
//! attempt 0. Tool-level retries are the harness's responsibility —
//! it sees every tool result; the server does not need a parallel
//! tool-retry tracker.

use tracing::{info, warn};

use aura_os_core::{AgentInstanceId, ProjectId, SessionId, TaskStatus};
use aura_os_events::{DomainEvent, LegacyJsonEvent};
use aura_os_harness::signals::{HarnessFailureKind, HarnessSignal, RetryAction};

use super::failure::resolve_failure_reason_for_persistence;
use super::MAX_TASK_ATTEMPTS;
use crate::state::AppState;

/// Parse a failure reason string into a typed
/// [`HarnessFailureKind`], using the canonical
/// `aura-os-harness::signals::classify_failure` router so the
/// server-side retry decision can never drift from the harness's
/// own classifier ordering.
fn classify_reason(reason: &str) -> HarnessFailureKind {
    HarnessSignal::from_event("task_failed", &serde_json::json!({ "reason": reason }))
        .and_then(|signal| signal.failure_kind())
        .unwrap_or(HarnessFailureKind::Other)
}

/// Decide whether to push the failed task back to `Ready` and emit
/// the `task_retrying` UI signal. Gated by:
///
/// * [`HarnessFailureKind::retry_action`] — terminal failures
///   (agent-stuck, insufficient credits, task-shape failures, or
///   exhausted transient retry cap) stay in `Failed`. A non-
///   terminal `Retry` action is surfaced onto the `task_retrying`
///   event so downstream consumers can render the retry banner.
/// * The persisted `tasks.attempts` counter being strictly below
///   [`MAX_TASK_ATTEMPTS`] — a permanently-broken task does not
///   loop forever, and the count survives server restarts.
///
/// On a successful retry hop we bump `attempts` and transition the
/// task back to `Ready` in a single `update_task` call before the
/// `safe_transition` so the next attempt observes the incremented
/// counter even if the transition itself races with another reader.
pub(super) async fn maybe_apply_task_level_retry(
    ctx: &super::SideEffectCtx<'_>,
    task_id: &str,
    event: &serde_json::Value,
) {
    let Some(jwt) = ctx.jwt else {
        return;
    };
    let Some(storage) = ctx.state.storage_client.as_ref() else {
        return;
    };
    let reason = resolve_failure_reason_for_persistence(event);
    let kind = classify_reason(&reason);
    if !kind.is_retryable() {
        return;
    }
    let Some(prior_attempts) = read_prior_attempts(storage, task_id, jwt).await else {
        return;
    };
    let action = kind.retry_action(prior_attempts);
    if !attempt_budget_allows_retry(task_id, prior_attempts, kind, action) {
        if super::super::provider_circuit::should_open(kind, prior_attempts) {
            super::super::provider_circuit::open(ctx, &reason).await;
        }
        return;
    }
    if !push_task_back_to_ready(storage, jwt, task_id, prior_attempts).await {
        return;
    }
    let next_attempts = prior_attempts.saturating_add(1);
    info!(
        %task_id,
        attempt = next_attempts,
        budget = MAX_TASK_ATTEMPTS,
        ?kind,
        ?action,
        "task-level retry: pushed task from Failed back to Ready"
    );
    emit_task_retrying_signal(TaskRetryingPayload {
        state: ctx.state,
        project_id: ctx.project_id,
        agent_instance_id: ctx.agent_instance_id,
        task_id,
        attempt: next_attempts,
        budget: MAX_TASK_ATTEMPTS,
        reason: &reason,
        action,
        session_id: ctx.session_id,
    });
}

/// Read the persisted attempt count for `task_id`. Returns `None` if
/// the storage call fails - we conservatively leave the task in
/// `Failed` rather than double-spending the budget on a count we
/// can't verify.
async fn read_prior_attempts(
    storage: &aura_os_storage::StorageClient,
    task_id: &str,
    jwt: &str,
) -> Option<u32> {
    match storage.get_task(task_id, jwt).await {
        Ok(storage_task) => Some(storage_task.attempts.unwrap_or(0)),
        Err(error) => {
            warn!(
                %task_id,
                %error,
                "task-level retry: get_task failed; leaving task in Failed"
            );
            None
        }
    }
}

/// Gate the retry on the attempt-aware policy + the persisted-budget
/// ceiling. Returns `true` when the retry should proceed, `false`
/// (with an `info!` log) when the task must stay in `Failed`.
fn attempt_budget_allows_retry(
    task_id: &str,
    prior_attempts: u32,
    kind: HarnessFailureKind,
    action: RetryAction,
) -> bool {
    if matches!(action, RetryAction::Terminal) {
        info!(
            %task_id,
            prior_attempts,
            ?kind,
            "task-level retry: per-kind escalation ladder is terminal at this \
             attempt index; leaving task in Failed"
        );
        return false;
    }
    if prior_attempts >= MAX_TASK_ATTEMPTS {
        info!(
            %task_id,
            prior_attempts,
            budget = MAX_TASK_ATTEMPTS,
            "task-level retry: attempt budget exhausted; leaving task in Failed"
        );
        return false;
    }
    true
}

/// Bump the persisted `tasks.attempts` counter and transition the
/// row back to `Ready`. Returns `false` (with a `warn!` log) on
/// either storage failure so the caller leaves the task in `Failed`.
async fn push_task_back_to_ready(
    storage: &aura_os_storage::StorageClient,
    jwt: &str,
    task_id: &str,
    prior_attempts: u32,
) -> bool {
    let next_attempts = prior_attempts.saturating_add(1);
    let update = aura_os_storage::UpdateTaskRequest {
        attempts: Some(next_attempts),
        ..Default::default()
    };
    if let Err(error) = storage.update_task(task_id, jwt, &update).await {
        warn!(
            %task_id,
            %error,
            "task-level retry: update_task(attempts) failed; leaving task in Failed"
        );
        return false;
    }
    if let Err(error) =
        aura_os_tasks::safe_transition(storage, jwt, task_id, TaskStatus::Ready).await
    {
        warn!(
            %task_id,
            %error,
            "task-level retry: safe_transition(Failed -> Ready) failed after bumping attempts; \
             leaving task in Failed"
        );
        return false;
    }
    true
}

/// Emit a `task_retrying` event onto both the legacy
/// `event_broadcast` firehose and the topic-scoped event hub so
/// live subscribers (`useTaskStatus`, dev-loop UI) can render the
/// retry banner without polling. Mirrors the JSON shape of
/// `task_failed` / `task_completed` so existing front-end handlers
/// can decode the same fields.
///
/// `action` is serialised onto the payload (`retry_action`) so
/// downstream consumers can render the retry banner without
/// re-classifying the failure reason themselves.
/// Payload for [`emit_task_retrying_signal`]. Bundled so the helper
/// signature stays inside the project's five-parameter ceiling.
struct TaskRetryingPayload<'a> {
    state: &'a AppState,
    project_id: ProjectId,
    agent_instance_id: AgentInstanceId,
    task_id: &'a str,
    attempt: u32,
    budget: u32,
    reason: &'a str,
    action: RetryAction,
    session_id: Option<SessionId>,
}

fn emit_task_retrying_signal(payload_in: TaskRetryingPayload<'_>) {
    let TaskRetryingPayload {
        state,
        project_id,
        agent_instance_id,
        task_id,
        attempt,
        budget,
        reason,
        action,
        session_id,
    } = payload_in;
    let mut payload = serde_json::json!({
        "type": "task_retrying",
        "task_id": task_id,
        "project_id": project_id.to_string(),
        "agent_instance_id": agent_instance_id.to_string(),
        "attempt": attempt,
        "budget": budget,
        "scope": "task_level",
        "reason": reason,
        "retry_action": action,
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
