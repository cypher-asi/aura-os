use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::Json;
use serde::Deserialize;
use tracing::{info, warn};

use aura_os_core::{AgentInstanceId, HarnessMode, ProjectId, TaskId, TaskStatus};
use aura_os_link::{AutomatonStartError, AutomatonStartParams};
use aura_os_tasks::TaskService;

use super::agents::conversions_pub::resolve_workspace_path;
use super::projects_helpers::optional_jwt;
use crate::dto::LoopStatusResponse;
use crate::error::{ApiError, ApiResult};
use crate::persistence;
use crate::state::{ActiveAutomaton, AppState, AutomatonRegistry, CachedTaskOutput, TaskOutputCache};

/// Resolve the effective git clone URL for a project. If `git_repo_url` is set,
/// use it directly. Otherwise construct from `orbit_base_url` (or `ORBIT_BASE_URL`
/// env var) combined with `orbit_owner` / `orbit_repo`.
fn resolve_git_repo_url(project: Option<&aura_os_core::Project>) -> Option<String> {
    let p = project?;
    if let Some(ref url) = p.git_repo_url {
        if !url.is_empty() {
            return Some(url.clone());
        }
    }
    let owner = p.orbit_owner.as_deref().filter(|s| !s.is_empty())?;
    let repo = p.orbit_repo.as_deref().filter(|s| !s.is_empty())?;
    let base = p
        .orbit_base_url
        .as_deref()
        .filter(|s| !s.is_empty())
        .map(String::from)
        .or_else(|| std::env::var("ORBIT_BASE_URL").ok())
        .filter(|s| !s.is_empty())?;
    let base = base.trim_end_matches('/');
    Some(format!("{base}/{owner}/{repo}.git"))
}

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

fn automaton_is_active(status: &serde_json::Value) -> bool {
    if let Some(running) = status.get("running").and_then(|v| v.as_bool()) {
        return running;
    }
    let state = status
        .get("state")
        .or_else(|| status.get("status"))
        .and_then(|v| v.as_str())
        .map(|s| s.to_ascii_lowercase());
    match state.as_deref() {
        // Paused loops are still active for singleton semantics.
        Some("running" | "active" | "started" | "paused") => true,
        Some("done" | "stopped" | "finished" | "failed" | "cancelled" | "terminated" | "completed") => false,
        // Unknown schema/state: stay conservative and treat as active.
        _ => true,
    }
}

fn automaton_client_for_mode(
    state: &AppState,
    mode: HarnessMode,
    swarm_agent_id: Option<&str>,
    jwt: Option<&str>,
) -> Result<std::sync::Arc<aura_os_link::AutomatonClient>, (StatusCode, Json<ApiError>)> {
    match mode {
        HarnessMode::Local => Ok(state.automaton_client.clone()),
        HarnessMode::Swarm => {
            let base = state
                .swarm_base_url
                .as_deref()
                .ok_or_else(|| ApiError::service_unavailable("swarm gateway is not configured"))?;
            let base = base.trim_end_matches('/');
            let scoped_base = match swarm_agent_id {
                Some(aid) => format!("{base}/v1/agents/{aid}"),
                None => base.to_string(),
            };
            let client = aura_os_link::AutomatonClient::new(&scoped_base)
                .with_auth(jwt.map(String::from));
            Ok(std::sync::Arc::new(client))
        }
    }
}

struct ForwardParams {
    automaton_events_tx: tokio::sync::broadcast::Sender<serde_json::Value>,
    app_broadcast: tokio::sync::broadcast::Sender<serde_json::Value>,
    automaton_registry: AutomatonRegistry,
    project_id: ProjectId,
    agent_instance_id: AgentInstanceId,
    task_id: Option<String>,
    task_service: std::sync::Arc<TaskService>,
    task_output_cache: TaskOutputCache,
    storage_client: Option<std::sync::Arc<aura_os_storage::StorageClient>>,
    jwt: Option<String>,
}

async fn resolve_active_task_id(
    task_service: &TaskService,
    project_id: &ProjectId,
    agent_instance_id: &AgentInstanceId,
) -> Option<String> {
    let tasks = task_service.list_tasks(project_id).await.ok()?;

    // Best signal: an in-progress task already assigned to this agent instance.
    if let Some(task) = tasks.iter().find(|t| {
        t.status == TaskStatus::InProgress
            && t.assigned_agent_instance_id == Some(*agent_instance_id)
    }) {
        return Some(task.task_id.to_string());
    }

    // Fallback: global scheduler's next ready task.
    task_service
        .select_next_task(project_id)
        .await
        .ok()
        .flatten()
        .map(|t| t.task_id.to_string())
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
        task_service,
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

                    // Keep trying to discover the active task_id until it is known.
                    // Some harness streams emit deltas before task_started, and if
                    // we stop attempting resolution after first work we can forward
                    // all first-task output without task_id.
                    if current_task_id.is_none() {
                        if let Some(tid) = event.get("task_id").and_then(|v| v.as_str()) {
                            current_task_id = Some(tid.to_owned());
                        } else if is_work {
                            current_task_id = resolve_active_task_id(
                                task_service.as_ref(),
                                &project_id,
                                &agent_instance_id,
                            )
                            .await;
                        }
                    }
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
                        let mut effective_task_id = current_task_id.clone().or(event_task_id);
                        if effective_task_id.is_none() {
                            effective_task_id = resolve_active_task_id(
                                task_service.as_ref(),
                                &project_id,
                                &agent_instance_id,
                            )
                            .await;
                            if let Some(ref tid) = effective_task_id {
                                current_task_id = Some(tid.clone());
                            }
                        }
                        if is_work {
                            if event_type == "task_started" || effective_task_id.is_some() {
                                first_work_seen = true;
                            }
                            if event_type != "task_started" && effective_task_id.is_some() {
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
                        "git_pushed" => Some("git_pushed"),
                        "git_committed" => Some("git_committed"),
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
    let (machine_type, swarm_agent_id) = state
        .agent_instance_service
        .get_instance(&project_id, &agent_instance_id)
        .await
        .map(|inst| {
            info!(
                %project_id, %agent_instance_id,
                agent_id = %inst.agent_id,
                machine_type = %inst.machine_type,
                "Resolved agent instance for loop start"
            );
            (inst.machine_type, Some(inst.agent_id.to_string()))
        })
        .unwrap_or_else(|e| {
            warn!(%project_id, %agent_instance_id, error = %e, "Failed to resolve agent instance; defaulting to local");
            ("local".to_string(), None)
        });
    let harness_mode = HarnessMode::from_machine_type(&machine_type);
    let automaton_client = automaton_client_for_mode(&state, harness_mode, swarm_agent_id.as_deref(), jwt.as_deref())?;
    info!(
        %project_id, %agent_instance_id,
        base_url = %automaton_client.base_url(),
        ?harness_mode,
        "Automaton client configured for loop start"
    );
    let project_path = if harness_mode == HarnessMode::Swarm {
        automaton_client
            .resolve_workspace(project_name)
            .await
            .unwrap_or_else(|e| {
                warn!(%project_id, error = %e, "Harness workspace resolve failed; using local computation");
                resolve_workspace_path(&machine_type, project_folder.as_deref(), &state.data_dir, project_name)
            })
    } else {
        resolve_workspace_path(&machine_type, project_folder.as_deref(), &state.data_dir, project_name)
    };

    let jwt_for_persist = jwt.clone();
    let start_params = AutomatonStartParams {
        project_id: project_id.to_string(),
        auth_token: jwt,
        model: None,
        workspace_root: Some(project_path),
        task_id: None,
        git_repo_url: resolve_git_repo_url(project.as_ref()),
        git_branch: project.as_ref().and_then(|p| p.git_branch.clone()),
    };

    let (automaton_id, adopted, event_stream_url) = match automaton_client.start(start_params.clone()).await {
        Ok(r) => {
            let esurl = r.event_stream_url.clone();
            (r.automaton_id, false, Some(esurl))
        }
        Err(AutomatonStartError::Conflict(existing_id)) => {
            match existing_id {
                Some(aid) => {
                    let stale_or_dead = match automaton_client.status(&aid).await {
                        Ok(status) => !automaton_is_active(&status),
                        Err(e) => {
                            warn!(
                                %aid,
                                %project_id,
                                error = %e,
                                "Failed to inspect conflicting automaton status; treating as stale"
                            );
                            true
                        }
                    };

                    if stale_or_dead {
                        info!(
                            %aid,
                            %project_id,
                            "Conflicting automaton appears stale; stopping and retrying start"
                        );
                        if let Err(e) = automaton_client.stop(&aid).await {
                            warn!(
                                %aid,
                                %project_id,
                                error = %e,
                                "Failed to stop stale conflicting automaton before retry"
                            );
                        }
                        match automaton_client.start(start_params).await {
                            Ok(r) => {
                                let esurl = r.event_stream_url.clone();
                                (r.automaton_id, false, Some(esurl))
                            }
                            Err(AutomatonStartError::Conflict(Some(retry_id))) => {
                                info!(
                                    %retry_id,
                                    %project_id,
                                    "Retry still conflicts; adopting existing automaton"
                                );
                                (retry_id, true, None)
                            }
                            Err(AutomatonStartError::Conflict(None)) => {
                                return Err(ApiError::conflict(
                                    "A dev loop is already running but its ID could not be determined",
                                ));
                            }
                            Err(e) => {
                                return Err(ApiError::internal(format!(
                                    "starting dev loop after stale cleanup: {e}"
                                )));
                            }
                        }
                    } else {
                        info!(%aid, %project_id, "Adopting existing automaton from harness");
                        (aid, true, None)
                    }
                }
                None => {
                    return Err(ApiError::conflict(
                        "A dev loop is already running but its ID could not be determined",
                    ));
                }
            }
        }
        Err(AutomatonStartError::Request { message, is_connect, is_timeout }) => {
            warn!(
                %project_id, %agent_instance_id,
                base_url = %automaton_client.base_url(),
                %is_connect, %is_timeout,
                %message,
                "Automaton start request error"
            );
            if is_connect {
                crate::app_builder::ensure_local_harness_running();
                return Err(ApiError::service_unavailable(format!(
                    "Service unavailable: local aura-harness at {} could not be reached ({message}). \
                     Recovery spawn was attempted; if this keeps failing, check harness build/startup logs.",
                    automaton_client.base_url(),
                )));
            }
            if is_timeout {
                return Err(ApiError::service_unavailable(format!(
                    "Service unavailable: local aura-harness at {} timed out while handling start ({message}).",
                    automaton_client.base_url(),
                )));
            }
            return Err(ApiError::internal(format!("starting dev loop: {message}")));
        }
        Err(AutomatonStartError::Response { status, body }) => {
            warn!(
                %project_id, %agent_instance_id,
                base_url = %automaton_client.base_url(),
                %status,
                response_body = %body,
                "Automaton start response error"
            );
            if harness_mode == HarnessMode::Swarm && status == 404 {
                return Err(ApiError::service_unavailable(format!(
                    "Remote dev-loop start is unavailable: swarm gateway at {} does not expose /automaton/start (HTTP 404).",
                    automaton_client.base_url()
                )));
            }
            return Err(ApiError::bad_gateway(format!(
                "automaton start failed via {} (status {}): {}",
                automaton_client.base_url(),
                status,
                body
            )));
        }
        Err(e) => return Err(ApiError::internal(format!("starting dev loop: {e}"))),
    };

    info!(
        %project_id,
        %agent_instance_id,
        %automaton_id,
        adopted,
        event_stream_url = event_stream_url.as_deref().unwrap_or("<none>"),
        "Dev loop automaton ready"
    );

    let events_tx = match automaton_client.connect_event_stream(&automaton_id, event_stream_url.as_deref()).await {
        Ok(tx) => tx,
        Err(e) => {
            // If start succeeded but event-stream attach failed, proactively stop
            // the spawned automaton so we don't leak an untracked loop that
            // cannot be stopped via our registry.
            if !adopted {
                if let Err(stop_err) = automaton_client.stop(&automaton_id).await {
                    warn!(
                        %project_id,
                        %agent_instance_id,
                        %automaton_id,
                        error = %stop_err,
                        "Failed to stop newly started automaton after stream attach failure"
                    );
                } else {
                    info!(
                        %project_id,
                        %agent_instance_id,
                        %automaton_id,
                        "Stopped newly started automaton after stream attach failure"
                    );
                }
            }
            return Err(ApiError::internal(format!(
                "connecting event stream for dev loop (adopted={adopted}): {e}"
            )));
        }
    };

    // Resolve the first task the automaton will pick so that events
    // arriving before the real task_started get stamped with a task_id.
    // Without this, text_delta events have no task_id and the frontend
    // silently discards them.
    let first_task_id = resolve_active_task_id(
        state.task_service.as_ref(),
        &project_id,
        &agent_instance_id,
    )
    .await;

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
        task_service: state.task_service.clone(),
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
                harness_base_url: automaton_client.base_url().to_string(),
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
        let base_url = {
            let reg = state.automaton_registry.lock().await;
            reg.get(aiid)
                .map(|a| a.harness_base_url.clone())
                .unwrap_or_else(|| state.automaton_client.base_url().to_string())
        };
        let client = aura_os_link::AutomatonClient::new(&base_url);
        if let Err(e) = client.pause(automaton_id).await {
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
        let base_url = reg
            .get(aiid)
            .map(|a| a.harness_base_url.clone())
            .unwrap_or_else(|| state.automaton_client.base_url().to_string());
        let client = aura_os_link::AutomatonClient::new(&base_url);
        if let Err(e) = client.stop(automaton_id).await {
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
    let (machine_type, swarm_agent_id) = state
        .agent_instance_service
        .get_instance(&project_id, &agent_instance_id)
        .await
        .map(|inst| (inst.machine_type, Some(inst.agent_id.to_string())))
        .unwrap_or_else(|_| ("local".to_string(), None));
    let harness_mode = HarnessMode::from_machine_type(&machine_type);
    let automaton_client = automaton_client_for_mode(&state, harness_mode, swarm_agent_id.as_deref(), jwt.as_deref())?;
    let project_path = if harness_mode == HarnessMode::Swarm {
        automaton_client
            .resolve_workspace(project_name)
            .await
            .unwrap_or_else(|e| {
                warn!(%project_id, error = %e, "Harness workspace resolve failed; using local computation");
                resolve_workspace_path(&machine_type, project_folder.as_deref(), &state.data_dir, project_name)
            })
    } else {
        resolve_workspace_path(&machine_type, project_folder.as_deref(), &state.data_dir, project_name)
    };

    let jwt_for_persist = jwt.clone();
    let result = automaton_client
        .start(AutomatonStartParams {
            project_id: project_id.to_string(),
            auth_token: jwt,
            model: None,
            workspace_root: Some(project_path),
            task_id: Some(task_id.to_string()),
            git_repo_url: resolve_git_repo_url(project.as_ref()),
            git_branch: project.as_ref().and_then(|p| p.git_branch.clone()),
        })
        .await
        .map_err(|e| match e {
            AutomatonStartError::Conflict(_) => {
                ApiError::conflict(format!("starting task runner: {e}"))
            }
            AutomatonStartError::Response { status, body } => ApiError::bad_gateway(format!(
                "starting task runner via {} failed (status {}): {}",
                automaton_client.base_url(),
                status,
                body
            )),
            _ => ApiError::internal(format!("starting task runner: {e}")),
        })?;

    let automaton_id = result.automaton_id;
    let event_stream_url = result.event_stream_url;
    info!(%project_id, %task_id, %automaton_id, %event_stream_url, "Single task automaton started");

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

    if let Ok(events_tx) = automaton_client.connect_event_stream(&automaton_id, Some(&event_stream_url)).await {
        forward_automaton_events(ForwardParams {
            automaton_events_tx: events_tx,
            app_broadcast: state.event_broadcast.clone(),
            automaton_registry: state.automaton_registry.clone(),
            project_id,
            agent_instance_id,
            task_id: Some(task_id.to_string()),
            task_service: state.task_service.clone(),
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
