use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::Json;
use serde::Deserialize;
use tracing::{info, warn};

use aura_os_core::{AgentInstanceId, ProjectId, TaskId};
use aura_os_link::{AutomatonStartError, AutomatonStartParams};

use super::agents::conversions_pub::resolve_workspace_path;
use crate::dto::LoopStatusResponse;
use crate::error::{ApiError, ApiResult};
use crate::state::{ActiveAutomaton, AppState, AutomatonRegistry};

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
    automaton_registry: AutomatonRegistry,
    project_id: ProjectId,
    agent_instance_id: AgentInstanceId,
    task_id: Option<String>,
) {
    let mut rx = automaton_events_tx.subscribe();
    let pid = project_id.to_string();
    let aiid = agent_instance_id.to_string();

    tokio::spawn(async move {
        let mut first_work_seen = false;
        let clear_active_automaton = |registry: AutomatonRegistry, project_id: ProjectId, agent_instance_id: AgentInstanceId| async move {
            let mut reg = registry.lock().await;
            if reg
                .get(&agent_instance_id)
                .is_some_and(|entry| entry.project_id == project_id)
            {
                reg.remove(&agent_instance_id);
            }
        };

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
                                let extra = match &task_id {
                                    Some(tid) => serde_json::json!({"task_id": tid}),
                                    None => serde_json::json!({}),
                                };
                                emit_domain_event(
                                    &app_broadcast,
                                    "task_started",
                                    project_id,
                                    agent_instance_id,
                                    extra,
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
                            clear_active_automaton(
                                automaton_registry.clone(),
                                project_id,
                                agent_instance_id,
                            )
                                .await;
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
                        obj.insert("project_id".into(), serde_json::Value::String(pid.clone()));
                        obj.insert(
                            "agent_instance_id".into(),
                            serde_json::Value::String(aiid.clone()),
                        );
                        if let Some(ref tid) = task_id {
                            obj.insert("task_id".into(), serde_json::Value::String(tid.clone()));
                        }
                        if let Some(mapped) = mapped_type {
                            obj.insert("type".into(), serde_json::Value::String(mapped.into()));
                        }
                    }
                    let _ = app_broadcast.send(forwarded);
                }
                Err(tokio::sync::broadcast::error::RecvError::Closed) => {
                    clear_active_automaton(
                        automaton_registry.clone(),
                        project_id,
                        agent_instance_id,
                    )
                        .await;
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
    let project = state.project_service.get_project(&project_id).ok();
    let project_folder = project.as_ref().map(|p| p.linked_folder_path.clone());
    let project_name = project.as_ref().map(|p| p.name.as_str()).unwrap_or("");
    let machine_type = state
        .agent_instance_service
        .get_instance(&project_id, &agent_instance_id)
        .await
        .map(|inst| inst.machine_type)
        .unwrap_or_else(|_| "local".to_string());
    let project_path = resolve_workspace_path(
        &machine_type,
        &project_id.to_string(),
        project_folder.as_deref(),
        &state.data_dir,
        project_name,
    );

    let start_params = AutomatonStartParams {
        project_id: project_id.to_string(),
        auth_token: jwt,
        model: None,
        workspace_root: Some(project_path),
        task_id: None,
    };

    let (automaton_id, adopted) = match state.automaton_client.start(start_params).await {
        Ok(r) => (r.automaton_id, false),
        Err(AutomatonStartError::Conflict(existing_id)) => {
            // An automaton is already running for this project in the harness.
            // This happens when the LLM conversation started the loop via a tool
            // call, or after a server restart that cleared our in-memory registry.
            // Adopt it: register it in our registry and connect to its event stream
            // so both the play button and the conversation share the same loop.
            match existing_id {
                Some(aid) => {
                    info!(%aid, %project_id, "Adopting existing automaton from harness");
                    (aid, true)
                }
                None => {
                    return Err(ApiError::conflict(
                        "A dev loop is already running but its ID could not be determined",
                    ));
                }
            }
        }
        Err(e) => return Err(ApiError::internal(format!("starting dev loop: {e}"))),
    };

    info!(
        %project_id,
        %agent_instance_id,
        %automaton_id,
        adopted,
        "Dev loop automaton ready"
    );

    // Attach the event stream before advertising success: if this fails, the
    // client must not see loop_started or a registered automaton (including
    // when adopting an existing harness automaton).
    let events_tx = state
        .automaton_client
        .connect_event_stream(&automaton_id)
        .await
        .map_err(|e| {
            ApiError::internal(format!(
                "connecting event stream for dev loop (adopted={adopted}): {e}"
            ))
        })?;

    forward_automaton_events(
        events_tx,
        state.event_broadcast.clone(),
        state.automaton_registry.clone(),
        project_id,
        agent_instance_id,
        None,
    );

    emit_domain_event(
        &state.event_broadcast,
        "loop_started",
        project_id,
        agent_instance_id,
        serde_json::json!({"automaton_id": &automaton_id, "adopted": adopted}),
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
    let project = state.project_service.get_project(&project_id).ok();
    let project_folder = project.as_ref().map(|p| p.linked_folder_path.clone());
    let project_name = project.as_ref().map(|p| p.name.as_str()).unwrap_or("");
    let machine_type = state
        .agent_instance_service
        .get_instance(&project_id, &agent_instance_id)
        .await
        .map(|inst| inst.machine_type)
        .unwrap_or_else(|_| "local".to_string());
    let project_path = resolve_workspace_path(
        &machine_type,
        &project_id.to_string(),
        project_folder.as_deref(),
        &state.data_dir,
        project_name,
    );

    let result = state
        .automaton_client
        .start(AutomatonStartParams {
            project_id: project_id.to_string(),
            auth_token: jwt,
            model: None,
            workspace_root: Some(project_path),
            task_id: Some(task_id.to_string()),
        })
        .await
        .map_err(|e| match e {
            AutomatonStartError::Conflict(_) => {
                ApiError::conflict(format!("starting task runner: {e}"))
            }
            _ => ApiError::internal(format!("starting task runner: {e}")),
        })?;

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
            state.automaton_registry.clone(),
            project_id,
            agent_instance_id,
            Some(task_id.to_string()),
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
