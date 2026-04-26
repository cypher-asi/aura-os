use std::str::FromStr;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};

use tracing::warn;

use aura_os_core::{AgentInstanceId, ProjectId, SessionId, SessionStatus, TaskId};
use aura_os_events::{DomainEvent, LegacyJsonEvent, LoopStatus};
use aura_os_harness::{collect_automaton_events, AutomatonClient};
use aura_os_loops::LoopHandle;
use aura_os_storage::UpdateTaskRequest;

use crate::state::{AppState, CachedTaskOutput};

use super::session::{end_session, record_task_worked};
use super::signals::is_insufficient_credits_failure_for_tests;
use super::types::ForwarderContext;

/// Publish an event into both the legacy `event_broadcast` firehose and
/// the topic-scoped [`aura_os_events::EventHub`]. Producers stamp the
/// project and agent-instance routing keys explicitly so the hub can
/// deliver only to subscribers that asked for them.
pub(crate) fn emit_domain_event(
    state: &AppState,
    event_type: &str,
    project_id: ProjectId,
    agent_instance_id: AgentInstanceId,
    extra: serde_json::Value,
) {
    emit_domain_event_with_session(
        state,
        event_type,
        project_id,
        agent_instance_id,
        None,
        extra,
    );
}

/// Same as [`emit_domain_event`] but also stamps the routing
/// `session_id` so subscribers filtering by session topic (e.g. the
/// chat persistence pipeline, downstream stats consumers) receive the
/// loop event without having to peek into the JSON payload.
pub(crate) fn emit_domain_event_with_session(
    state: &AppState,
    event_type: &str,
    project_id: ProjectId,
    agent_instance_id: AgentInstanceId,
    session_id: Option<SessionId>,
    extra: serde_json::Value,
) {
    let mut event = serde_json::json!({
        "type": event_type,
        "project_id": project_id.to_string(),
        "agent_instance_id": agent_instance_id.to_string(),
    });
    if let Some(session_id) = session_id {
        if let Some(object) = event.as_object_mut() {
            object.insert("session_id".to_string(), session_id.to_string().into());
        }
    }
    if let (Some(base), Some(extra)) = (event.as_object_mut(), extra.as_object()) {
        for (key, value) in extra {
            base.insert(key.clone(), value.clone());
        }
    }
    let _ = state.event_broadcast.send(event.clone());
    state
        .event_hub
        .publish(DomainEvent::LegacyJson(LegacyJsonEvent {
            project_id: Some(project_id),
            agent_instance_id: Some(agent_instance_id),
            session_id,
            loop_id: None,
            payload: event,
        }));
}

pub(super) fn spawn_event_forwarder(ctx: ForwarderContext) -> tokio::task::AbortHandle {
    let handle = tokio::spawn(async move {
        let ForwarderContext {
            state,
            project_id,
            agent_instance_id,
            automaton_id,
            task_id,
            events_tx,
            ws_reader_handle: _ws_reader_handle,
            alive,
            timeout,
            loop_handle,
            jwt,
            session_id,
        } = ctx;
        let loop_handle = Arc::new(loop_handle);
        let jwt = jwt.map(Arc::new);
        let rx = events_tx.subscribe();
        let fallback_task_id = task_id.clone();
        let credit_stop_requested = Arc::new(AtomicBool::new(false));
        let stop_automaton_id = automaton_id.clone();
        let completion = collect_automaton_events(rx, timeout, |event, event_type| {
            let state = state.clone();
            let event = event.clone();
            let event_type = event_type.to_string();
            let fallback_task_id = fallback_task_id.clone();
            let credit_stop_requested = credit_stop_requested.clone();
            let stop_automaton_id = stop_automaton_id.clone();
            let loop_handle = loop_handle.clone();
            let jwt = jwt.clone();
            if insufficient_credits_event_message(&event_type, &event).is_some()
                && credit_stop_requested
                    .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
                    .is_ok()
            {
                let state = state.clone();
                tokio::spawn(async move {
                    stop_automaton_for_credit_exhaustion(
                        &state,
                        project_id,
                        agent_instance_id,
                        &stop_automaton_id,
                    )
                    .await;
                });
            }
            tokio::spawn(async move {
                apply_loop_activity(&loop_handle, &event_type, &event).await;
                record_event_side_effects(
                    &state,
                    project_id,
                    agent_instance_id,
                    fallback_task_id,
                    event,
                    &event_type,
                    jwt.as_ref().map(|j| j.as_str()),
                    session_id,
                )
                .await;
            });
        })
        .await;
        alive.store(false, Ordering::SeqCst);
        remove_matching_registry_entry(&state, project_id, agent_instance_id, &automaton_id).await;
        let insufficient_credits_reason = completion
            .failure_message()
            .filter(|message| is_insufficient_credits_failure_for_tests(message))
            .map(str::to_string);
        // Terminal methods take `&self` via the shared `Arc<LoopHandle>`
        // so the spawned event handlers can still hold clones without
        // blocking close. Only one terminal call actually fires — the
        // atomic `closed` flag dedupes.
        let succeeded = insufficient_credits_reason.is_some() || completion.is_success();
        if succeeded {
            loop_handle.mark_completed().await;
        } else {
            loop_handle
                .mark_failed(completion.failure_message().map(str::to_string))
                .await;
        }
        // Mirror the harness loop outcome onto the storage `Session`
        // we minted in `start_loop` / `run_single_task` so the
        // Sidekick "Sessions" stat reflects automation activity and
        // each row carries an honest `Completed` / `Failed` status
        // instead of dangling forever in `Active`.
        if let Some(session_id) = session_id {
            let status = if succeeded {
                SessionStatus::Completed
            } else {
                SessionStatus::Failed
            };
            end_session(
                &state.session_service,
                project_id,
                agent_instance_id,
                session_id,
                status,
            )
            .await;
        }
        emit_loop_terminal_event(
            &state,
            project_id,
            agent_instance_id,
            session_id,
            succeeded,
            insufficient_credits_reason,
        );
    });
    handle.abort_handle()
}

fn emit_loop_terminal_event(
    state: &AppState,
    project_id: ProjectId,
    agent_instance_id: AgentInstanceId,
    session_id: Option<SessionId>,
    succeeded: bool,
    insufficient_credits_reason: Option<String>,
) {
    let event_type = if succeeded {
        "loop_finished"
    } else {
        "task_failed"
    };
    let extra = insufficient_credits_reason.map_or_else(
        || serde_json::json!({}),
        |reason| {
            serde_json::json!({
                "outcome": "insufficient_credits",
                "reason": reason,
            })
        },
    );
    emit_domain_event_with_session(
        state,
        event_type,
        project_id,
        agent_instance_id,
        session_id,
        extra,
    );
}

/// Translate a harness event type into a [`LoopActivity`] transition.
///
/// Only a subset of harness events are strong signals for progress
/// (status changes like `Running`/`WaitingTool`/`Compacting`).
/// Non-status-bearing events (token deltas, tool snapshots, usage
/// updates, etc.) fall through to the catch-all arm and intentionally
/// do nothing — they used to call `transition(|_| {})` just to poke
/// `last_event_at`, but that flooded the legacy `event_broadcast`
/// with `LoopActivityChanged` frames and caused `/ws/events` clients
/// to lag, dropping `task_started` / `task_completed` / `task_failed`
/// events that the stats dashboard depends on.
async fn apply_loop_activity(handle: &LoopHandle, event_type: &str, event: &serde_json::Value) {
    match event_type {
        "task_started" | "run_started" | "session_started" => {
            let task_id = event
                .get("task_id")
                .and_then(|v| v.as_str())
                .and_then(|s| TaskId::from_str(s).ok());
            handle
                .transition(|activity| {
                    activity.status = LoopStatus::Running;
                    activity.percent = Some(0.05);
                    activity.current_step = Some("running".into());
                    if task_id.is_some() {
                        activity.current_task_id = task_id;
                    }
                })
                .await;
        }
        "text_delta" | "assistant_message_start" | "assistant_message_delta" => {
            handle.mark_running(None, Some("thinking".into())).await;
        }
        "tool_call_start" | "tool_invocation" => {
            let tool = event.get("tool").and_then(|v| v.as_str()).unwrap_or("tool");
            handle.mark_waiting_tool(tool).await;
        }
        "tool_call_end" | "tool_result" => {
            handle.mark_running(None, Some("processing".into())).await;
        }
        "compaction_started" | "context_compaction_started" => {
            handle
                .transition(|activity| {
                    activity.status = LoopStatus::Compacting;
                    activity.current_step = Some("compacting".into());
                })
                .await;
        }
        _ => {
            // Intentionally no-op: non-status-bearing harness events
            // (text_delta, token_usage, tool_call_snapshot, etc.) fire at
            // very high rates during streaming. Publishing a
            // `LoopActivityChanged` for each would flood the legacy
            // `event_broadcast` via `loop_events_bridge` and lag the
            // `/ws/events` client into skipping frames — including the
            // `task_started` / `task_completed` / `task_failed` the
            // stats dashboard depends on. The watchdog in the frontend
            // `loop-activity-store` still gets a `last_event_at` pulse
            // on every real status transition, which is enough.
        }
    }
}

async fn stop_automaton_for_credit_exhaustion(
    state: &AppState,
    project_id: ProjectId,
    agent_instance_id: AgentInstanceId,
    automaton_id: &str,
) {
    let base_url = {
        let reg = state.automaton_registry.lock().await;
        reg.get(&(project_id, agent_instance_id))
            .filter(|entry| entry.automaton_id == automaton_id)
            .map(|entry| entry.harness_base_url.clone())
    };
    let Some(base_url) = base_url else {
        return;
    };
    if let Err(error) = AutomatonClient::new(&base_url).stop(automaton_id).await {
        warn!(%automaton_id, %error, "failed to stop automaton after credits were exhausted");
    }
}

async fn remove_matching_registry_entry(
    state: &AppState,
    project_id: ProjectId,
    agent_instance_id: AgentInstanceId,
    automaton_id: &str,
) {
    let mut reg = state.automaton_registry.lock().await;
    if reg
        .get(&(project_id, agent_instance_id))
        .is_some_and(|entry| entry.automaton_id == automaton_id)
    {
        reg.remove(&(project_id, agent_instance_id));
    }
}

#[allow(clippy::too_many_arguments)]
async fn record_event_side_effects(
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
    let enriched = enrich_event(
        event.clone(),
        project_id,
        agent_instance_id,
        task_id.as_deref(),
        session_id,
    );
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

    match event_type {
        "task_started" => {
            if let Some(task_id) = task_id.as_ref() {
                seed_task_output(state, project_id, agent_instance_id, task_id).await;
                set_current_task(state, project_id, agent_instance_id, Some(task_id.clone())).await;
                // Increment `tasks_worked_count` on the storage
                // session so the per-session stat reflects automation
                // activity in addition to chat. Skipped silently when
                // no session was minted (tests, missing storage).
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
            if let Some(task_id) = task_id.as_ref() {
                if let Some(jwt) = jwt {
                    persist_task_failure_reason(state, jwt, task_id, &event).await;
                }
            }
        }
        "text_delta" => {
            if let Some((task_id, text)) = task_id.as_ref().zip(event_text(&event)) {
                append_task_output(state, project_id, task_id, text).await;
            }
        }
        "token_usage" | "assistant_message_end" | "usage" | "session_usage" => {
            if let Some(task_id) = task_id.as_ref() {
                update_usage_cache(state, project_id, task_id, &event).await;
            }
        }
        _ => {}
    }
}

/// Extract the fail reason from a `task_failed` event. Checks the same
/// field order as [`event_message`] (`reason`/`message`/`error`/`code`)
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

fn insufficient_credits_event_message(
    event_type: &str,
    event: &serde_json::Value,
) -> Option<String> {
    if !matches!(event_type, "task_failed" | "error") {
        return None;
    }
    let text = event_failure_text(event);
    if !is_insufficient_credits_failure_for_tests(&text) {
        return None;
    }
    Some(event_message(event))
}

fn event_message(event: &serde_json::Value) -> String {
    first_string(event, &["reason", "message", "error", "code"])
        .map(str::to_string)
        .unwrap_or_else(|| "Automaton execution failed".to_string())
}

fn event_failure_text(event: &serde_json::Value) -> String {
    ["reason", "message", "error", "code"]
        .iter()
        .filter_map(|key| event.get(*key).and_then(|value| value.as_str()))
        .collect::<Vec<_>>()
        .join(" ")
}

fn first_string<'a>(value: &'a serde_json::Value, keys: &[&str]) -> Option<&'a str> {
    keys.iter()
        .find_map(|key| value.get(*key).and_then(serde_json::Value::as_str))
}

pub(super) async fn seed_task_output(
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

#[cfg(test)]
mod tests {
    use super::extract_task_failure_reason;
    use serde_json::json;

    #[test]
    fn extracts_reason_preferred_over_other_keys() {
        let event = json!({
            "type": "task_failed",
            "reason": "completion contract: task_done called with no file changes",
            "message": "harness shut down",
            "error": "ignored",
        });
        assert_eq!(
            extract_task_failure_reason(&event).as_deref(),
            Some("completion contract: task_done called with no file changes"),
        );
    }

    #[test]
    fn falls_back_through_message_error_code() {
        let message_only = json!({ "type": "task_failed", "message": "boom" });
        assert_eq!(
            extract_task_failure_reason(&message_only).as_deref(),
            Some("boom"),
        );
        let error_only = json!({ "type": "task_failed", "error": "net" });
        assert_eq!(
            extract_task_failure_reason(&error_only).as_deref(),
            Some("net"),
        );
        let code_only = json!({ "type": "task_failed", "code": "429" });
        assert_eq!(
            extract_task_failure_reason(&code_only).as_deref(),
            Some("429"),
        );
    }

    #[test]
    fn trims_whitespace_and_rejects_empty() {
        let whitespace = json!({ "type": "task_failed", "reason": "   " });
        assert!(extract_task_failure_reason(&whitespace).is_none());

        let padded = json!({ "type": "task_failed", "reason": "  real reason  " });
        assert_eq!(
            extract_task_failure_reason(&padded).as_deref(),
            Some("real reason"),
        );
    }

    #[test]
    fn returns_none_when_no_reason_fields() {
        let bare = json!({ "type": "task_failed", "task_id": "abc" });
        assert!(extract_task_failure_reason(&bare).is_none());
    }

    #[test]
    fn ignores_non_string_reason_fields() {
        // The harness occasionally routes structured error payloads;
        // we deliberately don't stringify them here to avoid
        // persisting e.g. `{"code":402}` as a JSON blob in
        // execution_notes. Falls through to the next string-typed
        // field instead.
        let structured = json!({
            "type": "task_failed",
            "reason": { "code": 500, "body": "internal" },
            "message": "upstream 5xx",
        });
        assert_eq!(
            extract_task_failure_reason(&structured).as_deref(),
            Some("upstream 5xx"),
        );
    }
}
