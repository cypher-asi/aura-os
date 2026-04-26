//! Storage `Session` lifecycle for automation runs (`start_loop` /
//! `run_single_task`).
//!
//! Until this module landed, only the chat path created storage
//! `Session` rows via `SessionService` ([`crate::handlers::agents::chat`]),
//! so the Sidekick "Sessions" stat (`ProjectStats.total_sessions`) was
//! flat for any project that only ever ran automation. The dev-loop
//! adapter now calls [`begin_session`] on cold start (and reuses the
//! existing id on adopted starts), and the forwarder calls
//! [`record_task_worked`] / [`end_session`] as it observes lifecycle
//! events — bringing automation parity with chat for both
//! `total_sessions` and per-session `tasks_worked_count`.

use std::str::FromStr;

use tracing::warn;

use aura_os_core::{AgentInstanceId, ProjectId, SessionId, SessionStatus, TaskId};
use aura_os_sessions::{CreateSessionParams, SessionService};

use crate::state::AppState;

/// Create a fresh `active` storage session for an automation run.
///
/// Returns `None` when `SessionService` is not connected to storage
/// (e.g. test rigs that build the service without a storage client) or
/// the storage call fails. Callers treat `None` as "session counting
/// disabled for this run" rather than a hard error — the dev loop
/// runs to completion either way; we just don't update aura-storage
/// from the forwarder.
///
/// `active_task_id` lets `run_single_task` tag the session with the
/// task it was minted for. `start_loop` passes `None` (the loop picks
/// up tasks dynamically via `task_started` events).
pub(super) async fn begin_session(
    state: &AppState,
    project_id: ProjectId,
    agent_instance_id: AgentInstanceId,
    active_task_id: Option<TaskId>,
    user_id: Option<String>,
    model: Option<String>,
) -> Option<SessionId> {
    let params = CreateSessionParams {
        agent_instance_id,
        project_id,
        active_task_id,
        summary: String::new(),
        user_id,
        model,
    };
    match state.session_service.create_session(params).await {
        Ok(session) => Some(session.session_id),
        Err(error) => {
            warn!(
                %project_id,
                %agent_instance_id,
                %error,
                "failed to materialise storage session for automation run; \
                 total_sessions / tasks_worked_count will not include this loop"
            );
            None
        }
    }
}

/// Increment `tasks_worked_count` for the in-flight session whenever
/// the harness reports a `task_started` event with a parseable
/// `task_id`. Failures are logged and swallowed so a transient storage
/// blip never aborts the live run.
pub(super) async fn record_task_worked(
    service: &SessionService,
    project_id: ProjectId,
    agent_instance_id: AgentInstanceId,
    session_id: SessionId,
    task_id_str: &str,
) {
    let Ok(task_id) = TaskId::from_str(task_id_str) else {
        // Non-UUID task ids (e.g. legacy synthetic `runner-N` payloads)
        // are deliberately skipped: the storage column is typed and
        // rejecting them at the boundary keeps the rest of the run
        // healthy.
        return;
    };
    if let Err(error) = service
        .record_task_worked(&project_id, &agent_instance_id, &session_id, task_id)
        .await
    {
        warn!(
            %project_id,
            %agent_instance_id,
            %session_id,
            %task_id,
            %error,
            "failed to record task_worked on automation session"
        );
    }
}

/// Transition the session to its terminal status when the forwarder
/// reaches the end of its event stream. Mirrors the chat path's
/// `close_active_sessions_for_agent` for the dev loop, but writes the
/// authoritative `Completed` / `Failed` status instead of always
/// `Completed`.
pub(super) async fn end_session(
    service: &SessionService,
    project_id: ProjectId,
    agent_instance_id: AgentInstanceId,
    session_id: SessionId,
    status: SessionStatus,
) {
    if let Err(error) = service
        .end_session(&project_id, &agent_instance_id, &session_id, status)
        .await
    {
        warn!(
            %project_id,
            %agent_instance_id,
            %session_id,
            ?status,
            %error,
            "failed to end automation session"
        );
    }
}

/// Look up the session id stashed on an adopted automaton's registry
/// entry so a second `start_loop` call on the same
/// `(project_id, agent_instance_id, automaton_id)` can reuse the live
/// session instead of creating a duplicate row.
pub(super) async fn existing_session_id(
    state: &AppState,
    project_id: ProjectId,
    agent_instance_id: AgentInstanceId,
    automaton_id: &str,
) -> Option<SessionId> {
    state
        .automaton_registry
        .lock()
        .await
        .get(&(project_id, agent_instance_id))
        .filter(|entry| entry.automaton_id == automaton_id)
        .and_then(|entry| entry.session_id)
}
