//! Axum route surface for the dev-loop: hosts the cold-start, single-task, pause/resume/stop/status handlers, and re-exports the shared `emit_domain_event` helper for sibling modules.

mod common;
mod run_single;
mod start_loop;

use axum::extract::{Path, Query, State};
use axum::Json;

use aura_os_core::ProjectId;

use crate::dto::LoopStatusResponse;
use crate::error::ApiResult;
use crate::state::AppState;

use super::control::control_loop;
use super::registry::status_response;
use super::types::{ControlAction, LoopQueryParams};

pub(crate) use super::streaming::emit_domain_event;

pub(crate) use run_single::run_single_task;
pub(crate) use start_loop::start_loop;

pub(crate) async fn pause_loop(
    State(state): State<AppState>,
    Path(project_id): Path<ProjectId>,
    Query(params): Query<LoopQueryParams>,
) -> ApiResult<Json<LoopStatusResponse>> {
    control_loop(
        &state,
        project_id,
        params.agent_instance_id,
        ControlAction::Pause,
    )
    .await
}

pub(crate) async fn stop_loop(
    State(state): State<AppState>,
    Path(project_id): Path<ProjectId>,
    Query(params): Query<LoopQueryParams>,
) -> ApiResult<Json<LoopStatusResponse>> {
    control_loop(
        &state,
        project_id,
        params.agent_instance_id,
        ControlAction::Stop,
    )
    .await
}

pub(crate) async fn resume_loop(
    State(state): State<AppState>,
    Path(project_id): Path<ProjectId>,
    Query(params): Query<LoopQueryParams>,
) -> ApiResult<Json<LoopStatusResponse>> {
    control_loop(
        &state,
        project_id,
        params.agent_instance_id,
        ControlAction::Resume,
    )
    .await
}

pub(crate) async fn get_loop_status(
    State(state): State<AppState>,
    Path(project_id): Path<ProjectId>,
) -> ApiResult<Json<LoopStatusResponse>> {
    let mut response = status_response(&state, project_id, None).await;
    // Registry says idle, but a previous server process may have left
    // a still-running harness automaton behind (the registry and event
    // forwarder are in-memory and die with the process). Probe any
    // persisted run handles; when one is alive, report
    // `loop_state: "detached"` so the frontend can re-adopt it through
    // the ordinary `POST /loop/start` conflict path and re-light the
    // AutomationBar / spinners.
    if !response.running {
        if let Some(handle) = super::run_handles::find_detached_run(&state, project_id).await {
            response.running = true;
            response.loop_state = Some("detached".to_string());
            response.agent_instance_id = Some(handle.agent_instance_id);
            response.active_agent_instances = Some(vec![handle.agent_instance_id]);
        }
    }
    Ok(Json(response))
}
