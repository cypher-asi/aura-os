use axum::Json;
use tracing::warn;

use aura_os_core::{AgentInstanceId, ProjectId};
use aura_os_harness::AutomatonClient;

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
        control_target(state, project_id, agent_id, automaton_id, base_url, &action).await;
    }
    Ok(Json(status_response(state, project_id, only_agent).await))
}

async fn control_target(
    state: &AppState,
    project_id: ProjectId,
    agent_id: AgentInstanceId,
    automaton_id: String,
    base_url: String,
    action: &ControlAction,
) {
    let client = AutomatonClient::new(&base_url);
    let result = match action {
        ControlAction::Pause => client.pause(&automaton_id).await,
        ControlAction::Resume => client.resume(&automaton_id).await,
        ControlAction::Stop => client.stop(&automaton_id).await,
    };
    if let Err(error) = result {
        warn!(%automaton_id, %error, "harness automaton control request failed");
    }
    match action {
        ControlAction::Pause => set_paused(state, project_id, agent_id, true).await,
        ControlAction::Resume => set_paused(state, project_id, agent_id, false).await,
        ControlAction::Stop => abort_and_remove(state, project_id, agent_id).await,
    }
    emit_domain_event(
        state,
        event_type(action),
        project_id,
        agent_id,
        serde_json::json!({}),
    );
}

fn event_type(action: &ControlAction) -> &'static str {
    match action {
        ControlAction::Pause => "loop_paused",
        ControlAction::Resume => "loop_resumed",
        ControlAction::Stop => "loop_stopped",
    }
}
