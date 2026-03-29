use axum::extract::{Path, Query, State};
use axum::Json;
use serde::{Deserialize, Serialize};
use tracing::debug;

use aura_os_core::{AgentInstanceId, HarnessMode, ProjectId, SpecId, Task, TaskId, TaskStatus};
use aura_os_link::{HarnessInbound, HarnessOutbound, UserMessage};
use aura_os_storage::StorageTask;
use aura_os_tasks::TaskService;

use super::projects_helpers::project_tool_session_config;
use crate::dto::TransitionTaskRequest;
use crate::error::{ApiError, ApiResult};
use crate::state::{AppState, AuthJwt};

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

pub(crate) async fn extract_tasks(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    Path(project_id): Path<ProjectId>,
    Query(params): Query<TaskQueryParams>,
) -> ApiResult<Json<Vec<Task>>> {
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
    let session_config = project_tool_session_config(&state, &project_id, "task-extract", &jwt);
    let session = harness
        .open_session(session_config)
        .await
        .map_err(|e| ApiError::internal(format!("opening task extraction session: {e}")))?;

    session
        .commands_tx
        .send(HarnessInbound::UserMessage(UserMessage {
            content: format!("Extract tasks for project {project_id}"),
            tool_hints: None,
        }))
        .map_err(|e| ApiError::internal(format!("sending task extract command: {e}")))?;

    let mut rx = session.events_tx.subscribe();
    while let Ok(event) = rx.recv().await {
        match event {
            HarnessOutbound::AssistantMessageEnd(_) => {
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
                return Ok(Json(tasks));
            }
            HarnessOutbound::Error(err) => {
                return Err(ApiError::internal(err.message));
            }
            _ => continue,
        }
    }

    Ok(Json(Vec::new()))
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
}

async fn fetch_task_output_from_storage(
    storage: &aura_os_storage::StorageClient,
    jwt: &str,
    task_id: &TaskId,
) -> Option<TaskOutputResponse> {
    let task = storage.get_task(&task_id.to_string(), jwt).await.ok()?;
    let session_id = match task.session_id {
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
    })
}

pub(crate) async fn get_task_output(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    Path((_project_id, task_id)): Path<(ProjectId, TaskId)>,
) -> ApiResult<Json<TaskOutputResponse>> {
    // Check the in-memory cache first (covers active and recently completed tasks).
    {
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
                }));
            }
        }
    }

    // Fall back to persisted storage.
    if let Some(storage) = state.storage_client.as_ref() {
        if let Some(resp) = fetch_task_output_from_storage(storage, &jwt, &task_id).await {
            return Ok(Json(resp));
        }
    }

    Ok(Json(TaskOutputResponse {
        output: String::new(),
        build_steps: Vec::new(),
        test_steps: Vec::new(),
    }))
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
}
