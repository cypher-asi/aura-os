use axum::extract::{Path, Query, State};
use axum::Json;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::time::Duration;
use tracing::debug;

use aura_os_core::{AgentInstanceId, HarnessMode, ProjectId, SpecId, Task, TaskId, TaskStatus};
use aura_os_link::{HarnessInbound, HarnessOutbound, UserMessage};
use aura_os_storage::StorageTask;
use aura_os_tasks::TaskService;

use super::dev_loop::auto_decompose_disabled;
use super::projects_helpers::project_tool_session_config;
use super::task_decompose::{
    detect_preflight_decomposition, spawn_skeleton_and_fill_children, DecompositionContext,
    DecompositionSignal,
};
use crate::dto::TransitionTaskRequest;
use crate::error::{ApiError, ApiResult};
use crate::state::{AppState, AuthJwt};

const TASK_RESULT_POLL_INTERVAL: Duration = Duration::from_millis(250);
const TASK_RESULT_POLL_TIMEOUT: Duration = Duration::from_secs(5);

async fn load_extracted_tasks(
    state: &AppState,
    project_id: &ProjectId,
    jwt: &str,
) -> ApiResult<Vec<Task>> {
    let storage = state.require_storage_client()?;
    let started_at = tokio::time::Instant::now();
    let mut tasks: Vec<Task> = loop {
        let storage_tasks = storage
            .list_tasks(&project_id.to_string(), jwt)
            .await
            .map_err(|e| ApiError::internal(format!("listing tasks: {e}")))?;
        let tasks: Vec<Task> = storage_tasks
            .into_iter()
            .filter_map(|s| storage_task_to_task(s).ok())
            .collect();
        if !tasks.is_empty() || started_at.elapsed() >= TASK_RESULT_POLL_TIMEOUT {
            break tasks;
        }
        tokio::time::sleep(TASK_RESULT_POLL_INTERVAL).await;
    };
    tasks.sort_by_key(|t| t.order_index);
    Ok(tasks)
}

fn tasks_changed_since(before: &[Task], after: &[Task]) -> bool {
    if before.len() != after.len() {
        return true;
    }

    let before_versions: HashMap<_, _> = before
        .iter()
        .map(|task| (task.task_id, task.updated_at))
        .collect();

    after.iter().any(|task| {
        before_versions
            .get(&task.task_id)
            .is_none_or(|updated_at| *updated_at != task.updated_at)
    })
}

#[derive(Debug, Deserialize, Default)]
pub(crate) struct TaskQueryParams {
    pub agent_instance_id: Option<AgentInstanceId>,
}

/// Convert a `StorageTask` into a domain `Task`.
///
/// Delegates to the canonical `TryFrom<StorageTask>` impl in `aura_os_storage`.
pub(crate) fn storage_task_to_task(s: StorageTask) -> Result<Task, String> {
    Task::try_from(s)
}

pub(crate) async fn list_tasks(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    Path(project_id): Path<ProjectId>,
) -> ApiResult<Json<Vec<Task>>> {
    let storage = state.require_storage_client()?;
    let storage_tasks = storage
        .list_tasks(&project_id.to_string(), &jwt)
        .await
        .map_err(|e| ApiError::internal(format!("listing tasks: {e}")))?;
    let mut tasks: Vec<Task> = storage_tasks
        .into_iter()
        .filter_map(|s| storage_task_to_task(s).ok())
        .collect();
    tasks.sort_by_key(|t| t.order_index);
    Ok(Json(tasks))
}

pub(crate) async fn list_tasks_by_spec(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    Path((project_id, spec_id)): Path<(ProjectId, SpecId)>,
) -> ApiResult<Json<Vec<Task>>> {
    let storage = state.require_storage_client()?;
    let storage_tasks = storage
        .list_tasks(&project_id.to_string(), &jwt)
        .await
        .map_err(|e| ApiError::internal(format!("listing tasks by spec: {e}")))?;
    let mut tasks: Vec<Task> = storage_tasks
        .into_iter()
        .filter_map(|s| storage_task_to_task(s).ok())
        .filter(|t| t.spec_id == spec_id)
        .collect();
    tasks.sort_by_key(|t| t.order_index);
    Ok(Json(tasks))
}

pub(crate) async fn get_task(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    Path((_project_id, task_id)): Path<(ProjectId, TaskId)>,
) -> ApiResult<Json<Task>> {
    let storage = state.require_storage_client()?;
    let storage_task =
        storage
            .get_task(&task_id.to_string(), &jwt)
            .await
            .map_err(|e| match &e {
                aura_os_storage::StorageError::Server { status: 404, .. } => {
                    ApiError::not_found("task not found")
                }
                _ => ApiError::internal(format!("fetching task: {e}")),
            })?;
    let task = storage_task_to_task(storage_task).map_err(ApiError::internal)?;
    Ok(Json(task))
}

pub(crate) async fn extract_tasks(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    Path(project_id): Path<ProjectId>,
    Query(params): Query<TaskQueryParams>,
) -> ApiResult<Json<Vec<Task>>> {
    let baseline_tasks = load_extracted_tasks(&state, &project_id, &jwt).await?;
    let harness_mode = if let Some(aiid) = params.agent_instance_id {
        let instance = state
            .agent_instance_service
            .get_instance(&project_id, &aiid)
            .await
            .map_err(|e| match e {
                aura_os_agents::AgentError::NotFound => {
                    ApiError::not_found(format!("agent instance {aiid} not found"))
                }
                other => ApiError::internal(format!("looking up agent instance {aiid}: {other}")),
            })?;
        instance.harness_mode()
    } else {
        HarnessMode::Local
    };
    let harness = state.harness_for(harness_mode);
    let session_config = project_tool_session_config(
        &state,
        &project_id,
        "task-extract",
        harness_mode,
        params.agent_instance_id,
        &jwt,
    )
    .await;
    let session = harness
        .open_session(session_config)
        .await
        .map_err(|e| ApiError::internal(format!("opening task extraction session: {e}")))?;

    session
        .commands_tx
        .send(HarnessInbound::UserMessage(UserMessage {
            content: format!(
                "Extract tasks for project {project_id}. Review the existing specs, then create or update the project's tasks until the task list is populated. This workflow is only for planning, not execution: do not run commands, do not execute tasks, do not transition task states, and do not mark tasks done/failed/blocked. Never call the `extract_tasks` tool from inside this workflow because that would recursively restart task extraction. Use the spec and task CRUD/listing tools directly instead."
            ),
            tool_hints: None,
            attachments: None,
        }))
        .map_err(|e| ApiError::internal(format!("sending task extract command: {e}")))?;

    let mut rx = session.events_tx.subscribe();
    while let Ok(event) = rx.recv().await {
        match event {
            HarnessOutbound::AssistantMessageEnd(_) => {
                let tasks = load_extracted_tasks(&state, &project_id, &jwt).await?;
                return Ok(Json(tasks));
            }
            HarnessOutbound::Error(err) => {
                let tasks = load_extracted_tasks(&state, &project_id, &jwt).await?;
                if tasks_changed_since(&baseline_tasks, &tasks) {
                    return Ok(Json(tasks));
                }
                return Err(ApiError::internal(err.message));
            }
            _ => continue,
        }
    }

    Err(ApiError::internal(
        "task extraction stream ended without result",
    ))
}

pub(crate) async fn transition_task(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    Path((_project_id, task_id)): Path<(ProjectId, TaskId)>,
    Json(req): Json<TransitionTaskRequest>,
) -> ApiResult<Json<Task>> {
    let storage = state.require_storage_client()?;

    let current = storage
        .get_task(&task_id.to_string(), &jwt)
        .await
        .map_err(|e| match &e {
            aura_os_storage::StorageError::Server { status: 404, .. } => {
                ApiError::not_found("task not found")
            }
            _ => ApiError::internal(format!("fetching task for transition: {e}")),
        })?;
    let task = storage_task_to_task(current).map_err(ApiError::internal)?;
    TaskService::validate_transition(task.status, req.new_status)
        .map_err(|e| ApiError::bad_request(format!("validating task transition: {e}")))?;

    let status_str = serde_json::to_value(req.new_status)
        .map_err(|e| ApiError::internal(format!("serializing task status: {e}")))?
        .as_str()
        .unwrap_or("pending")
        .to_string();

    storage
        .transition_task(
            &task_id.to_string(),
            &jwt,
            &aura_os_storage::TransitionTaskRequest { status: status_str },
        )
        .await
        .map_err(|e| match &e {
            aura_os_storage::StorageError::Server { status: 404, .. } => {
                ApiError::not_found("task not found")
            }
            aura_os_storage::StorageError::Server { status: 400, body } => {
                ApiError::bad_request(body.clone())
            }
            _ => ApiError::internal(format!("transitioning task: {e}")),
        })?;

    let updated = storage
        .get_task(&task_id.to_string(), &jwt)
        .await
        .map_err(|e| ApiError::internal(format!("fetching updated task: {e}")))?;
    let task = storage_task_to_task(updated).map_err(ApiError::internal)?;
    Ok(Json(task))
}

pub(crate) async fn retry_task(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    Path((_project_id, task_id)): Path<(ProjectId, TaskId)>,
) -> ApiResult<Json<Task>> {
    let storage = state.require_storage_client()?;

    let current = storage
        .get_task(&task_id.to_string(), &jwt)
        .await
        .map_err(|e| match &e {
            aura_os_storage::StorageError::Server { status: 404, .. } => {
                ApiError::not_found("task not found")
            }
            _ => ApiError::internal(format!("fetching task for retry: {e}")),
        })?;
    let task = storage_task_to_task(current).map_err(ApiError::internal)?;
    TaskService::validate_transition(task.status, TaskStatus::Ready)
        .map_err(|e| ApiError::bad_request(format!("validating task retry: {e}")))?;

    storage
        .transition_task(
            &task_id.to_string(),
            &jwt,
            &aura_os_storage::TransitionTaskRequest {
                status: "ready".to_string(),
            },
        )
        .await
        .map_err(|e| match &e {
            aura_os_storage::StorageError::Server { status: 404, .. } => {
                ApiError::not_found("task not found")
            }
            aura_os_storage::StorageError::Server { status: 400, body } => {
                ApiError::bad_request(body.clone())
            }
            _ => ApiError::internal(format!("retrying task: {e}")),
        })?;

    let updated = storage
        .get_task(&task_id.to_string(), &jwt)
        .await
        .map_err(|e| ApiError::internal(format!("fetching retried task: {e}")))?;
    let task = storage_task_to_task(updated).map_err(ApiError::internal)?;
    Ok(Json(task))
}

#[derive(Serialize)]
pub(crate) struct TaskOutputResponse {
    pub output: String,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub build_steps: Vec<serde_json::Value>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub test_steps: Vec<serde_json::Value>,
    /// True when we could not locate any persisted output for this task
    /// (e.g. the task's `session_id` never made it into storage and the
    /// in-memory cache does not have it either). The frontend uses this
    /// as a terminal "no output available" signal to stop retrying.
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub unavailable: bool,
}

async fn fetch_task_output_from_storage(
    storage: &aura_os_storage::StorageClient,
    jwt: &str,
    task_id: &TaskId,
    cached_session_id: Option<&str>,
) -> Option<TaskOutputResponse> {
    let task = storage.get_task(&task_id.to_string(), jwt).await.ok()?;
    let session_id = match task
        .session_id
        .or_else(|| cached_session_id.map(String::from))
    {
        Some(sid) => sid,
        None => {
            debug!(%task_id, "Task has no session_id in storage; cannot fetch persisted output");
            return None;
        }
    };
    let events = storage
        .list_events(&session_id, jwt, None, None)
        .await
        .ok()?;

    let task_id_str = task_id.to_string();
    let matches_task = |e: &&aura_os_storage::StorageSessionEvent, expected_type: &str| -> bool {
        e.event_type.as_deref() == Some(expected_type)
            && e.content
                .as_ref()
                .and_then(|c| c.get("task_id"))
                .and_then(|v| v.as_str())
                .is_some_and(|id| id == task_id_str)
    };

    let output: String = events
        .iter()
        .filter(|e| matches_task(e, "task_output"))
        .filter_map(|e| {
            e.content
                .as_ref()
                .and_then(|c| c.get("text"))
                .and_then(|v| v.as_str())
        })
        .collect::<Vec<_>>()
        .join("\n");

    let (mut build_steps, mut test_steps) = (Vec::new(), Vec::new());
    for evt in &events {
        if !matches_task(&evt, "task_steps") {
            continue;
        }
        if let Some(content) = evt.content.as_ref() {
            if let Some(bs) = content.get("build_steps").and_then(|v| v.as_array()) {
                build_steps = bs.clone();
            }
            if let Some(ts) = content.get("test_steps").and_then(|v| v.as_array()) {
                test_steps = ts.clone();
            }
        }
    }

    if output.is_empty() && build_steps.is_empty() && test_steps.is_empty() {
        debug!(
            %task_id, %session_id,
            total_events = events.len(),
            "Session has events but none matched this task_id or all were empty"
        );
        return None;
    }
    Some(TaskOutputResponse {
        output,
        build_steps,
        test_steps,
        unavailable: false,
    })
}

pub(crate) async fn get_task_output(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    Path((_project_id, task_id)): Path<(ProjectId, TaskId)>,
) -> ApiResult<Json<TaskOutputResponse>> {
    // Check the in-memory cache first (covers active and recently completed tasks).
    let cached_session_id = {
        let cache = state.task_output_cache.lock().await;
        if let Some(entry) = cache.get(&task_id.to_string()) {
            if !entry.live_output.is_empty()
                || !entry.build_steps.is_empty()
                || !entry.test_steps.is_empty()
            {
                return Ok(Json(TaskOutputResponse {
                    output: entry.live_output.clone(),
                    build_steps: entry.build_steps.clone(),
                    test_steps: entry.test_steps.clone(),
                    unavailable: false,
                }));
            }
            entry.session_id.clone()
        } else {
            None
        }
    };

    // Fall back to persisted storage. Prefer session_id from the in-memory
    // cache when the task document hasn't been updated yet (race between
    // task_started writing session_id and the first output poll).
    if let Some(storage) = state.storage_client.as_ref() {
        if let Some(resp) =
            fetch_task_output_from_storage(storage, &jwt, &task_id, cached_session_id.as_deref())
                .await
        {
            return Ok(Json(resp));
        }
    }

    // We exhausted every lookup path without finding any output for this
    // task. Signal `unavailable` so the client can stop retrying this
    // specific task until it's started again. This is the response that
    // replaces the pre-fix behaviour of returning an empty 200 for every
    // row forever (~20 GETs × infinite retries when the output panel
    // mounted with stale rows).
    Ok(Json(TaskOutputResponse {
        output: String::new(),
        build_steps: Vec::new(),
        test_steps: Vec::new(),
        unavailable: true,
    }))
}

#[derive(Debug, Deserialize)]
pub(crate) struct CreateTaskBody {
    pub title: String,
    pub spec_id: String,
    pub description: Option<String>,
    pub status: Option<String>,
    pub order_index: Option<i32>,
    pub dependency_ids: Option<Vec<String>>,
    pub assigned_agent_instance_id: Option<String>,
    /// Phase 5 opt-out: when true, the preflight decomposition path is
    /// skipped for this task even if the heuristic would otherwise
    /// match. Round-trips through the DTO only — not persisted in
    /// aura-storage (no schema column today), so a task reloaded after
    /// a server restart is treated as `skip_auto_decompose = false`
    /// again. The preflight path only runs at creation time, so the
    /// flag's sole purpose is already covered.
    #[serde(default)]
    pub skip_auto_decompose: bool,
}

pub(crate) async fn create_task(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    Path(project_id): Path<ProjectId>,
    Json(req): Json<CreateTaskBody>,
) -> ApiResult<Json<Task>> {
    let storage = state.require_storage_client()?;

    let skip_auto_decompose = req.skip_auto_decompose;
    let detection_title = req.title.clone();
    let detection_description = req.description.clone().unwrap_or_default();

    let storage_req = aura_os_storage::CreateTaskRequest {
        spec_id: req.spec_id,
        title: req.title,
        org_id: None,
        description: req.description,
        status: Some(req.status.unwrap_or_else(|| "backlog".to_string())),
        order_index: req.order_index,
        dependency_ids: req.dependency_ids,
        assigned_project_agent_id: req.assigned_agent_instance_id,
    };

    let created = storage
        .create_task(&project_id.to_string(), &jwt, &storage_req)
        .await
        .map_err(|e| ApiError::internal(format!("creating task: {e}")))?;
    let mut task = storage_task_to_task(created).map_err(ApiError::internal)?;
    // Mirror the client's opt-out onto the in-memory DTO so downstream
    // callers (debug endpoints, metrics) can see the flag. Storage
    // drops it on reload, which is fine — see `CreateTaskBody` above.
    task.skip_auto_decompose = skip_auto_decompose;

    let _ = state.event_broadcast.send(serde_json::json!({
        "type": "task_saved",
        "project_id": project_id.to_string(),
        "task": task,
        "task_id": task.task_id.to_string(),
    }));

    // Phase 5: try to preemptively decompose oversized-looking tasks
    // into a skeleton + fill pair BEFORE the loop picks the parent up.
    // Any failure here (detection mismatch, storage errors, transition
    // rejection) is logged and falls through — the parent still
    // survives in its original state and the Phase 3 post-failure path
    // can still rescue it once it actually runs and fails.
    if let Err(error) = try_preflight_decompose_task(
        &state,
        &jwt,
        &project_id,
        &task,
        &detection_title,
        &detection_description,
        skip_auto_decompose,
    )
    .await
    {
        tracing::warn!(
            task_id = %task.task_id,
            %error,
            "Phase 5 preflight decomposition failed; parent task left intact"
        );
    }

    Ok(Json(task))
}

/// Evaluate the Phase 5 preflight heuristic against `task` and, on a
/// match, materialise the skeleton + fill children, mark the parent
/// non-runnable, and emit a `task_preflight_decomposed` event.
///
/// The parent-status strategy: the `TaskStatus` enum has no
/// `Decomposed`/`Superseded`/`Cancelled` variant, and none of the
/// legal Phase-3 transitions starting from `Ready` land in a terminal
/// bucket without first going through `InProgress`. So we
/// unconditionally shove the parent back to `Backlog` via the storage
/// HTTP API (which is permissive about transitions), because:
///
/// * `Backlog` is **not** picked up by `select_next_task_from` — it
///   doesn't show up in the Ready filter, the pipeline-active check,
///   or the ToDo auto-promotion fallback.
/// * Leaving it in `Backlog` surfaces cleanly in the task list UI as
///   "parked" rather than lying about the run state (unlike `Done` or
///   `Failed`).
///
/// If the `transition_task` call errors out (the backend rejects the
/// transition, for instance), we surface the error — the caller
/// degrades gracefully by logging and leaving the parent alone.
/// Pure guard combining the global env-flag kill switch with the
/// per-task opt-out. Split out so the tests can cover both short-circuit
/// paths without needing a live `AppState` / `TaskService`.
///
/// Returns `true` when the preflight decomposition path should continue
/// past the short-circuit checks and actually run the detection.
fn preflight_should_run(skip_auto_decompose: bool) -> bool {
    !auto_decompose_disabled() && !skip_auto_decompose
}

async fn try_preflight_decompose_task(
    state: &AppState,
    jwt: &str,
    project_id: &ProjectId,
    parent: &Task,
    title: &str,
    description: &str,
    skip_auto_decompose: bool,
) -> Result<(), String> {
    if !preflight_should_run(skip_auto_decompose) {
        return Ok(());
    }
    let Some(signal) = detect_preflight_decomposition(title, description) else {
        return Ok(());
    };
    let DecompositionSignal {
        target_path,
        estimated_chunk_bytes,
        reason,
    } = signal;

    let children = spawn_skeleton_and_fill_children(
        state.task_service.as_ref(),
        parent,
        target_path.as_deref(),
        estimated_chunk_bytes,
        DecompositionContext::Preflight {
            reason: reason.clone(),
        },
    )
    .await
    .map_err(|e| format!("spawning skeleton+fill children: {e}"))?;

    // Park the parent in `backlog` so the scheduler ignores it. See
    // the doc comment above for why this is our chosen non-runnable
    // state. We also roll the decomposition reason into
    // `execution_notes` so the task list UI can render a short
    // explanation.
    let storage = state
        .storage_client
        .as_ref()
        .ok_or_else(|| "storage client not configured".to_string())?;

    let task_id_str = parent.task_id.to_string();
    if let Err(error) = storage
        .transition_task(
            &task_id_str,
            jwt,
            &aura_os_storage::TransitionTaskRequest {
                status: "backlog".to_string(),
            },
        )
        .await
    {
        // Non-fatal: children are already persisted. Log and move on.
        tracing::warn!(
            task_id = %task_id_str,
            %error,
            "Phase 5: failed to park parent task in backlog; scheduler may still pick it up"
        );
    }

    let note = format!(
        "Preflight auto-decomposed ({reason}). Children: {}",
        children
            .iter()
            .map(|c| c.to_string())
            .collect::<Vec<_>>()
            .join(", ")
    );
    if let Err(error) = storage
        .update_task(
            &task_id_str,
            jwt,
            &aura_os_storage::UpdateTaskRequest {
                execution_notes: Some(note),
                ..Default::default()
            },
        )
        .await
    {
        tracing::warn!(
            task_id = %task_id_str,
            %error,
            "Phase 5: failed to write execution_notes on decomposed parent"
        );
    }

    let child_id_strings: Vec<String> = children.iter().map(|c| c.to_string()).collect();
    tracing::info!(
        task_id = %task_id_str,
        reason = %reason,
        children = ?child_id_strings,
        "Phase 5 preflight-decomposed an oversized task"
    );
    let _ = state.event_broadcast.send(serde_json::json!({
        "type": "task_preflight_decomposed",
        "project_id": project_id.to_string(),
        "parent_task_id": task_id_str,
        "child_task_ids": child_id_strings,
        "reason": reason,
    }));

    Ok(())
}

#[derive(Debug, Deserialize, Default)]
pub(crate) struct UpdateTaskBody {
    pub title: Option<String>,
    pub description: Option<String>,
    pub status: Option<String>,
    pub order_index: Option<i32>,
    pub dependency_ids: Option<Vec<String>>,
    pub assigned_agent_instance_id: Option<String>,
}

pub(crate) async fn update_task(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    Path((_project_id, task_id)): Path<(ProjectId, TaskId)>,
    Json(req): Json<UpdateTaskBody>,
) -> ApiResult<Json<Task>> {
    let storage = state.require_storage_client()?;

    let current = storage
        .get_task(&task_id.to_string(), &jwt)
        .await
        .map_err(|e| match &e {
            aura_os_storage::StorageError::Server { status: 404, .. } => {
                ApiError::not_found("task not found")
            }
            _ => ApiError::internal(format!("fetching task for update: {e}")),
        })?;
    let current_task = storage_task_to_task(current).map_err(ApiError::internal)?;

    let has_direct_updates = req.title.is_some()
        || req.description.is_some()
        || req.order_index.is_some()
        || req.dependency_ids.is_some()
        || req.assigned_agent_instance_id.is_some();

    if has_direct_updates {
        storage
            .update_task(
                &task_id.to_string(),
                &jwt,
                &aura_os_storage::UpdateTaskRequest {
                    title: req.title,
                    description: req.description,
                    order_index: req.order_index,
                    dependency_ids: req.dependency_ids,
                    execution_notes: None,
                    files_changed: None,
                    model: None,
                    total_input_tokens: None,
                    total_output_tokens: None,
                    session_id: None,
                    assigned_project_agent_id: req.assigned_agent_instance_id,
                },
            )
            .await
            .map_err(|e| match &e {
                aura_os_storage::StorageError::Server { status: 404, .. } => {
                    ApiError::not_found("task not found")
                }
                aura_os_storage::StorageError::Server { status: 400, body } => {
                    ApiError::bad_request(body.clone())
                }
                _ => ApiError::internal(format!("updating task: {e}")),
            })?;
    }

    if let Some(status) = req.status {
        let parsed_status =
            serde_json::from_value::<TaskStatus>(serde_json::Value::String(status.clone()))
                .map_err(|e| {
                    ApiError::bad_request(format!("invalid task status '{status}': {e}"))
                })?;
        if parsed_status != current_task.status {
            TaskService::validate_transition(current_task.status, parsed_status)
                .map_err(|e| ApiError::bad_request(format!("validating task transition: {e}")))?;

            storage
                .transition_task(
                    &task_id.to_string(),
                    &jwt,
                    &aura_os_storage::TransitionTaskRequest { status },
                )
                .await
                .map_err(|e| match &e {
                    aura_os_storage::StorageError::Server { status: 404, .. } => {
                        ApiError::not_found("task not found")
                    }
                    aura_os_storage::StorageError::Server { status: 400, body } => {
                        ApiError::bad_request(body.clone())
                    }
                    _ => ApiError::internal(format!("transitioning updated task: {e}")),
                })?;
        }
    }

    let updated = storage
        .get_task(&task_id.to_string(), &jwt)
        .await
        .map_err(|e| ApiError::internal(format!("fetching updated task: {e}")))?;
    let task = storage_task_to_task(updated).map_err(ApiError::internal)?;
    Ok(Json(task))
}

pub(crate) async fn delete_task(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    Path((_project_id, task_id)): Path<(ProjectId, TaskId)>,
) -> ApiResult<axum::http::StatusCode> {
    let storage = state.require_storage_client()?;
    storage
        .delete_task(&task_id.to_string(), &jwt)
        .await
        .map_err(|e| match &e {
            aura_os_storage::StorageError::Server { status: 404, .. } => {
                ApiError::not_found("task not found")
            }
            _ => ApiError::internal(format!("deleting task: {e}")),
        })?;
    Ok(axum::http::StatusCode::NO_CONTENT)
}

#[cfg(test)]
mod tests {
    use super::*;
    use aura_os_storage::StorageTask;

    fn make_valid_storage_task() -> StorageTask {
        StorageTask {
            id: uuid::Uuid::new_v4().to_string(),
            project_id: Some(uuid::Uuid::new_v4().to_string()),
            org_id: None,
            spec_id: Some(uuid::Uuid::new_v4().to_string()),
            title: Some("Test task".into()),
            description: Some("A test description".into()),
            status: Some("pending".into()),
            order_index: Some(0),
            dependency_ids: None,
            execution_notes: None,
            files_changed: None,
            model: None,
            total_input_tokens: None,
            total_output_tokens: None,
            assigned_project_agent_id: None,
            session_id: None,
            created_at: Some(chrono::Utc::now().to_rfc3339()),
            updated_at: Some(chrono::Utc::now().to_rfc3339()),
        }
    }

    #[test]
    fn test_storage_task_to_task_valid() {
        let st = make_valid_storage_task();
        let result = storage_task_to_task(st);
        assert!(result.is_ok());
        let task = result.unwrap();
        assert_eq!(task.title, "Test task");
        assert_eq!(task.status, TaskStatus::Pending);
    }

    #[test]
    fn test_storage_task_to_task_invalid_id() {
        let mut st = make_valid_storage_task();
        st.id = "not-a-uuid".to_string();
        let result = storage_task_to_task(st);
        assert!(result.is_err());
    }

    // ----------------------------------------------------------------
    // Phase 5 — preflight decomposition guard
    // ----------------------------------------------------------------

    /// Serialise env-var mutation across Phase 5 + Phase 3 tests that
    /// touch `AURA_AUTO_DECOMPOSE_DISABLED`. `std::env` is process-wide
    /// so two tests in parallel would clobber each other.
    fn env_lock() -> std::sync::MutexGuard<'static, ()> {
        use std::sync::Mutex;
        static LOCK: Mutex<()> = Mutex::new(());
        LOCK.lock().unwrap_or_else(|p| p.into_inner())
    }

    #[test]
    fn preflight_decomposition_skipped_when_env_flag_set() {
        let _guard = env_lock();
        std::env::set_var("AURA_AUTO_DECOMPOSE_DISABLED", "1");
        assert!(
            !preflight_should_run(false),
            "env flag alone must short-circuit the preflight path"
        );
        std::env::remove_var("AURA_AUTO_DECOMPOSE_DISABLED");
        assert!(
            preflight_should_run(false),
            "clearing the env flag must re-enable the preflight path"
        );
    }

    #[test]
    fn preflight_decomposition_skipped_when_task_opts_out() {
        let _guard = env_lock();
        std::env::remove_var("AURA_AUTO_DECOMPOSE_DISABLED");
        assert!(
            !preflight_should_run(true),
            "skip_auto_decompose on the task must short-circuit the preflight path"
        );
        assert!(
            preflight_should_run(false),
            "with neither flag set, the preflight path should run"
        );
    }
}
