use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::Json;
use serde::Deserialize;
use tracing::info;

use aura_os_core::{AgentInstanceId, HarnessMode, ProjectId, TaskId};
use aura_os_link::{HarnessInbound, SessionConfig};

use crate::dto::LoopStatusResponse;
use crate::error::{ApiError, ApiResult};
use crate::state::{ActiveHarnessSession, AppState};

#[derive(Debug, Deserialize, Default)]
pub(crate) struct LoopQueryParams {
    pub agent_instance_id: Option<AgentInstanceId>,
}

fn forward_harness_events(
    mut events_rx: tokio::sync::mpsc::UnboundedReceiver<aura_os_link::HarnessOutbound>,
    broadcast_tx: tokio::sync::broadcast::Sender<serde_json::Value>,
) {
    tokio::spawn(async move {
        while let Some(event) = events_rx.recv().await {
            let json = serde_json::to_value(&event).unwrap_or_default();
            let _ = broadcast_tx.send(json);
        }
    });
}

async fn active_instances_for_project_harness(
    state: &AppState,
    project_id: ProjectId,
) -> Vec<AgentInstanceId> {
    let reg = state.harness_sessions.lock().await;
    reg.iter()
        .filter(|(_, s)| s.project_id == project_id)
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

    let harness_mode = if let Some(aiid) = params.agent_instance_id {
        state
            .agent_instance_service
            .get_instance(&project_id, &aiid)
            .await
            .map(|inst| inst.harness_mode())
            .unwrap_or(HarnessMode::Local)
    } else {
        HarnessMode::Local
    };
    let harness = state.harness_for(harness_mode);
    let session = harness
        .open_session(SessionConfig {
            agent_id: Some(agent_instance_id.to_string()),
            ..Default::default()
        })
        .await
        .map_err(|e| ApiError::internal(format!("opening dev loop session: {e}")))?;

    let session_id = session.session_id.clone();
    let commands_tx = session.commands_tx.clone();

    info!(
        %project_id,
        %agent_instance_id,
        %session_id,
        "Dev loop harness session opened"
    );

    commands_tx
        .send(HarnessInbound::UserMessage {
            content: format!("Start dev loop for project {project_id}"),
        })
        .map_err(|e| ApiError::internal(format!("sending dev loop start: {e}")))?;

    forward_harness_events(session.events_rx, state.event_broadcast.clone());
    {
        let mut reg = state.harness_sessions.lock().await;
        reg.insert(agent_instance_id, ActiveHarnessSession {
            session_id,
            commands_tx,
            project_id,
        });
    }
    let active_agent_instances = active_instances_for_project_harness(&state, project_id).await;

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
    let reg = state.harness_sessions.lock().await;

    let targets: Vec<AgentInstanceId> = reg
        .iter()
        .filter(|(_, s)| s.project_id == project_id)
        .filter(|(aiid, _)| params.agent_instance_id.is_none_or(|t| **aiid == t))
        .map(|(aiid, _)| *aiid)
        .collect();
    drop(reg);

    if targets.is_empty() {
        return Err(ApiError::bad_request("no matching dev loop is running"));
    }

    for aiid in &targets {
        let reg = state.harness_sessions.lock().await;
        if let Some(session) = reg.get(aiid) {
            let _ = session.commands_tx.send(HarnessInbound::Cancel);
        }
    }

    let active_agent_instances = active_instances_for_project_harness(&state, project_id).await;

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
    let mut reg = state.harness_sessions.lock().await;

    let targets: Vec<AgentInstanceId> = reg
        .iter()
        .filter(|(_, s)| s.project_id == project_id)
        .filter(|(aiid, _)| params.agent_instance_id.is_none_or(|t| **aiid == t))
        .map(|(aiid, _)| *aiid)
        .collect();

    if targets.is_empty() {
        return Err(ApiError::bad_request("no matching dev loop is running"));
    }

    for aiid in &targets {
        if let Some(session) = reg.remove(aiid) {
            let _ = session.commands_tx.send(HarnessInbound::Cancel);
        }
    }

    let remaining: Vec<AgentInstanceId> = reg
        .iter()
        .filter(|(_, s)| s.project_id == project_id)
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
    let mut reg = state.harness_sessions.lock().await;

    let mut to_remove = Vec::new();
    for (aiid, session) in reg.iter() {
        if session.project_id == project_id && session.commands_tx.is_closed() {
            to_remove.push(*aiid);
        }
    }
    for aiid in &to_remove {
        reg.remove(aiid);
    }

    let active: Vec<AgentInstanceId> = reg
        .iter()
        .filter(|(_, s)| s.project_id == project_id)
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

    let harness_mode = if let Some(aiid) = params.agent_instance_id {
        state
            .agent_instance_service
            .get_instance(&project_id, &aiid)
            .await
            .map(|inst| inst.harness_mode())
            .unwrap_or(HarnessMode::Local)
    } else {
        HarnessMode::Local
    };
    let harness = state.harness_for(harness_mode);
    let session = harness
        .open_session(SessionConfig {
            agent_id: params.agent_instance_id.map(|id| id.to_string()),
            ..Default::default()
        })
        .await
        .map_err(|e| ApiError::internal(format!("opening task runner session: {e}")))?;

    session
        .commands_tx
        .send(HarnessInbound::UserMessage {
            content: format!("Execute task {task_id} in project {project_id}"),
        })
        .map_err(|e| ApiError::internal(format!("sending task run command: {e}")))?;

    forward_harness_events(session.events_rx, state.event_broadcast.clone());

    Ok(StatusCode::ACCEPTED)
}
