use axum::extract::{Path, State};
use axum::Json;
use serde::Deserialize;

use aura_os_core::{ProjectId, Task, TaskId, TaskStatus};
use aura_os_tasks::TaskService;

use super::common::storage_task_to_task;
use super::preflight::try_preflight_decompose_task;
use crate::dto::TransitionTaskRequest;
use crate::error::{ApiError, ApiResult};
use crate::state::{AppState, AuthJwt};

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
    let status = serde_json::to_value(req.new_status)
        .map_err(|e| ApiError::internal(format!("serializing task status: {e}")))?
        .as_str()
        .unwrap_or("pending")
        .to_string();

    storage
        .transition_task(
            &task_id.to_string(),
            &jwt,
            &aura_os_storage::TransitionTaskRequest { status },
        )
        .await
        .map_err(storage_transition_error("transitioning task"))?;
    let updated = storage
        .get_task(&task_id.to_string(), &jwt)
        .await
        .map_err(|e| ApiError::internal(format!("fetching updated task: {e}")))?;
    Ok(Json(
        storage_task_to_task(updated).map_err(ApiError::internal)?,
    ))
}

pub(crate) async fn retry_task(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    Path((_project_id, task_id)): Path<(ProjectId, TaskId)>,
) -> ApiResult<Json<Task>> {
    let storage = state.require_storage_client()?;
    aura_os_tasks::safe_transition(storage, &jwt, &task_id.to_string(), TaskStatus::Ready)
        .await
        .map(Json)
        .map_err(|e| match &e {
            aura_os_tasks::TaskError::Storage(aura_os_storage::StorageError::Server {
                status: 404,
                ..
            }) => ApiError::not_found("task not found"),
            aura_os_tasks::TaskError::Storage(aura_os_storage::StorageError::Server {
                status: 400,
                body,
            }) => ApiError::bad_request(body.clone()),
            aura_os_tasks::TaskError::IllegalTransition { .. } => {
                ApiError::bad_request(format!("retrying task: {e}"))
            }
            _ => ApiError::internal(format!("retrying task: {e}")),
        })
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
    let norm_title = req.title.trim().to_lowercase();

    if !norm_title.is_empty() {
        match storage.list_tasks(&project_id.to_string(), &jwt).await {
            Ok(existing) => {
                if let Some(dup) = existing.into_iter().find(|t| {
                    t.spec_id.as_deref() == Some(req.spec_id.as_str())
                        && t.title
                            .as_deref()
                            .map(|title| title.trim().to_lowercase() == norm_title)
                            .unwrap_or(false)
                }) {
                    let mut task = storage_task_to_task(dup).map_err(ApiError::internal)?;
                    task.skip_auto_decompose = skip_auto_decompose;
                    broadcast_task_saved(&state, &project_id, &task);
                    return Ok(Json(task));
                }
            }
            Err(e) => tracing::warn!(
                %project_id,
                %e,
                "create_task dedupe pre-check failed; proceeding to create"
            ),
        }
    }

    let created = storage
        .create_task(
            &project_id.to_string(),
            &jwt,
            &aura_os_storage::CreateTaskRequest {
                spec_id: req.spec_id,
                title: req.title,
                org_id: None,
                description: req.description,
                status: Some(req.status.unwrap_or_else(|| "backlog".to_string())),
                order_index: req.order_index,
                dependency_ids: req.dependency_ids,
                assigned_project_agent_id: req.assigned_agent_instance_id,
            },
        )
        .await
        .map_err(|e| ApiError::internal(format!("creating task: {e}")))?;
    let mut task = storage_task_to_task(created).map_err(ApiError::internal)?;
    task.skip_auto_decompose = skip_auto_decompose;
    broadcast_task_saved(&state, &project_id, &task);

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
                    assigned_project_agent_id: req.assigned_agent_instance_id,
                    ..Default::default()
                },
            )
            .await
            .map_err(storage_transition_error("updating task"))?;
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
                .map_err(storage_transition_error("transitioning updated task"))?;
        }
    }

    let updated = storage
        .get_task(&task_id.to_string(), &jwt)
        .await
        .map_err(|e| ApiError::internal(format!("fetching updated task: {e}")))?;
    Ok(Json(
        storage_task_to_task(updated).map_err(ApiError::internal)?,
    ))
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

fn broadcast_task_saved(state: &AppState, project_id: &ProjectId, task: &Task) {
    let _ = state.event_broadcast.send(serde_json::json!({
        "type": "task_saved",
        "project_id": project_id.to_string(),
        "task": task,
        "task_id": task.task_id.to_string(),
    }));
}

fn storage_transition_error(
    context: &'static str,
) -> impl FnOnce(aura_os_storage::StorageError) -> (axum::http::StatusCode, Json<ApiError>) {
    move |e| match &e {
        aura_os_storage::StorageError::Server { status: 404, .. } => {
            ApiError::not_found("task not found")
        }
        aura_os_storage::StorageError::Server { status: 400, body } => {
            ApiError::bad_request(body.clone())
        }
        _ => ApiError::internal(format!("{context}: {e}")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn retry_bridge_planner_contract() {
        use aura_os_tasks::compute_bridge;

        assert_eq!(
            compute_bridge(TaskStatus::Ready, TaskStatus::Ready),
            Some(vec![])
        );
        assert_eq!(
            compute_bridge(TaskStatus::InProgress, TaskStatus::Ready),
            Some(vec![TaskStatus::Failed, TaskStatus::Ready])
        );
        assert_eq!(
            compute_bridge(TaskStatus::Failed, TaskStatus::Ready),
            Some(vec![TaskStatus::Ready])
        );
        assert_eq!(
            compute_bridge(TaskStatus::Blocked, TaskStatus::Ready),
            Some(vec![TaskStatus::Ready])
        );
        assert_eq!(
            compute_bridge(TaskStatus::Pending, TaskStatus::Ready),
            Some(vec![TaskStatus::Ready])
        );
        assert!(compute_bridge(TaskStatus::Done, TaskStatus::Ready).is_none());
    }
}
