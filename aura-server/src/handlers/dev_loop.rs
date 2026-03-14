use std::sync::Arc;

use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::Json;

use aura_core::{ProjectId, TaskId};
use aura_engine::DevLoopEngine;

use crate::dto::LoopStatusResponse;
use crate::error::{ApiError, ApiResult};
use crate::state::AppState;

pub async fn start_loop(
    State(state): State<AppState>,
    Path(project_id): Path<ProjectId>,
) -> ApiResult<(StatusCode, Json<LoopStatusResponse>)> {
    let mut handle_lock = state.loop_handle.lock().await;
    if let Some(h) = handle_lock.as_ref() {
        if h.is_finished() {
            handle_lock.take();
            *state.loop_project_id.lock().await = None;
        } else {
            return Err(ApiError::conflict("a dev loop is already running"));
        }
    }

    let engine = Arc::new(DevLoopEngine::new(
        state.store.clone(),
        state.settings_service.clone(),
        state.claude_client.clone(),
        state.project_service.clone(),
        state.task_service.clone(),
        state.agent_service.clone(),
        state.session_service.clone(),
        state.event_tx.clone(),
    ));

    let loop_handle = engine
        .start(project_id)
        .await
        .map_err(|e| ApiError::internal(e.to_string()))?;

    *handle_lock = Some(loop_handle);
    *state.loop_project_id.lock().await = Some(project_id);

    Ok((
        StatusCode::CREATED,
        Json(LoopStatusResponse {
            running: true,
            paused: false,
            project_id: Some(project_id),
        }),
    ))
}

pub async fn pause_loop(
    State(state): State<AppState>,
    Path(_project_id): Path<ProjectId>,
) -> ApiResult<Json<LoopStatusResponse>> {
    let handle_lock = state.loop_handle.lock().await;
    match handle_lock.as_ref() {
        Some(h) => {
            h.pause();
            let pid = *state.loop_project_id.lock().await;
            Ok(Json(LoopStatusResponse {
                running: true,
                paused: true,
                project_id: pid,
            }))
        }
        None => Err(ApiError::bad_request("no dev loop is running")),
    }
}

pub async fn stop_loop(
    State(state): State<AppState>,
    Path(_project_id): Path<ProjectId>,
) -> ApiResult<Json<LoopStatusResponse>> {
    let mut handle_lock = state.loop_handle.lock().await;
    match handle_lock.take() {
        Some(h) => {
            h.stop();
            *state.loop_project_id.lock().await = None;
            Ok(Json(LoopStatusResponse {
                running: false,
                paused: false,
                project_id: None,
            }))
        }
        None => Err(ApiError::bad_request("no dev loop is running")),
    }
}

pub async fn run_single_task(
    State(state): State<AppState>,
    Path((project_id, task_id)): Path<(ProjectId, TaskId)>,
) -> ApiResult<StatusCode> {
    let mut handle_lock = state.loop_handle.lock().await;
    if let Some(h) = handle_lock.as_ref() {
        if h.is_finished() {
            handle_lock.take();
            *state.loop_project_id.lock().await = None;
        } else {
            return Err(ApiError::conflict("cannot run a single task while the dev loop is active"));
        }
    }
    drop(handle_lock);

    let engine = Arc::new(DevLoopEngine::new(
        state.store.clone(),
        state.settings_service.clone(),
        state.claude_client.clone(),
        state.project_service.clone(),
        state.task_service.clone(),
        state.agent_service.clone(),
        state.session_service.clone(),
        state.event_tx.clone(),
    ));

    let event_tx = state.event_tx.clone();
    tokio::spawn(async move {
        if let Err(e) = engine.run_single_task(project_id, task_id).await {
            let _ = event_tx.send(aura_engine::EngineEvent::TaskFailed {
                task_id,
                reason: e.to_string(),
                duration_ms: None,
                phase: None,
                parse_retries: None,
                build_fix_attempts: None,
                model: None,
            });
        }
    });

    Ok(StatusCode::ACCEPTED)
}
