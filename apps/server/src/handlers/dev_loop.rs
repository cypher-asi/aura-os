use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::Json;
use serde::Deserialize;
use tracing::info;

use aura_os_core::{AgentInstanceId, ProjectId, TaskId};

use crate::dto::LoopStatusResponse;
use crate::error::{ApiError, ApiResult};
use crate::state::AppState;

#[derive(Debug, Deserialize, Default)]
pub(crate) struct LoopQueryParams {
    pub agent_instance_id: Option<AgentInstanceId>,
    pub agent_name: Option<String>,
}

async fn forward_automaton_events(state: &AppState, automaton_id: &str) {
    if let Ok(mut events_rx) = state.swarm_client.events(automaton_id).await {
        let broadcast_tx = state.event_broadcast.clone();
        tokio::spawn(async move {
            while let Some(event) = events_rx.recv().await {
                let json = serde_json::to_value(&event).unwrap_or_default();
                let _ = broadcast_tx.send(json);
            }
        });
    }
}

async fn active_instances_for_project(
    state: &AppState,
    project_id: ProjectId,
) -> Vec<AgentInstanceId> {
    let reg = state.automaton_registry.lock().await;
    reg.iter()
        .filter(|(_, (_, pid))| *pid == project_id)
        .map(|(aiid, _)| *aiid)
        .collect()
}

pub(crate) async fn start_loop(
    State(state): State<AppState>,
    Path(project_id): Path<ProjectId>,
    Query(params): Query<LoopQueryParams>,
) -> ApiResult<(StatusCode, Json<LoopStatusResponse>)> {
    super::billing::require_credits(&state).await?;

    let agent_instance_id = params
        .agent_instance_id
        .unwrap_or_else(AgentInstanceId::new);

    let config = serde_json::json!({
        "project_id": project_id.to_string(),
        "agent_instance_id": agent_instance_id.to_string(),
    });

    let resp = state
        .swarm_client
        .install("dev-loop", config)
        .await
        .map_err(|e| ApiError::internal(format!("installing dev loop agent: {e}")))?;

    info!(
        %project_id,
        %agent_instance_id,
        automaton_id = %resp.automaton_id,
        "Dev loop automaton installed"
    );

    forward_automaton_events(&state, &resp.automaton_id).await;
    {
        let mut reg = state.automaton_registry.lock().await;
        reg.insert(agent_instance_id, (resp.automaton_id, project_id));
    }
    let active_agent_instances = active_instances_for_project(&state, project_id).await;

    Ok((
        StatusCode::CREATED,
        Json(LoopStatusResponse {
            running: true,
            paused: false,
            project_id: Some(project_id),
            agent_instance_id: Some(agent_instance_id),
            active_agent_instances: Some(active_agent_instances),
        }),
    ))
}

pub(crate) async fn pause_loop(
    State(state): State<AppState>,
    Path(project_id): Path<ProjectId>,
    Query(params): Query<LoopQueryParams>,
) -> ApiResult<Json<LoopStatusResponse>> {
    let reg = state.automaton_registry.lock().await;

    let targets: Vec<(AgentInstanceId, String)> = reg
        .iter()
        .filter(|(_, (_, pid))| *pid == project_id)
        .filter(|(aiid, _)| params.agent_instance_id.is_none_or(|t| **aiid == t))
        .map(|(aiid, (auto_id, _))| (*aiid, auto_id.clone()))
        .collect();
    drop(reg);

    if targets.is_empty() {
        return Err(ApiError::bad_request("no matching dev loop is running"));
    }

    for (_, automaton_id) in &targets {
        state
            .swarm_client
            .pause(automaton_id)
            .await
            .map_err(|e| ApiError::internal(format!("pausing dev loop: {e}")))?;
    }

    let active_agent_instances = {
        let reg = state.automaton_registry.lock().await;
        reg.iter()
            .filter(|(_, (_, pid))| *pid == project_id)
            .map(|(aiid, _)| *aiid)
            .collect::<Vec<_>>()
    };

    Ok(Json(LoopStatusResponse {
        running: true,
        paused: true,
        project_id: Some(project_id),
        agent_instance_id: params.agent_instance_id,
        active_agent_instances: Some(active_agent_instances),
    }))
}

pub(crate) async fn stop_loop(
    State(state): State<AppState>,
    Path(project_id): Path<ProjectId>,
    Query(params): Query<LoopQueryParams>,
) -> ApiResult<Json<LoopStatusResponse>> {
    let mut reg = state.automaton_registry.lock().await;

    let targets: Vec<(AgentInstanceId, String)> = reg
        .iter()
        .filter(|(_, (_, pid))| *pid == project_id)
        .filter(|(aiid, _)| params.agent_instance_id.is_none_or(|t| **aiid == t))
        .map(|(aiid, (auto_id, _))| (*aiid, auto_id.clone()))
        .collect();

    if targets.is_empty() {
        return Err(ApiError::bad_request("no matching dev loop is running"));
    }

    for (aiid, automaton_id) in &targets {
        state
            .swarm_client
            .stop(automaton_id)
            .await
            .map_err(|e| ApiError::internal(format!("stopping dev loop: {e}")))?;
        reg.remove(aiid);
    }

    let remaining: Vec<AgentInstanceId> = reg
        .iter()
        .filter(|(_, (_, pid))| *pid == project_id)
        .map(|(aiid, _)| *aiid)
        .collect();
    drop(reg);

    Ok(Json(LoopStatusResponse {
        running: !remaining.is_empty(),
        paused: false,
        project_id: Some(project_id),
        agent_instance_id: params.agent_instance_id,
        active_agent_instances: Some(remaining),
    }))
}

pub(crate) async fn get_loop_status(
    State(state): State<AppState>,
    Path(project_id): Path<ProjectId>,
) -> ApiResult<Json<LoopStatusResponse>> {
    let mut reg = state.automaton_registry.lock().await;

    // Prune finished automatons
    let mut to_remove = Vec::new();
    for (aiid, (automaton_id, pid)) in reg.iter() {
        if *pid == project_id {
            match state.swarm_client.status(automaton_id).await {
                Ok(s) if s.status == "stopped" || s.status == "finished" => {
                    to_remove.push(*aiid);
                }
                Err(_) => {
                    to_remove.push(*aiid);
                }
                _ => {}
            }
        }
    }
    for aiid in &to_remove {
        reg.remove(aiid);
    }

    let active: Vec<AgentInstanceId> = reg
        .iter()
        .filter(|(_, (_, pid))| *pid == project_id)
        .map(|(aiid, _)| *aiid)
        .collect();
    drop(reg);

    Ok(Json(LoopStatusResponse {
        running: !active.is_empty(),
        paused: false,
        project_id: Some(project_id),
        agent_instance_id: None,
        active_agent_instances: Some(active),
    }))
}

pub(crate) async fn run_single_task(
    State(state): State<AppState>,
    Path((project_id, task_id)): Path<(ProjectId, TaskId)>,
    Query(params): Query<LoopQueryParams>,
) -> ApiResult<StatusCode> {
    super::billing::require_credits(&state).await?;

    let config = serde_json::json!({
        "project_id": project_id.to_string(),
        "task_id": task_id.to_string(),
        "agent_instance_id": params.agent_instance_id.map(|id| id.to_string()),
    });

    let resp = state
        .swarm_client
        .install("task-run", config)
        .await
        .map_err(|e| ApiError::internal(format!("installing single task runner: {e}")))?;

    forward_automaton_events(&state, &resp.automaton_id).await;

    Ok(StatusCode::ACCEPTED)
}
