use axum::extract::{Path, State};
use axum::Json;
use chrono::{DateTime, Utc};
use serde::Serialize;
use tracing::warn;

use aura_core::{ProjectId, SpecId, Task, TaskId, TaskStatus};
use aura_storage::StorageTask;
use aura_tasks::{ProjectProgress, TaskService};

use crate::dto::TransitionTaskRequest;
use crate::error::{ApiError, ApiResult};
use crate::state::AppState;

/// Convert a `StorageTask` into a domain `Task`.
///
/// Delegates to the canonical `TryFrom<StorageTask>` impl in `aura_storage`.
pub(crate) fn storage_task_to_task(s: StorageTask) -> Result<Task, String> {
    Task::try_from(s)
}

pub async fn list_tasks(
    State(state): State<AppState>,
    Path(project_id): Path<ProjectId>,
) -> ApiResult<Json<Vec<Task>>> {
    let storage = state.require_storage_client()?;
    let jwt = state.get_jwt()?;
    let storage_tasks = storage
        .list_tasks(&project_id.to_string(), &jwt)
        .await
        .map_err(|e| ApiError::internal(e.to_string()))?;
    let mut tasks: Vec<Task> = storage_tasks
        .into_iter()
        .filter_map(|s| storage_task_to_task(s).ok())
        .collect();
    tasks.sort_by_key(|t| t.order_index);
    Ok(Json(tasks))
}

pub async fn list_tasks_by_spec(
    State(state): State<AppState>,
    Path((project_id, spec_id)): Path<(ProjectId, SpecId)>,
) -> ApiResult<Json<Vec<Task>>> {
    let storage = state.require_storage_client()?;
    let jwt = state.get_jwt()?;
    let storage_tasks = storage
        .list_tasks(&project_id.to_string(), &jwt)
        .await
        .map_err(|e| ApiError::internal(e.to_string()))?;
    let mut tasks: Vec<Task> = storage_tasks
        .into_iter()
        .filter_map(|s| storage_task_to_task(s).ok())
        .filter(|t| t.spec_id == spec_id)
        .collect();
    tasks.sort_by_key(|t| t.order_index);
    Ok(Json(tasks))
}

pub async fn extract_tasks(
    State(state): State<AppState>,
    Path(project_id): Path<ProjectId>,
) -> ApiResult<Json<Vec<Task>>> {
    let tasks = state
        .task_extraction_service
        .extract_all_tasks(&project_id)
        .await
        .map_err(|e| ApiError::internal(e.to_string()))?;
    Ok(Json(tasks))
}

pub async fn transition_task(
    State(state): State<AppState>,
    Path((_project_id, task_id)): Path<(ProjectId, TaskId)>,
    Json(req): Json<TransitionTaskRequest>,
) -> ApiResult<Json<Task>> {
    let storage = state.require_storage_client()?;
    let jwt = state.get_jwt()?;

    let current = storage
        .get_task(&task_id.to_string(), &jwt)
        .await
        .map_err(|e| match &e {
            aura_storage::StorageError::Server { status: 404, .. } => ApiError::not_found("task not found"),
            _ => ApiError::internal(e.to_string()),
        })?;
    let task = storage_task_to_task(current).map_err(ApiError::internal)?;
    TaskService::validate_transition(task.status, req.new_status)
        .map_err(|e| ApiError::bad_request(e.to_string()))?;

    let status_str =
        serde_json::to_value(req.new_status).unwrap().as_str().unwrap_or("pending").to_string();

    storage
        .transition_task(
            &task_id.to_string(),
            &jwt,
            &aura_storage::TransitionTaskRequest { status: status_str },
        )
        .await
        .map_err(|e| match &e {
            aura_storage::StorageError::Server { status: 404, .. } => {
                ApiError::not_found("task not found")
            }
            aura_storage::StorageError::Server { status: 400, body } => {
                ApiError::bad_request(body.clone())
            }
            _ => ApiError::internal(e.to_string()),
        })?;

    let updated = storage
        .get_task(&task_id.to_string(), &jwt)
        .await
        .map_err(|e| ApiError::internal(e.to_string()))?;
    let task = storage_task_to_task(updated).map_err(ApiError::internal)?;
    Ok(Json(task))
}

pub async fn retry_task(
    State(state): State<AppState>,
    Path((_project_id, task_id)): Path<(ProjectId, TaskId)>,
) -> ApiResult<Json<Task>> {
    let storage = state.require_storage_client()?;
    let jwt = state.get_jwt()?;

    let current = storage
        .get_task(&task_id.to_string(), &jwt)
        .await
        .map_err(|e| match &e {
            aura_storage::StorageError::Server { status: 404, .. } => ApiError::not_found("task not found"),
            _ => ApiError::internal(e.to_string()),
        })?;
    let task = storage_task_to_task(current).map_err(ApiError::internal)?;
    TaskService::validate_transition(task.status, TaskStatus::Ready)
        .map_err(|e| ApiError::bad_request(e.to_string()))?;

    storage
        .transition_task(
            &task_id.to_string(),
            &jwt,
            &aura_storage::TransitionTaskRequest {
                status: "ready".to_string(),
            },
        )
        .await
        .map_err(|e| match &e {
            aura_storage::StorageError::Server { status: 404, .. } => {
                ApiError::not_found("task not found")
            }
            aura_storage::StorageError::Server { status: 400, body } => {
                ApiError::bad_request(body.clone())
            }
            _ => ApiError::internal(e.to_string()),
        })?;

    let updated = storage
        .get_task(&task_id.to_string(), &jwt)
        .await
        .map_err(|e| ApiError::internal(e.to_string()))?;
    let task = storage_task_to_task(updated).map_err(ApiError::internal)?;
    Ok(Json(task))
}

pub async fn get_progress(
    State(state): State<AppState>,
    Path(project_id): Path<ProjectId>,
) -> ApiResult<Json<ProjectProgress>> {
    let storage = state.require_storage_client()?;
    let jwt = state.get_jwt()?;

    let storage_tasks = storage
        .list_tasks(&project_id.to_string(), &jwt)
        .await
        .map_err(|e| ApiError::internal(e.to_string()))?;

    let tasks: Vec<Task> = storage_tasks
        .into_iter()
        .filter_map(|s| storage_task_to_task(s).ok())
        .collect();

    let total = tasks.len();
    let done = tasks.iter().filter(|t| t.status == TaskStatus::Done).count();
    let pct = if total == 0 { 0.0 } else { (done as f64 / total as f64) * 100.0 };

    let mut progress = ProjectProgress {
        project_id,
        total_tasks: total,
        pending_tasks: tasks.iter().filter(|t| t.status == TaskStatus::Pending).count(),
        ready_tasks: tasks.iter().filter(|t| t.status == TaskStatus::Ready).count(),
        in_progress_tasks: tasks.iter().filter(|t| t.status == TaskStatus::InProgress).count(),
        blocked_tasks: tasks.iter().filter(|t| t.status == TaskStatus::Blocked).count(),
        done_tasks: done,
        failed_tasks: tasks.iter().filter(|t| t.status == TaskStatus::Failed).count(),
        completion_percentage: pct,
        total_tokens: 0,
        total_cost: 0.0,
        lines_changed: 0,
        lines_of_code: 0,
        total_commits: 0,
        total_pull_requests: 0,
        total_messages: 0,
        total_sessions: 0,
        total_time_seconds: 0,
        total_tests: 0,
        total_agents: 0,
        total_parse_retries: 0,
        total_build_fix_attempts: 0,
        build_verify_failures: 0,
        execution_failures: 0,
        file_ops_failures: 0,
    };

    aggregate_session_metrics(&state, &project_id, &mut progress).await;
    aggregate_agent_instance_metrics(&state, &project_id, &mut progress).await;

    // Count messages from aura-storage (aggregate across agent sessions)
    if let (Some(ref storage), Ok(jwt)) = (&state.storage_client, state.get_jwt()) {
        let agents = match storage
            .list_project_agents(&project_id.to_string(), &jwt)
            .await
        {
            Ok(a) => a,
            Err(e) => {
                tracing::warn!(%project_id, error = %e, "Failed to list project agents for message count");
                Vec::new()
            }
        };

        let session_futs: Vec<_> = agents
            .iter()
            .map(|a| storage.list_sessions(&a.id, &jwt))
            .collect();
        let session_results = futures_util::future::join_all(session_futs).await;

        let all_sessions: Vec<_> = session_results
            .into_iter()
            .enumerate()
            .flat_map(|(i, result)| match result {
                Ok(sessions) => sessions,
                Err(e) => {
                    tracing::warn!(project_agent_id = %agents[i].id, error = %e, "Failed to list sessions for message count");
                    Vec::new()
                }
            })
            .collect();

        let msg_futs: Vec<_> = all_sessions
            .iter()
            .map(|s| storage.list_messages(&s.id, &jwt, None, None))
            .collect();
        let msg_results = futures_util::future::join_all(msg_futs).await;

        let mut msg_count: u64 = 0;
        for (i, result) in msg_results.into_iter().enumerate() {
            match result {
                Ok(msgs) => msg_count += msgs.len() as u64,
                Err(e) => {
                    tracing::warn!(session_id = %all_sessions[i].id, error = %e, "Failed to list messages for count");
                }
            }
        }
        progress.total_messages = msg_count;
    }

    super::repo_metrics::aggregate_repo_metrics(&state, &project_id, &mut progress).await;

    Ok(Json(progress))
}

async fn aggregate_session_metrics(
    state: &AppState,
    project_id: &ProjectId,
    progress: &mut ProjectProgress,
) {
    let Some(ref storage) = state.storage_client else { return };
    let Ok(jwt) = state.get_jwt() else { return };

    let Ok(storage_agents) = storage
        .list_project_agents(&project_id.to_string(), &jwt)
        .await
    else {
        return;
    };

    let now = Utc::now();
    let mut total_sessions = 0u64;
    let mut total_time_seconds = 0u64;
    for agent in &storage_agents {
        match storage.list_sessions(&agent.id, &jwt).await {
            Ok(sessions) => {
                total_sessions += sessions.len() as u64;
                total_time_seconds += sessions
                    .iter()
                    .map(|s| {
                        let created = s
                            .created_at
                            .as_deref()
                            .and_then(|t| DateTime::parse_from_rfc3339(t).ok())
                            .map(|dt| dt.with_timezone(&Utc));
                        // Active sessions without ended_at use `now` so their
                        // elapsed time is included in the running total.
                        let ended = s
                            .ended_at
                            .as_deref()
                            .and_then(|t| DateTime::parse_from_rfc3339(t).ok())
                            .map(|dt| dt.with_timezone(&Utc))
                            .unwrap_or(now);
                        match created {
                            Some(c) => (ended - c).num_seconds().max(0) as u64,
                            None => 0,
                        }
                    })
                    .sum::<u64>();
            }
            Err(e) => warn!(agent_id = %agent.id, error = %e, "failed to list sessions for agent"),
        }
    }
    progress.total_sessions = total_sessions;
    progress.total_time_seconds = total_time_seconds;
}

async fn aggregate_agent_instance_metrics(
    state: &AppState,
    project_id: &ProjectId,
    progress: &mut ProjectProgress,
) {
    let instances = match state.agent_instance_service.list_instances(project_id).await {
        Ok(v) => v,
        Err(e) => {
            tracing::error!(%project_id, error = %e, "Progress: failed to list agent instances");
            return;
        }
    };
    let fee_schedule = state.pricing_service.get_fee_schedule();
    for ai in &instances {
        tracing::debug!(
            %project_id,
            agent_instance_id = %ai.agent_instance_id,
            input = ai.total_input_tokens,
            output = ai.total_output_tokens,
            "Progress: agent instance token counts"
        );
    }
    let instance_tokens: u64 = instances
        .iter()
        .map(|ai| ai.total_input_tokens + ai.total_output_tokens)
        .sum();
    let instance_cost: f64 = instances
        .iter()
        .map(|ai| {
            let model = ai.model.as_deref().unwrap_or("claude-opus-4-6");
            let (inp, out) = aura_billing::lookup_rate_in(&fee_schedule, model);
            aura_billing::compute_cost_with_rates(
                ai.total_input_tokens, ai.total_output_tokens, inp, out,
            )
        })
        .sum();
    progress.total_tokens += instance_tokens;
    progress.total_cost += instance_cost;
    progress.total_agents = instances.len() as u32;
    tracing::info!(
        %project_id,
        instance_count = instances.len(),
        instance_tokens,
        total_tokens = progress.total_tokens,
        total_cost = progress.total_cost,
        "Progress: aggregated agent instance metrics"
    );
}

#[derive(Serialize)]
pub struct TaskOutputResponse {
    pub output: String,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub build_steps: Vec<serde_json::Value>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub test_steps: Vec<serde_json::Value>,
}

pub async fn get_task_output(
    State(state): State<AppState>,
    Path((_project_id, task_id)): Path<(ProjectId, TaskId)>,
) -> ApiResult<Json<TaskOutputResponse>> {
    let output = state
        .task_output_buffers
        .lock()
        .map_err(|e| ApiError::internal(e.to_string()))?
        .get(&task_id)
        .cloned()
        .unwrap_or_default();

    if !output.is_empty() {
        let (build_steps, test_steps) = state
            .task_step_buffers
            .lock()
            .ok()
            .and_then(|s| s.get(&task_id).cloned())
            .unwrap_or_default();
        return Ok(Json(TaskOutputResponse { output, build_steps, test_steps }));
    }

    if let (Some(storage), Ok(jwt)) = (state.storage_client.as_ref(), state.get_jwt()) {
        if let Ok(task) = storage.get_task(&task_id.to_string(), &jwt).await {
            if let Some(session_id) = task.session_id {
                if let Ok(msgs) = storage.list_messages(&session_id, &jwt, None, None).await {
                    let content: String = msgs
                        .iter()
                        .filter(|m| m.role.as_deref() == Some("assistant"))
                        .filter_map(|m| m.content.as_deref())
                        .collect::<Vec<_>>()
                        .join("\n");

                    let (mut build_steps, mut test_steps) = (Vec::new(), Vec::new());
                    for msg in &msgs {
                        if msg.role.as_deref() != Some("system") {
                            continue;
                        }
                        if let Some(content) = msg.content.as_deref() {
                            if let Ok(val) = serde_json::from_str::<serde_json::Value>(content) {
                                if val.get("_type").and_then(|t| t.as_str()) == Some("task_steps") {
                                    if let Some(bs) = val.get("build_steps").and_then(|v| v.as_array()) {
                                        build_steps = bs.clone();
                                    }
                                    if let Some(ts) = val.get("test_steps").and_then(|v| v.as_array()) {
                                        test_steps = ts.clone();
                                    }
                                }
                            }
                        }
                    }

                    if !content.is_empty() || !build_steps.is_empty() || !test_steps.is_empty() {
                        return Ok(Json(TaskOutputResponse { output: content, build_steps, test_steps }));
                    }
                }
            }
        }
    }

    Ok(Json(TaskOutputResponse {
        output: String::new(),
        build_steps: Vec::new(),
        test_steps: Vec::new(),
    }))
}
