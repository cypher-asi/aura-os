use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::Json;
use serde::Deserialize;
use tracing::{info, warn};

use aura_os_core::{AgentInstanceId, ProjectId, TaskId};
use aura_os_link::AutomatonStartParams;

use crate::dto::LoopStatusResponse;
use crate::error::{ApiError, ApiResult};
use crate::state::{ActiveAutomaton, AppState};

#[derive(Debug, Deserialize, Default)]
pub(crate) struct LoopQueryParams {
    pub agent_instance_id: Option<AgentInstanceId>,
}

/// Broadcast a synthetic domain event as JSON on the global event channel.
fn emit_domain_event(
    broadcast_tx: &tokio::sync::broadcast::Sender<serde_json::Value>,
    event_type: &str,
    project_id: ProjectId,
    agent_instance_id: AgentInstanceId,
    extra: serde_json::Value,
) {
    let mut event = serde_json::json!({
        "type": event_type,
        "project_id": project_id.to_string(),
        "agent_instance_id": agent_instance_id.to_string(),
    });
    if let (Some(base), Some(ext)) = (event.as_object_mut(), extra.as_object()) {
        for (k, v) in ext {
            base.insert(k.clone(), v.clone());
        }
    }
    let _ = broadcast_tx.send(event);
}

/// Forward automaton events from the harness WebSocket to the app's global
/// event broadcast, mapping `AutomatonEvent` types to the app's domain events.
fn forward_automaton_events(
    automaton_events_tx: tokio::sync::broadcast::Sender<serde_json::Value>,
    app_broadcast: tokio::sync::broadcast::Sender<serde_json::Value>,
    project_id: ProjectId,
    agent_instance_id: AgentInstanceId,
) {
    let mut rx = automaton_events_tx.subscribe();
    let pid = project_id.to_string();
    let aiid = agent_instance_id.to_string();

    tokio::spawn(async move {
        let mut first_work_seen = false;

        loop {
            match rx.recv().await {
                Ok(event) => {
                    let event_type = event
                        .get("type")
                        .and_then(|t| t.as_str())
                        .unwrap_or("unknown");

                    // If we see any work event before a task_started, emit a
                    // synthetic task_started so the UI exits "Preparing" state.
                    // This handles the race where the real task_started was
                    // emitted before our WebSocket connected.
                    if !first_work_seen {
                        let is_work = matches!(
                            event_type,
                            "task_started"
                                | "text_delta"
                                | "thinking_delta"
                                | "tool_call_started"
                                | "tool_result"
                                | "log_line"
                        );
                        if is_work {
                            first_work_seen = true;
                            if event_type != "task_started" {
                                emit_domain_event(
                                    &app_broadcast,
                                    "task_started",
                                    project_id,
                                    agent_instance_id,
                                    serde_json::json!({}),
                                );
                            }
                        }
                    }

                    let mapped_type = match event_type {
                        "started" => Some("loop_started"),
                        "stopped" => Some("loop_stopped"),
                        "paused" => Some("loop_paused"),
                        "resumed" => Some("loop_resumed"),
                        "task_started" => Some("task_started"),
                        "task_completed" => Some("task_completed"),
                        "task_failed" => Some("task_failed"),
                        "task_retrying" => Some("task_retrying"),
                        "loop_finished" => Some("loop_finished"),
                        "token_usage" => Some("token_usage"),
                        "text_delta" => Some("text_delta"),
                        "thinking_delta" => Some("thinking_delta"),
                        "tool_call_started" => Some("tool_use_start"),
                        "tool_result" => Some("tool_result"),
                        "progress" => Some("progress"),
                        "done" => {
                            emit_domain_event(
                                &app_broadcast,
                                "loop_finished",
                                project_id,
                                agent_instance_id,
                                serde_json::json!({}),
                            );
                            break;
                        }
                        _ => None,
                    };

                    let mut forwarded = event.clone();
                    if let Some(obj) = forwarded.as_object_mut() {
                        obj.insert(
                            "project_id".into(),
                            serde_json::Value::String(pid.clone()),
                        );
                        obj.insert(
                            "agent_instance_id".into(),
                            serde_json::Value::String(aiid.clone()),
                        );
                        if let Some(mapped) = mapped_type {
                            obj.insert(
                                "type".into(),
                                serde_json::Value::String(mapped.into()),
                            );
                        }
                    }
                    let _ = app_broadcast.send(forwarded);
                }
                Err(tokio::sync::broadcast::error::RecvError::Closed) => {
                    emit_domain_event(
                        &app_broadcast,
                        "loop_finished",
                        project_id,
                        agent_instance_id,
                        serde_json::json!({}),
                    );
                    break;
                }
                Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => continue,
            }
        }
    });
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

    let jwt = state.get_jwt().ok();
    let project_path = state
        .project_service
        .get_project(&project_id)
        .ok()
        .map(|p| p.linked_folder_path)
        .filter(|s| !s.is_empty());

    let result = state
        .automaton_client
        .start(AutomatonStartParams {
            project_id: project_id.to_string(),
            auth_token: jwt,
            model: None,
            workspace_root: project_path,
            task_id: None,
        })
        .await
        .map_err(|e| ApiError::internal(format!("starting dev loop: {e}")))?;

    let automaton_id = result.automaton_id.clone();
    info!(
        %project_id,
        %agent_instance_id,
        %automaton_id,
        "Dev loop automaton started"
    );

    emit_domain_event(
        &state.event_broadcast,
        "loop_started",
        project_id,
        agent_instance_id,
        serde_json::json!({"automaton_id": &automaton_id}),
    );

    // Connect to the automaton event stream and start forwarding.
    // Note: events emitted before the WebSocket connects are lost, so we
    // emit a synthetic task_started if the first real one was missed.
    let events_tx = state
        .automaton_client
        .connect_event_stream(&automaton_id)
        .await
        .map_err(|e| ApiError::internal(format!("connecting event stream: {e}")))?;

    forward_automaton_events(
        events_tx,
        state.event_broadcast.clone(),
        project_id,
        agent_instance_id,
    );

    {
        let mut reg = state.automaton_registry.lock().await;
        reg.insert(
            agent_instance_id,
            ActiveAutomaton {
                automaton_id: automaton_id.clone(),
                project_id,
            },
        );
    }

    let active_agent_instances = active_instances(&state, project_id).await;

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
        .filter(|(_, a)| a.project_id == project_id)
        .filter(|(aiid, _)| params.agent_instance_id.is_none_or(|t| **aiid == t))
        .map(|(aiid, a)| (*aiid, a.automaton_id.clone()))
        .collect();
    drop(reg);

    if targets.is_empty() {
        return Err(ApiError::bad_request("no matching dev loop is running"));
    }

    for (aiid, automaton_id) in &targets {
        if let Err(e) = state.automaton_client.pause(automaton_id).await {
            warn!(automaton_id, error = %e, "Failed to pause automaton");
        }
        emit_domain_event(
            &state.event_broadcast,
            "loop_paused",
            project_id,
            *aiid,
            serde_json::json!({}),
        );
    }

    let active_agent_instances = active_instances(&state, project_id).await;

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
        .filter(|(_, a)| a.project_id == project_id)
        .filter(|(aiid, _)| params.agent_instance_id.is_none_or(|t| **aiid == t))
        .map(|(aiid, a)| (*aiid, a.automaton_id.clone()))
        .collect();

    if targets.is_empty() {
        drop(reg);
        return Err(ApiError::bad_request("no matching dev loop is running"));
    }

    for (aiid, automaton_id) in &targets {
        if let Err(e) = state.automaton_client.stop(automaton_id).await {
            warn!(automaton_id, error = %e, "Failed to stop automaton");
        }
        reg.remove(aiid);
        emit_domain_event(
            &state.event_broadcast,
            "loop_stopped",
            project_id,
            *aiid,
            serde_json::json!({}),
        );
    }

    let remaining: Vec<AgentInstanceId> = reg
        .iter()
        .filter(|(_, a)| a.project_id == project_id)
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
    let active = active_instances(&state, project_id).await;

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

    let agent_instance_id = params
        .agent_instance_id
        .unwrap_or_else(AgentInstanceId::new);

    let jwt = state.get_jwt().ok();
    let project_path = state
        .project_service
        .get_project(&project_id)
        .ok()
        .map(|p| p.linked_folder_path)
        .filter(|s| !s.is_empty());

    let result = state
        .automaton_client
        .start(AutomatonStartParams {
            project_id: project_id.to_string(),
            auth_token: jwt,
            model: None,
            workspace_root: project_path,
            task_id: Some(task_id.to_string()),
        })
        .await
        .map_err(|e| ApiError::internal(format!("starting task runner: {e}")))?;

    let automaton_id = result.automaton_id;
    info!(%project_id, %task_id, %automaton_id, "Single task automaton started");

    if let Ok(events_tx) = state
        .automaton_client
        .connect_event_stream(&automaton_id)
        .await
    {
        forward_automaton_events(
            events_tx,
            state.event_broadcast.clone(),
            project_id,
            agent_instance_id,
        );
    }

    Ok(StatusCode::ACCEPTED)
}

async fn active_instances(state: &AppState, project_id: ProjectId) -> Vec<AgentInstanceId> {
    let reg = state.automaton_registry.lock().await;
    reg.iter()
        .filter(|(_, a)| a.project_id == project_id)
        .map(|(aiid, _)| *aiid)
        .collect()
}
