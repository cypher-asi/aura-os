use std::sync::{atomic::AtomicBool, Arc};
use std::time::Duration;

use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::Json;

use aura_os_core::{AgentInstanceId, ProjectId, TaskId};
use aura_os_harness::connect_with_retries;

use crate::dto::LoopStatusResponse;
use crate::error::{ApiError, ApiResult};
use crate::state::{ActiveAutomaton, AppState, AuthJwt};

use super::control::control_loop;
use super::registry::{can_reuse_forwarder, replace_registry_entry, status_response};
use super::start::{build_start_params, map_start_error, resolve_start_context, start_or_adopt};
pub(crate) use super::streaming::emit_domain_event;
use super::streaming::{seed_task_output, spawn_event_forwarder};
use super::types::{ControlAction, ForwarderContext, LoopQueryParams};

const LOOP_STREAM_TIMEOUT: Duration = Duration::from_secs(24 * 60 * 60);
const TASK_STREAM_TIMEOUT: Duration = Duration::from_secs(6 * 60 * 60);

pub(crate) async fn start_loop(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    Path(project_id): Path<ProjectId>,
    Query(params): Query<LoopQueryParams>,
) -> ApiResult<(StatusCode, Json<LoopStatusResponse>)> {
    crate::handlers::billing::require_credits(&state, &jwt).await?;
    let agent_instance_id = params
        .agent_instance_id
        .unwrap_or_else(AgentInstanceId::new);
    let ctx =
        resolve_start_context(&state, project_id, agent_instance_id, &jwt, params.model).await?;
    let start_params = build_start_params(&state, &ctx, Some(jwt), None).await;
    let started = start_or_adopt(&ctx.client, start_params).await?;

    if started.adopted
        && can_reuse_forwarder(&state, agent_instance_id, &started.automaton_id).await
    {
        emit_domain_event(
            &state.event_broadcast,
            "loop_started",
            project_id,
            agent_instance_id,
            serde_json::json!({"automaton_id": started.automaton_id, "adopted": true, "reused": true}),
        );
        return Ok((
            StatusCode::OK,
            Json(status_response(&state, project_id, Some(agent_instance_id)).await),
        ));
    }

    replace_registry_entry(&state, agent_instance_id).await;
    let (events_tx, ws_reader_handle) = connect_with_retries(
        &ctx.client,
        &started.automaton_id,
        started.event_stream_url.as_deref(),
        2,
    )
    .await
    .map_err(|e| ApiError::bad_gateway(format!("connecting automaton stream: {e}")))?;

    let alive = Arc::new(AtomicBool::new(true));
    let forwarder = spawn_event_forwarder(ForwarderContext {
        state: state.clone(),
        project_id,
        agent_instance_id,
        automaton_id: started.automaton_id.clone(),
        task_id: None,
        events_tx,
        ws_reader_handle,
        alive: alive.clone(),
        timeout: LOOP_STREAM_TIMEOUT,
    });
    state.automaton_registry.lock().await.insert(
        agent_instance_id,
        ActiveAutomaton {
            automaton_id: started.automaton_id.clone(),
            project_id,
            harness_base_url: ctx.client.base_url().to_string(),
            paused: false,
            alive,
            forwarder: Some(forwarder),
            current_task_id: None,
        },
    );
    state
        .loop_log
        .on_loop_started(project_id, agent_instance_id)
        .await;
    emit_domain_event(
        &state.event_broadcast,
        "loop_started",
        project_id,
        agent_instance_id,
        serde_json::json!({"automaton_id": started.automaton_id, "adopted": started.adopted}),
    );
    Ok((
        StatusCode::CREATED,
        Json(status_response(&state, project_id, Some(agent_instance_id)).await),
    ))
}

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
    Ok(Json(status_response(&state, project_id, None).await))
}

pub(crate) async fn run_single_task(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    Path((project_id, task_id)): Path<(ProjectId, TaskId)>,
    Query(params): Query<LoopQueryParams>,
) -> ApiResult<StatusCode> {
    crate::handlers::billing::require_credits(&state, &jwt).await?;
    let agent_instance_id = params
        .agent_instance_id
        .unwrap_or_else(AgentInstanceId::new);
    let ctx =
        resolve_start_context(&state, project_id, agent_instance_id, &jwt, params.model).await?;
    let task_id = task_id.to_string();
    let result = ctx
        .client
        .start(build_start_params(&state, &ctx, Some(jwt), Some(task_id.clone())).await)
        .await
        .map_err(|e| map_start_error(ctx.client.base_url(), e))?;
    let (events_tx, ws_reader_handle) = connect_with_retries(
        &ctx.client,
        &result.automaton_id,
        Some(&result.event_stream_url),
        2,
    )
    .await
    .map_err(|e| ApiError::bad_gateway(format!("connecting task automaton stream: {e}")))?;

    seed_task_output(&state, project_id, agent_instance_id, &task_id).await;
    emit_domain_event(
        &state.event_broadcast,
        "task_started",
        project_id,
        agent_instance_id,
        serde_json::json!({"task_id": task_id}),
    );
    let alive = Arc::new(AtomicBool::new(true));
    let forwarder = spawn_event_forwarder(ForwarderContext {
        state: state.clone(),
        project_id,
        agent_instance_id,
        automaton_id: result.automaton_id.clone(),
        task_id: Some(task_id.clone()),
        events_tx,
        ws_reader_handle,
        alive: alive.clone(),
        timeout: TASK_STREAM_TIMEOUT,
    });
    replace_registry_entry(&state, agent_instance_id).await;
    state.automaton_registry.lock().await.insert(
        agent_instance_id,
        ActiveAutomaton {
            automaton_id: result.automaton_id,
            project_id,
            harness_base_url: ctx.client.base_url().to_string(),
            paused: false,
            alive,
            forwarder: Some(forwarder),
            current_task_id: Some(task_id),
        },
    );
    Ok(StatusCode::ACCEPTED)
}
