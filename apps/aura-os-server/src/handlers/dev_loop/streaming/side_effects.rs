//! Side-effects triggered by individual harness events: appending to
//! the live task output cache, persisting fail reasons to
//! `tasks.execution_notes`, and updating per-task usage counters.

use std::str::FromStr;

use tracing::warn;

use aura_os_core::{AgentInstanceId, ProjectId, SessionId, TaskId};
use aura_os_events::{DomainEvent, LegacyJsonEvent};
use aura_os_storage::UpdateTaskRequest;

use crate::state::{AppState, CachedTaskOutput};

use super::super::session::record_task_worked;
use super::super::signals::extract_task_failure_context;

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
    let _ = state.event_broadcast.send(enriched.clone());
    state
        .event_hub
        .publish(DomainEvent::LegacyJson(LegacyJsonEvent {
            project_id: Some(project_id),
            agent_instance_id: Some(agent_instance_id),
            session_id,
            loop_id: None,
            payload: enriched,
        }));

    apply_event_side_effect(
        state,
        project_id,
        agent_instance_id,
        event_type,
        task_id.as_deref(),
        &event,
        jwt,
        session_id,
    )
    .await;
}

async fn apply_event_side_effect(
    state: &AppState,
    project_id: ProjectId,
    agent_instance_id: AgentInstanceId,
    event_type: &str,
    task_id: Option<&str>,
    event: &serde_json::Value,
    jwt: Option<&str>,
    session_id: Option<SessionId>,
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
        }
        "task_failed" => {
            set_current_task(state, project_id, agent_instance_id, None).await;
            // Persist the fail reason onto `tasks.execution_notes` so
            // it survives a page reload. The live WebSocket path
            // already carries the reason to `useTaskStatus`, but that
            // state resets to `null` on mount; without this write,
            // "Copy All Output" on a reloaded failed task has no
            // reason to render (the hook has nothing to seed from).
            if let (Some(task_id), Some(jwt)) = (task_id, jwt) {
                persist_task_failure_reason(state, jwt, task_id, event).await;
            }
        }
        "text_delta" => {
            if let Some((task_id, text)) = task_id.zip(event_text(event)) {
                append_task_output(state, project_id, task_id, text).await;
            }
        }
        "token_usage" | "assistant_message_end" | "usage" | "session_usage" => {
            if let Some(task_id) = task_id {
                update_usage_cache(state, project_id, task_id, event).await;
            }
        }
        _ => {}
    }
}

/// Extract the fail reason from a `task_failed` event. Checks the same
/// field order as `event_message` (`reason`/`message`/`error`/`code`)
/// and returns `None` when all are missing or empty — callers can
/// decide whether to fall back to the generic "Automaton execution
/// failed" string or skip the write entirely.
///
/// Trims whitespace so we don't persist empty strings or pure-space
/// payloads as if they were real reasons.
pub(crate) fn extract_task_failure_reason(event: &serde_json::Value) -> Option<String> {
    for key in ["reason", "message", "error", "code"] {
        if let Some(value) = event.get(key).and_then(|v| v.as_str()) {
            let trimmed = value.trim();
            if !trimmed.is_empty() {
                return Some(trimmed.to_string());
            }
        }
    }
    None
}

/// Best-effort write of `tasks.execution_notes` from the reason field
/// of a `task_failed` event. Intentionally non-fatal: failures (no
/// storage client configured, expired JWT, network blip) are logged at
/// `warn` level and the caller continues. Callers only hit this path
/// after already forwarding the event to live subscribers, so the
/// reload-visible state is strictly better-off than before regardless
/// of outcome.
async fn persist_task_failure_reason(
    state: &AppState,
    jwt: &str,
    task_id: &str,
    event: &serde_json::Value,
) {
    let Some(storage) = state.storage_client.as_ref() else {
        return;
    };
    let Some(reason) = extract_task_failure_reason(event) else {
        return;
    };
    let update = UpdateTaskRequest {
        execution_notes: Some(reason),
        ..Default::default()
    };
    if let Err(error) = storage.update_task(task_id, jwt, &update).await {
        warn!(
            %task_id,
            %error,
            "failed to persist task_failed reason to tasks.execution_notes"
        );
    }
}

fn enrich_event(
    event: serde_json::Value,
    project_id: ProjectId,
    agent_instance_id: AgentInstanceId,
    task_id: Option<&str>,
    session_id: Option<SessionId>,
) -> serde_json::Value {
    let mut enriched = event;
    if let Some(object) = enriched.as_object_mut() {
        object
            .entry("project_id".to_string())
            .or_insert_with(|| project_id.to_string().into());
        object
            .entry("agent_instance_id".to_string())
            .or_insert_with(|| agent_instance_id.to_string().into());
        if let Some(task_id) = task_id {
            object
                .entry("task_id".to_string())
                .or_insert_with(|| task_id.to_string().into());
        }
        if let Some(session_id) = session_id {
            object
                .entry("session_id".to_string())
                .or_insert_with(|| session_id.to_string().into());
        }
    }
    enriched
}

async fn set_current_task(
    state: &AppState,
    project_id: ProjectId,
    agent_instance_id: AgentInstanceId,
    task_id: Option<String>,
) {
    if let Some(entry) = state
        .automaton_registry
        .lock()
        .await
        .get_mut(&(project_id, agent_instance_id))
    {
        entry.current_task_id = task_id;
    }
}

async fn append_task_output(state: &AppState, project_id: ProjectId, task_id: &str, text: &str) {
    let Some(key) = parse_task_key(project_id, task_id) else {
        return;
    };
    state
        .task_output_cache
        .lock()
        .await
        .entry(key)
        .or_default()
        .live_output
        .push_str(text);
}

fn event_text(event: &serde_json::Value) -> Option<&str> {
    event
        .get("text")
        .or_else(|| event.get("delta"))
        .and_then(|value| value.as_str())
}

pub(crate) async fn seed_task_output(
    state: &AppState,
    project_id: ProjectId,
    agent_instance_id: AgentInstanceId,
    task_id: &str,
) {
    let Some(key) = parse_task_key(project_id, task_id) else {
        return;
    };
    state
        .task_output_cache
        .lock()
        .await
        .entry(key)
        .or_insert_with(|| CachedTaskOutput {
            project_id: Some(project_id.to_string()),
            agent_instance_id: Some(agent_instance_id.to_string()),
            ..Default::default()
        });
}

async fn update_usage_cache(
    state: &AppState,
    project_id: ProjectId,
    task_id: &str,
    event: &serde_json::Value,
) {
    let Some(key) = parse_task_key(project_id, task_id) else {
        return;
    };
    let usage = event.get("usage").unwrap_or(event);
    let mut cache = state.task_output_cache.lock().await;
    let entry = cache.entry(key).or_default();
    if let Some(model) = usage.get("model").and_then(|value| value.as_str()) {
        entry.model = Some(model.to_string());
    }
    if let Some(provider) = usage.get("provider").and_then(|value| value.as_str()) {
        entry.provider = Some(provider.to_string());
    }
    if let Some(input) = usage.get("input_tokens").and_then(|value| value.as_u64()) {
        entry.input_tokens = entry.input_tokens.saturating_add(input);
        entry.total_input_tokens = entry.total_input_tokens.saturating_add(input);
    }
    if let Some(output) = usage.get("output_tokens").and_then(|value| value.as_u64()) {
        entry.output_tokens = entry.output_tokens.saturating_add(output);
        entry.total_output_tokens = entry.total_output_tokens.saturating_add(output);
    }
}

/// Parse a free-form task id string into a typed cache key. Returns
/// `None` for non-UUID task ids; the caller silently drops the entry
/// in that case (legacy harness payloads occasionally carry synthetic
/// `"runner-<n>"` ids that should not pollute the cache).
fn parse_task_key(project_id: ProjectId, task_id: &str) -> Option<(ProjectId, TaskId)> {
    TaskId::from_str(task_id).ok().map(|tid| (project_id, tid))
}
