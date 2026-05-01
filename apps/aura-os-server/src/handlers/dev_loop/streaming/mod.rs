//! Dev-loop streaming infrastructure: forwards harness events into the
//! legacy broadcast firehose and the topic-scoped event hub, drives
//! [`LoopHandle`] activity transitions, persists side-effects (task
//! output / usage / failure reason), and stops automatons that hit
//! credit exhaustion.
//!
//! Sub-modules:
//!
//! * [`activity`] — translates harness events into loop status
//!   transitions.
//! * [`credits`] — credit-exhaustion detection and automaton shutdown.
//! * [`side_effects`] — task output / usage cache / persisted failure
//!   reason writes triggered by individual events.

mod activity;
mod credits;
mod side_effects;

use std::str::FromStr;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};

use aura_os_core::{AgentInstanceId, ProjectId, SessionId, SessionStatus, TaskId};
use aura_os_events::{DomainEvent, LegacyJsonEvent};
use aura_os_harness::collect_automaton_events;
use tracing::warn;

use crate::handlers::live_heuristics::{emit_live_heuristic, LiveAnalyzer};
use crate::loop_log::RunStatus;
use crate::state::AppState;

use super::session::end_session;
use super::signals::is_insufficient_credits_failure_for_tests;
use super::types::ForwarderContext;

pub(crate) use side_effects::seed_task_output;

#[cfg(test)]
use side_effects::extract_task_failure_reason;

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
/// `session_id` so subscribers filtering by session topic receive the
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

pub(crate) fn spawn_event_forwarder(ctx: ForwarderContext) -> tokio::task::AbortHandle {
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
        let (event_task_tx, mut event_task_rx) =
            tokio::sync::mpsc::unbounded_channel::<(serde_json::Value, String)>();
        let event_worker_state = state.clone();
        let event_worker_loop_handle = loop_handle.clone();
        let event_worker_jwt = jwt.clone();
        let event_worker_fallback_task_id = fallback_task_id.clone();
        let event_worker = tokio::spawn(async move {
            let mut live_analyzer = LiveAnalyzer::new();
            while let Some((event, event_type)) = event_task_rx.recv().await {
                event_worker_state
                    .loop_log
                    .on_json_event(project_id, agent_instance_id, &event)
                    .await;
                record_loop_log_task_lifecycle(
                    &event_worker_state,
                    project_id,
                    agent_instance_id,
                    &event_type,
                    &event,
                )
                .await;
                maybe_emit_live_heuristics(
                    &event_worker_state,
                    project_id,
                    agent_instance_id,
                    &mut live_analyzer,
                    &event_type,
                )
                .await;
                activity::apply_loop_activity(&event_worker_loop_handle, &event_type, &event).await;
                side_effects::record_event_side_effects(
                    &event_worker_state,
                    project_id,
                    agent_instance_id,
                    event_worker_fallback_task_id.clone(),
                    event,
                    &event_type,
                    event_worker_jwt.as_ref().map(|j| j.as_str()),
                    session_id,
                )
                .await;
            }
        });
        let credit_stop_requested = Arc::new(AtomicBool::new(false));
        let stop_automaton_id = automaton_id.clone();
        let completion = collect_automaton_events(rx, timeout, |event, event_type| {
            let state = state.clone();
            let event = event.clone();
            let event_type = event_type.to_string();
            let credit_stop_requested = credit_stop_requested.clone();
            let stop_automaton_id = stop_automaton_id.clone();
            if credits::insufficient_credits_event_message(&event_type, &event).is_some()
                && credit_stop_requested
                    .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
                    .is_ok()
            {
                let state = state.clone();
                tokio::spawn(async move {
                    credits::stop_automaton_for_credit_exhaustion(
                        &state,
                        project_id,
                        agent_instance_id,
                        &stop_automaton_id,
                    )
                    .await;
                });
            }
            let _ = event_task_tx.send((event, event_type));
        })
        .await;
        drop(event_task_tx);
        if let Err(error) = event_worker.await {
            warn!(%error, "dev-loop forwarder event worker failed");
        }
        alive.store(false, Ordering::SeqCst);
        credits::remove_matching_registry_entry(
            &state,
            project_id,
            agent_instance_id,
            &automaton_id,
        )
        .await;
        let insufficient_credits_reason = completion
            .failure_message()
            .filter(|message| is_insufficient_credits_failure_for_tests(message));
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
        state
            .loop_log
            .on_loop_ended(
                project_id,
                agent_instance_id,
                if succeeded {
                    RunStatus::Completed
                } else {
                    RunStatus::Failed
                },
            )
            .await;
        // Mirror the harness loop outcome onto the storage `Session`
        // we minted in `start_loop` / `run_single_task` so the
        // Sidekick "Sessions" stat reflects automation activity.
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
        emit_domain_event_with_session(
            &state,
            "loop_finished",
            project_id,
            agent_instance_id,
            session_id,
            insufficient_credits_reason.map_or_else(
                || {
                    if succeeded {
                        serde_json::json!({"outcome": "completed"})
                    } else {
                        serde_json::json!({
                            "outcome": "failed",
                            "reason": completion.failure_message(),
                        })
                    }
                },
                |reason| {
                    serde_json::json!({
                        "outcome": "insufficient_credits",
                        "reason": reason,
                    })
                },
            ),
        );
    });
    handle.abort_handle()
}

async fn maybe_emit_live_heuristics(
    state: &AppState,
    project_id: ProjectId,
    agent_instance_id: AgentInstanceId,
    live_analyzer: &mut LiveAnalyzer,
    event_type: &str,
) {
    let Some((run_id, run_dir)) = state
        .loop_log
        .active_bundle(project_id, agent_instance_id)
        .await
    else {
        return;
    };

    live_analyzer.note_event(event_type);
    if !live_analyzer.should_run() {
        return;
    }
    let findings = live_analyzer.maybe_analyze(&run_dir);

    if let Some(findings) = findings {
        for finding in findings {
            emit_live_heuristic(state, &finding, project_id, agent_instance_id, &run_id);
        }
    }
}

async fn record_loop_log_task_lifecycle(
    state: &AppState,
    project_id: ProjectId,
    agent_instance_id: AgentInstanceId,
    event_type: &str,
    event: &serde_json::Value,
) {
    let Some(task_id) = event_task_id(event) else {
        return;
    };
    let Ok(task_id) = TaskId::from_str(task_id) else {
        return;
    };

    match event_type {
        "task_started" => {
            state
                .loop_log
                .on_task_started(project_id, agent_instance_id, task_id, None)
                .await;
        }
        "task_completed" | "task_failed" => {
            let output = task_output_snapshot(state, project_id, task_id)
                .await
                .unwrap_or_default();
            state.loop_log.on_task_end(task_id, &output).await;
        }
        _ => {}
    }
}

fn event_task_id(event: &serde_json::Value) -> Option<&str> {
    event.get("task_id").and_then(|value| value.as_str())
}

async fn task_output_snapshot(
    state: &AppState,
    project_id: ProjectId,
    task_id: TaskId,
) -> Option<String> {
    state
        .task_output_cache
        .lock()
        .await
        .get(&(project_id, task_id))
        .map(|entry| entry.live_output.clone())
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
