use axum::extract::{Path, State};
use axum::Json;
use serde::Serialize;

use aura_core::{ProjectId, SpecId, Task, TaskId, TaskStatus};
use aura_storage::StorageTask;
use aura_tasks::TaskService;

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
            aura_storage::StorageError::Server { status: 404, .. } => {
                ApiError::not_found("task not found")
            }
            _ => ApiError::internal(e.to_string()),
        })?;
    let task = storage_task_to_task(current).map_err(ApiError::internal)?;
    TaskService::validate_transition(task.status, req.new_status)
        .map_err(|e| ApiError::bad_request(e.to_string()))?;

    let status_str = serde_json::to_value(req.new_status)
        .unwrap()
        .as_str()
        .unwrap_or("pending")
        .to_string();

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
            aura_storage::StorageError::Server { status: 404, .. } => {
                ApiError::not_found("task not found")
            }
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

#[derive(Serialize)]
pub struct TaskOutputResponse {
    pub output: String,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub build_steps: Vec<serde_json::Value>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub test_steps: Vec<serde_json::Value>,
}

async fn fetch_task_output_from_storage(
    storage: &aura_storage::StorageClient,
    jwt: &str,
    task_id: &TaskId,
) -> Option<TaskOutputResponse> {
    let task = storage.get_task(&task_id.to_string(), jwt).await.ok()?;
    let session_id = task.session_id?;
    let msgs = storage
        .list_messages(&session_id, jwt, None, None)
        .await
        .ok()?;

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

    if content.is_empty() && build_steps.is_empty() && test_steps.is_empty() {
        return None;
    }
    Some(TaskOutputResponse {
        output: content,
        build_steps,
        test_steps,
    })
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
        return Ok(Json(TaskOutputResponse {
            output,
            build_steps,
            test_steps,
        }));
    }

    if let (Some(storage), Ok(jwt)) = (state.storage_client.as_ref(), state.get_jwt()) {
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
    use aura_storage::StorageTask;

    fn make_valid_storage_task() -> StorageTask {
        StorageTask {
            id: uuid::Uuid::new_v4().to_string(),
            project_id: Some(uuid::Uuid::new_v4().to_string()),
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
