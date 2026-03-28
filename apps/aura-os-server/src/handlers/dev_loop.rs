use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::Json;
use serde::Deserialize;
use tracing::{info, warn};

use aura_os_core::{AgentInstanceId, ProjectId, TaskId};
use aura_os_link::{AutomatonStartError, AutomatonStartParams};

use super::agents::conversions_pub::resolve_workspace_path;
use super::projects_helpers::optional_jwt;
use crate::dto::LoopStatusResponse;
use crate::error::{ApiError, ApiResult};
use crate::persistence;
use crate::state::{ActiveAutomaton, AppState, AutomatonRegistry, CachedTaskOutput, TaskOutputCache};

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

struct ForwardParams {
    automaton_events_tx: tokio::sync::broadcast::Sender<serde_json::Value>,
    app_broadcast: tokio::sync::broadcast::Sender<serde_json::Value>,
    automaton_registry: AutomatonRegistry,
    project_id: ProjectId,
    agent_instance_id: AgentInstanceId,
    task_id: Option<String>,
    task_output_cache: TaskOutputCache,
    storage_client: Option<std::sync::Arc<aura_os_storage::StorageClient>>,
    jwt: Option<String>,
}

/// Forward automaton events from the harness WebSocket to the app's global
/// event broadcast, mapping `AutomatonEvent` types to the app's domain events.
/// Also accumulates task output in the in-memory cache and persists to storage
/// on task completion.
fn forward_automaton_events(params: ForwardParams) {
    let ForwardParams {
        automaton_events_tx,
        app_broadcast,
        automaton_registry,
        project_id,
        agent_instance_id,
        task_id,
        task_output_cache,
        storage_client,
        jwt,
    } = params;

    let mut rx = automaton_events_tx.subscribe();
    let pid = project_id.to_string();
    let aiid = agent_instance_id.to_string();

    tokio::spawn(async move {
        let mut first_work_seen = false;
        let mut current_task_id: Option<String> = task_id;
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
                    // Track the active task_id from lifecycle events so
                    // streaming events (text_delta, etc.) that don't carry
                    // task_id in their payload still get stamped correctly.
                    if event_type == "task_started" {
                        if let Some(tid) = event.get("task_id").and_then(|v| v.as_str()) {
                            current_task_id = Some(tid.to_owned());
                            let mut cache = task_output_cache.lock().await;
                            cache.insert(tid.to_owned(), CachedTaskOutput {
                                project_id: Some(pid.clone()),
                                agent_instance_id: Some(aiid.clone()),
                                ..Default::default()
                            });
                        }
                    }

                    if !first_work_seen {
                        let event_task_id = event
                            .get("task_id")
                            .and_then(|v| v.as_str())
                            .map(str::to_owned);
                        let effective_task_id = current_task_id.clone().or(event_task_id);
                        let is_work = matches!(
                            event_type,
                            "task_started"
                                | "text_delta"
                                | "thinking_delta"
                                | "tool_call_started"
                                | "tool_result"
                                | "log_line"
                                | "progress"
                        );
                        if is_work {
                            first_work_seen = true;
                            if event_type != "task_started" {
                                let extra = match &effective_task_id {
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

                    // Accumulate task output in the in-memory cache.
                    {
                        let event_task_id = event.get("task_id").and_then(|v| v.as_str()).map(str::to_owned);
                        let eff_tid = current_task_id.clone().or(event_task_id);
                        if let Some(ref tid) = eff_tid {
                            let mut cache = task_output_cache.lock().await;
                            let entry = cache.entry(tid.clone()).or_default();
                            match event_type {
                                "text_delta" => {
                                    if let Some(text) = event.get("text").and_then(|v| v.as_str()) {
                                        entry.live_output.push_str(text);
                                    }
                                }
                                "assistant_message_end" => {
                                    if !entry.live_output.is_empty() && !entry.live_output.ends_with("\n\n") {
                                        entry.live_output.push_str("\n\n");
                                    }
                                }
                                "build_verification_skipped" | "build_verification_started"
                                | "build_verification_passed" | "build_verification_failed"
                                | "build_fix_attempt" => {
                                    entry.build_steps.push(event.clone());
                                }
                                "test_verification_started" | "test_verification_passed"
                                | "test_verification_failed" | "test_fix_attempt" => {
                                    entry.test_steps.push(event.clone());
                                }
                                _ => {}
                            }
                        }
                    }

                    let mapped_type = match event_type {
                        "started" => Some("loop_started"),
                        "stopped" => Some("loop_stopped"),
                        "paused" => Some("loop_paused"),
                        "resumed" => Some("loop_resumed"),
                        "task_started" => Some("task_started"),
                        "task_completed" => {
                            // Persist accumulated output to storage.
                            let event_tid = event.get("task_id").and_then(|v| v.as_str()).map(str::to_owned);
                            let tid = current_task_id.clone().or(event_tid);
                            if let Some(ref tid) = tid {
                                let session_id = event.get("session_id").and_then(|v| v.as_str()).map(str::to_owned);
                                let cached = {
                                    let mut cache = task_output_cache.lock().await;
                                    if let Some(entry) = cache.get_mut(tid) {
                                        if session_id.is_some() {
                                            entry.session_id = session_id;
                                        }
                                        entry.clone()
                                    } else {
                                        CachedTaskOutput::default()
                                    }
                                };
                                persistence::persist_task_output(
                                    storage_client.as_ref(),
                                    jwt.as_deref(),
                                    tid,
                                    &cached,
                                ).await;
                            }
                            Some("task_completed")
                        }
                        "task_failed" => {
                            let event_tid = event.get("task_id").and_then(|v| v.as_str()).map(str::to_owned);
                            let tid = current_task_id.clone().or(event_tid);
                            if let Some(ref tid) = tid {
                                let session_id = event.get("session_id").and_then(|v| v.as_str()).map(str::to_owned);
                                let cached = {
                                    let mut cache = task_output_cache.lock().await;
                                    if let Some(entry) = cache.get_mut(tid) {
                                        if session_id.is_some() {
                                            entry.session_id = session_id;
                                        }
                                        entry.clone()
                                    } else {
                                        CachedTaskOutput::default()
                                    }
                                };
                                persistence::persist_task_output(
                                    storage_client.as_ref(),
                                    jwt.as_deref(),
                                    tid,
                                    &cached,
                                ).await;
                            }
                            Some("task_failed")
                        }
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
                        let event_task_id = obj
                            .get("task_id")
                            .and_then(|v| v.as_str())
                            .map(str::to_owned);
                        let effective_task_id = current_task_id.clone().or(event_task_id);
                        obj.insert("project_id".into(), serde_json::Value::String(pid.clone()));
                        obj.insert(
                            "agent_instance_id".into(),
                            serde_json::Value::String(aiid.clone()),
                        );
                        if let Some(ref tid) = effective_task_id {
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

    let jwt = optional_jwt(&state);
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
        project_folder.as_deref(),
        &state.data_dir,
        project_name,
    );

    let jwt_for_persist = jwt.clone();
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

    // Resolve the first task the automaton will pick so that events
    // arriving before the real task_started get stamped with a task_id.
    // Without this, text_delta events have no task_id and the frontend
    // silently discards them.
    let first_task_id = state
        .task_service
        .select_next_task(&project_id)
        .await
        .ok()
        .flatten()
        .map(|t| t.task_id.to_string());

    if let Some(ref tid) = first_task_id {
        emit_domain_event(
            &state.event_broadcast,
            "task_started",
            project_id,
            agent_instance_id,
            serde_json::json!({"task_id": tid}),
        );
        let mut cache = state.task_output_cache.lock().await;
        cache.insert(tid.clone(), CachedTaskOutput {
            project_id: Some(project_id.to_string()),
            agent_instance_id: Some(agent_instance_id.to_string()),
            ..Default::default()
        });
    }

    forward_automaton_events(ForwardParams {
        automaton_events_tx: events_tx,
        app_broadcast: state.event_broadcast.clone(),
        automaton_registry: state.automaton_registry.clone(),
        project_id,
        agent_instance_id,
        task_id: first_task_id,
        task_output_cache: state.task_output_cache.clone(),
        storage_client: state.storage_client.clone(),
        jwt: jwt_for_persist,
    });

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

    let jwt = optional_jwt(&state);
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
        project_folder.as_deref(),
        &state.data_dir,
        project_name,
    );

    let jwt_for_persist = jwt.clone();
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

    // Emit task_started immediately so the frontend gets the signal even if
    // early automaton events are lost in the race between start and WS connect.
    emit_domain_event(
        &state.event_broadcast,
        "task_started",
        project_id,
        agent_instance_id,
        serde_json::json!({"task_id": task_id.to_string()}),
    );

    // Pre-seed the output cache so the REST endpoint can serve partial output.
    {
        let mut cache = state.task_output_cache.lock().await;
        cache.insert(task_id.to_string(), CachedTaskOutput {
            project_id: Some(project_id.to_string()),
            agent_instance_id: Some(agent_instance_id.to_string()),
            ..Default::default()
        });
    }

    if let Ok(events_tx) = state
        .automaton_client
        .connect_event_stream(&automaton_id)
        .await
    {
        forward_automaton_events(ForwardParams {
            automaton_events_tx: events_tx,
            app_broadcast: state.event_broadcast.clone(),
            automaton_registry: state.automaton_registry.clone(),
            project_id,
            agent_instance_id,
            task_id: Some(task_id.to_string()),
            task_output_cache: state.task_output_cache.clone(),
            storage_client: state.storage_client.clone(),
            jwt: jwt_for_persist,
        });
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
