use axum::Json;
use tracing::{error, warn};

use aura_os_core::{AgentInstanceId, ProjectId};
use aura_os_harness::{HarnessLink, LocalHarness};

use crate::dto::LoopStatusResponse;
use crate::error::{ApiError, ApiResult};
use crate::state::AppState;

use super::registry::{abort_and_remove, set_paused, status_response};
use super::streaming::emit_domain_event;
use super::types::ControlAction;

pub(super) async fn control_loop(
    state: &AppState,
    project_id: ProjectId,
    only_agent: Option<AgentInstanceId>,
    action: ControlAction,
) -> ApiResult<Json<LoopStatusResponse>> {
    let targets = {
        let reg = state.automaton_registry.lock().await;
        reg.iter()
            .filter(|((pid, _), _)| *pid == project_id)
            .filter(|((_, agent_id), _)| only_agent.map_or(true, |wanted| *agent_id == wanted))
            .map(|((_, agent_id), entry)| {
                (
                    *agent_id,
                    entry.automaton_id.clone(),
                    entry.harness_base_url.clone(),
                )
            })
            .collect::<Vec<_>>()
    };
    if targets.is_empty() && !matches!(action, ControlAction::Stop) {
        return Err(ApiError::bad_request("no matching dev loop is running"));
    }
    for (agent_id, automaton_id, base_url) in targets {
        control_target(ControlTargetInputs {
            state,
            project_id,
            agent_id,
            automaton_id,
            base_url,
            action: &action,
        })
        .await;
    }
    if matches!(action, ControlAction::Stop) {
        stop_detached_runs(state, project_id, only_agent).await;
    }
    Ok(Json(status_response(state, project_id, only_agent).await))
}

/// Stop harness runs known only through persisted run handles (no
/// live registry entry in this process — e.g. a loop left running on
/// the harness across a server restart). Without this sweep, Stop on
/// a detached loop is a registry no-op and the harness keeps working;
/// the next `/loop/status` probe would then resurrect it in the UI.
async fn stop_detached_runs(
    state: &AppState,
    project_id: ProjectId,
    only_agent: Option<AgentInstanceId>,
) {
    for handle in super::run_handles::list_for_project(state, project_id) {
        if only_agent.is_some_and(|wanted| wanted != handle.agent_instance_id) {
            continue;
        }
        let has_live_entry = state
            .automaton_registry
            .lock()
            .await
            .contains_key(&(project_id, handle.agent_instance_id));
        if has_live_entry {
            // The registry path above already dispatched the stop and
            // `abort_and_remove` dropped the handle.
            continue;
        }
        if let Err(error) =
            LocalHarness::for_configured_local_base_url(handle.harness_base_url.clone())
                .stop_run(&handle.automaton_id, None)
                .await
        {
            warn!(
                automaton_id = %handle.automaton_id,
                harness_base_url = %handle.harness_base_url,
                error = %error,
                "failed to stop detached harness run (clearing handle anyway)"
            );
        }
        super::run_handles::remove(state, project_id, handle.agent_instance_id);
    }
}

/// Inputs for [`control_target`]. Bundled so the helper signature
/// stays inside the project's five-parameter ceiling.
struct ControlTargetInputs<'a> {
    state: &'a AppState,
    project_id: ProjectId,
    agent_id: AgentInstanceId,
    automaton_id: String,
    base_url: String,
    action: &'a ControlAction,
}

/// Apply a single control action (pause / resume / stop) against
/// one running automaton: dispatch to the harness, log any failure,
/// tear down the local registry slot accordingly, then emit the
/// matching `loop_*` domain event so subscribers observe the
/// transition.
///
/// Splits the work across three helpers so each phase stays inside
/// the per-function line budget:
///
/// * [`dispatch_control_action`] - the harness RPC + result mapping.
/// * [`tear_down_target`] - the local registry mutation that mirrors
///   the action.
/// * [`emit_control_event`] - the domain event the UI subscribes to.
async fn control_target(inputs: ControlTargetInputs<'_>) {
    let ControlTargetInputs {
        state,
        project_id,
        agent_id,
        automaton_id,
        base_url,
        action,
    } = inputs;
    let client = LocalHarness::for_configured_local_base_url(base_url.clone());
    let harness_error = match dispatch_control_action(&client, &automaton_id, action).await {
        Ok(()) => None,
        Err(error) => {
            let message = error.to_string();
            log_control_failure(action, &automaton_id, &base_url, &message);
            Some(message)
        }
    };
    tear_down_target(state, project_id, agent_id, action).await;
    emit_control_event(state, project_id, agent_id, action, harness_error);
}

/// Dispatch the action against the harness automaton. Returns the
/// raw `anyhow::Result` so [`control_target`] can capture the error
/// string (used both for the structured log row and the
/// `loop_*` event `harness_error` field).
async fn dispatch_control_action(
    client: &LocalHarness,
    automaton_id: &str,
    action: &ControlAction,
) -> anyhow::Result<()> {
    // Control RPCs carry no bearer token: the pre-migration
    // `AutomatonClient::new(base)` used here was constructed without
    // `.with_auth`, so the local harness authorized lifecycle calls by
    // request body / loopback rather than an Authorization header.
    match action {
        ControlAction::Pause => client.pause_run(automaton_id, None).await,
        ControlAction::Resume => client.resume_run(automaton_id, None).await,
        ControlAction::Stop => client.stop_run(automaton_id, None).await,
    }
}

/// Log a harness control-RPC failure. Historically this was a
/// `warn!`-only log buried in the server output, which made "UI
/// says stopped but harness is still running" effectively invisible
/// (see `loop_stop_clears_registry_even_when_harness_unreachable`
/// for why we still clear the registry regardless - that part is
/// intentional so the UI can recover when the harness is genuinely
/// dead). For `Stop` specifically, surface the failure at `error!`
/// so the streaming debug log makes the state divergence visible
/// instead of silently lying.
fn log_control_failure(action: &ControlAction, automaton_id: &str, base_url: &str, message: &str) {
    if matches!(action, ControlAction::Stop) {
        error!(
            %automaton_id,
            harness_base_url = %base_url,
            error = %message,
            "harness automaton stop request failed; clearing local registry but harness may still be running"
        );
    } else {
        warn!(
            %automaton_id,
            harness_base_url = %base_url,
            error = %message,
            "harness automaton control request failed"
        );
    }
}

/// Mirror the control action onto the local `automaton_registry`:
/// pause/resume flip the `paused` flag, stop aborts the forwarder
/// and removes the entry entirely. Runs regardless of whether the
/// harness RPC succeeded so the local view never diverges
/// permanently from "the user pressed stop".
async fn tear_down_target(
    state: &AppState,
    project_id: ProjectId,
    agent_id: AgentInstanceId,
    action: &ControlAction,
) {
    match action {
        ControlAction::Pause => set_paused(state, project_id, agent_id, true).await,
        ControlAction::Resume => set_paused(state, project_id, agent_id, false).await,
        ControlAction::Stop => abort_and_remove(state, project_id, agent_id).await,
    }
}

/// Emit the per-action `loop_paused` / `loop_resumed` /
/// `loop_stopped` domain event so subscribers see the transition.
/// Forwards the harness error string verbatim on the payload when
/// the RPC failed so the UI can render the state-divergence banner
/// instead of silently claiming the action succeeded.
fn emit_control_event(
    state: &AppState,
    project_id: ProjectId,
    agent_id: AgentInstanceId,
    action: &ControlAction,
    harness_error: Option<String>,
) {
    let event_payload = match harness_error {
        Some(err) => serde_json::json!({"harness_error": err}),
        None => serde_json::json!({}),
    };
    emit_domain_event(
        state,
        event_type(action),
        project_id,
        agent_id,
        event_payload,
    );
}

fn event_type(action: &ControlAction) -> &'static str {
    match action {
        ControlAction::Pause => "loop_paused",
        ControlAction::Resume => "loop_resumed",
        ControlAction::Stop => "loop_stopped",
    }
}
