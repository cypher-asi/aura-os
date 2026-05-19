//! Spawns the harness-event consumer task that drives `LoopHandle` activity, persists side-effects, surfaces live heuristics, and shadows the broadcast into the chat persist pipeline (G0b / F1).

use std::str::FromStr;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};

use aura_os_core::{AgentInstanceId, ProjectId, SessionId, SessionStatus, TaskId};
use aura_os_harness::collect_automaton_events;
use tokio::sync::broadcast;
use tracing::warn;

use crate::handlers::agents::chat::{spawn_dev_loop_persist_task, ChatPersistCtx};
use crate::handlers::live_heuristics::{emit_live_heuristic, LiveAnalyzer};
use crate::loop_log::RunStatus;
use crate::state::AppState;

use super::super::session::end_session;
use super::super::signals::is_insufficient_credits_failure_for_tests;
use super::super::types::ForwarderContext;
use super::{activity, credits, emit_domain_event_with_session, side_effects};

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
            retry_state,
        } = ctx;
        let loop_handle = Arc::new(loop_handle);
        let jwt = jwt.map(Arc::new);
        // Phase G0b (plan F1): subscribe the chat persist pipeline to
        // this same harness broadcast so every dev-loop harness event
        // lands as a `SessionEvent` row. Any future replay through
        // `session_events_to_agent_history` then goes through the
        // same dangling-`tool_use` strip, recent-window cap, tool-blob
        // truncation, and parallel-`tool_result` dedupe chat already
        // gets. Purely additive: the side-effects worker / loop_log
        // writer / LoopHandle updates below are unchanged. We only
        // attach when we have everything the chat persist contract
        // needs (storage client + JWT + minted session id); on any
        // missing piece we skip silently — the dev-loop runs to
        // completion either way and the worst case is "no
        // SessionEvent rows for this run", not a hard failure.
        let _persist_handle = maybe_spawn_dev_loop_persist(DevLoopPersistInputs {
            state: &state,
            events_tx: &events_tx,
            project_id,
            agent_instance_id,
            jwt: jwt.as_deref().map(|s| s.as_str()),
            session_id,
        });
        let rx = events_tx.subscribe();
        let fallback_task_id = task_id.clone();
        let (event_task_tx, mut event_task_rx) =
            tokio::sync::mpsc::unbounded_channel::<(serde_json::Value, String)>();
        let event_worker_state = state.clone();
        let event_worker_loop_handle = loop_handle.clone();
        let event_worker_jwt = jwt.clone();
        let event_worker_fallback_task_id = fallback_task_id.clone();
        let event_worker_retry_state = retry_state.clone();
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
                activity::apply_loop_activity_event(&event_worker_loop_handle, &event_type, &event)
                    .await;
                side_effects::record_event_side_effects(
                    &event_worker_state,
                    project_id,
                    agent_instance_id,
                    event_worker_fallback_task_id.clone(),
                    event,
                    &event_type,
                    event_worker_jwt.as_ref().map(|j| j.as_str()),
                    session_id,
                    &event_worker_retry_state,
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

/// Inputs for [`maybe_spawn_dev_loop_persist`]. Bundled so the helper
/// signature stays inside the 5-parameter limit while still pulling
/// every field the [`ChatPersistCtx`] needs.
struct DevLoopPersistInputs<'a> {
    state: &'a AppState,
    events_tx: &'a broadcast::Sender<serde_json::Value>,
    project_id: ProjectId,
    agent_instance_id: AgentInstanceId,
    jwt: Option<&'a str>,
    session_id: Option<SessionId>,
}

/// Spawn the chat-pipeline persist task subscribed to the dev-loop's
/// harness event broadcast. Returns `None` when any precondition for
/// chat persistence is missing (storage client unset, no JWT
/// captured, or no `SessionId` minted) — the dev-loop runs to
/// completion either way; we just won't write `SessionEvent` rows
/// for this run. See module-level doc on
/// [`crate::handlers::agents::chat::spawn_dev_loop_persist_task`]
/// for the contract and rationale.
fn maybe_spawn_dev_loop_persist(
    inputs: DevLoopPersistInputs<'_>,
) -> Option<tokio::task::JoinHandle<()>> {
    let storage = inputs.state.storage_client.as_ref()?.clone();
    let jwt = inputs.jwt?.to_string();
    let session_id = inputs.session_id?;
    let ctx = ChatPersistCtx {
        storage,
        jwt,
        session_id,
        project_id: inputs.project_id.to_string(),
        project_agent_id: inputs.agent_instance_id.to_string(),
        agent_id: None,
        originating_agent_id: None,
        cross_agent_depth: 0,
        from_agent_id: None,
    };
    Some(spawn_dev_loop_persist_task(
        inputs.events_tx.subscribe(),
        ctx,
    ))
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
