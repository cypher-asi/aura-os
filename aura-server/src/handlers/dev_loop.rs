use std::sync::Arc;

use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::Json;
use serde::Deserialize;

use aura_core::{AgentId, ProjectId, TaskId};
use aura_engine::DevLoopEngine;

use crate::dto::LoopStatusResponse;
use crate::error::{ApiError, ApiResult};
use crate::state::AppState;

#[derive(Debug, Deserialize, Default)]
pub struct LoopQueryParams {
    pub agent_id: Option<AgentId>,
    pub agent_name: Option<String>,
}

pub async fn start_loop(
    State(state): State<AppState>,
    Path(project_id): Path<ProjectId>,
    Query(params): Query<LoopQueryParams>,
) -> ApiResult<(StatusCode, Json<LoopStatusResponse>)> {
    state.gc_finished_loops().await;

    let engine = Arc::new(
        DevLoopEngine::new(
            state.store.clone(),
            state.settings_service.clone(),
            state.claude_client.clone(),
            state.project_service.clone(),
            state.task_service.clone(),
            state.agent_service.clone(),
            state.session_service.clone(),
            state.event_tx.clone(),
        )
        .with_write_coordinator(state.write_coordinator.clone()),
    );

    let loop_handle = engine
        .start(project_id, params.agent_name)
        .await
        .map_err(|e| ApiError::internal(e.to_string()))?;

    let agent_id = loop_handle.agent_id;
    let active_agents = {
        let mut reg = state.loop_registry.lock().await;
        reg.insert(agent_id, loop_handle);
        reg.iter()
            .filter(|(_, h)| h.project_id == project_id && !h.is_finished())
            .map(|(aid, _)| *aid)
            .collect::<Vec<_>>()
    };

    Ok((
        StatusCode::CREATED,
        Json(LoopStatusResponse {
            running: true,
            paused: false,
            project_id: Some(project_id),
            agent_id: Some(agent_id),
            active_agents: Some(active_agents),
        }),
    ))
}

pub async fn pause_loop(
    State(state): State<AppState>,
    Path(project_id): Path<ProjectId>,
    Query(params): Query<LoopQueryParams>,
) -> ApiResult<Json<LoopStatusResponse>> {
    state.gc_finished_loops().await;
    let reg = state.loop_registry.lock().await;

    let mut paused_any = false;
    for (aid, handle) in reg.iter() {
        if handle.project_id == project_id && !handle.is_finished() {
            if let Some(target) = params.agent_id {
                if *aid == target {
                    handle.pause();
                    paused_any = true;
                }
            } else {
                handle.pause();
                paused_any = true;
            }
        }
    }

    if !paused_any {
        return Err(ApiError::bad_request("no matching dev loop is running"));
    }

    let active_agents: Vec<AgentId> = reg
        .iter()
        .filter(|(_, h)| h.project_id == project_id && !h.is_finished())
        .map(|(aid, _)| *aid)
        .collect();

    Ok(Json(LoopStatusResponse {
        running: true,
        paused: true,
        project_id: Some(project_id),
        agent_id: params.agent_id,
        active_agents: Some(active_agents),
    }))
}

pub async fn stop_loop(
    State(state): State<AppState>,
    Path(project_id): Path<ProjectId>,
    Query(params): Query<LoopQueryParams>,
) -> ApiResult<Json<LoopStatusResponse>> {
    state.gc_finished_loops().await;
    let mut reg = state.loop_registry.lock().await;

    let mut stopped_any = false;
    let agents_to_remove: Vec<AgentId> = reg
        .iter()
        .filter(|(_, h)| h.project_id == project_id && !h.is_finished())
        .filter(|(aid, _)| params.agent_id.map_or(true, |t| **aid == t))
        .map(|(aid, _)| *aid)
        .collect();

    for aid in &agents_to_remove {
        if let Some(h) = reg.remove(aid) {
            h.stop();
            stopped_any = true;
        }
    }

    if !stopped_any {
        return Err(ApiError::bad_request("no matching dev loop is running"));
    }

    let remaining: Vec<AgentId> = reg
        .iter()
        .filter(|(_, h)| h.project_id == project_id && !h.is_finished())
        .map(|(aid, _)| *aid)
        .collect();

    Ok(Json(LoopStatusResponse {
        running: !remaining.is_empty(),
        paused: false,
        project_id: Some(project_id),
        agent_id: params.agent_id,
        active_agents: Some(remaining),
    }))
}

pub async fn get_loop_status(
    State(state): State<AppState>,
    Path(project_id): Path<ProjectId>,
) -> ApiResult<Json<LoopStatusResponse>> {
    state.gc_finished_loops().await;
    let active = state.loops_for_project(&project_id).await;

    Ok(Json(LoopStatusResponse {
        running: !active.is_empty(),
        paused: false,
        project_id: Some(project_id),
        agent_id: None,
        active_agents: Some(active),
    }))
}

pub async fn run_single_task(
    State(state): State<AppState>,
    Path((project_id, task_id)): Path<(ProjectId, TaskId)>,
) -> ApiResult<StatusCode> {
    let engine = Arc::new(
        DevLoopEngine::new(
            state.store.clone(),
            state.settings_service.clone(),
            state.claude_client.clone(),
            state.project_service.clone(),
            state.task_service.clone(),
            state.agent_service.clone(),
            state.session_service.clone(),
            state.event_tx.clone(),
        )
        .with_write_coordinator(state.write_coordinator.clone()),
    );

    let event_tx = state.event_tx.clone();
    tokio::spawn(async move {
        if let Err(e) = engine.run_single_task(project_id, task_id).await {
            let _ = event_tx.send(aura_engine::EngineEvent::TaskFailed {
                project_id,
                agent_id: aura_core::AgentId::new(),
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
