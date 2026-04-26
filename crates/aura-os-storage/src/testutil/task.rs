use axum::{
    extract::{Path, State},
    Json,
};
use chrono::Utc;

use crate::types::*;

use super::db::{new_id, SharedDb};

pub(super) async fn create_task(
    Path(project_id): Path<String>,
    State(db): State<SharedDb>,
    Json(req): Json<CreateTaskRequest>,
) -> Json<StorageTask> {
    let now = Utc::now().to_rfc3339();
    let task = StorageTask {
        id: new_id(),
        project_id: Some(project_id),
        org_id: req.org_id,
        spec_id: Some(req.spec_id),
        title: Some(req.title),
        description: req.description,
        status: req.status.or(Some("pending".to_string())),
        order_index: req.order_index,
        dependency_ids: req.dependency_ids,
        execution_notes: None,
        files_changed: None,
        model: None,
        total_input_tokens: None,
        total_output_tokens: None,
        assigned_project_agent_id: req.assigned_project_agent_id,
        session_id: None,
        created_at: Some(now.clone()),
        updated_at: Some(now),
    };
    let mut db = db.lock().await;
    db.tasks.push(task.clone());
    Json(task)
}

pub(super) async fn get_task(
    Path(task_id): Path<String>,
    State(db): State<SharedDb>,
) -> Result<Json<StorageTask>, axum::http::StatusCode> {
    let db = db.lock().await;
    db.tasks
        .iter()
        .find(|t| t.id == task_id)
        .cloned()
        .map(Json)
        .ok_or(axum::http::StatusCode::NOT_FOUND)
}

pub(super) async fn list_tasks(
    Path(project_id): Path<String>,
    State(db): State<SharedDb>,
) -> Json<Vec<StorageTask>> {
    let db = db.lock().await;
    let tasks: Vec<_> = db
        .tasks
        .iter()
        .filter(|t| t.project_id.as_deref() == Some(&project_id))
        .cloned()
        .collect();
    Json(tasks)
}

pub(super) async fn update_task(
    Path(task_id): Path<String>,
    State(db): State<SharedDb>,
    Json(req): Json<UpdateTaskRequest>,
) -> axum::http::StatusCode {
    let mut db = db.lock().await;
    if let Some(task) = db.tasks.iter_mut().find(|t| t.id == task_id) {
        if let Some(v) = req.title {
            task.title = Some(v);
        }
        if let Some(v) = req.description {
            task.description = Some(v);
        }
        if let Some(v) = req.order_index {
            task.order_index = Some(v);
        }
        if let Some(v) = req.dependency_ids {
            task.dependency_ids = Some(v);
        }
        if let Some(v) = req.execution_notes {
            task.execution_notes = Some(v);
        }
        if let Some(v) = req.files_changed {
            task.files_changed = Some(v);
        }
        if let Some(v) = req.model {
            task.model = Some(v);
        }
        if let Some(v) = req.total_input_tokens {
            task.total_input_tokens = Some(v);
        }
        if let Some(v) = req.total_output_tokens {
            task.total_output_tokens = Some(v);
        }
        if let Some(v) = req.session_id {
            task.session_id = Some(v);
        }
        if let Some(v) = req.assigned_project_agent_id {
            task.assigned_project_agent_id = Some(v);
        }
        task.updated_at = Some(Utc::now().to_rfc3339());
        axum::http::StatusCode::OK
    } else {
        axum::http::StatusCode::NOT_FOUND
    }
}

pub(super) async fn transition_task(
    Path(task_id): Path<String>,
    State(db): State<SharedDb>,
    Json(req): Json<TransitionTaskRequest>,
) -> axum::http::StatusCode {
    let mut db = db.lock().await;
    if let Some(task) = db.tasks.iter_mut().find(|t| t.id == task_id) {
        task.status = Some(req.status);
        task.updated_at = Some(Utc::now().to_rfc3339());
        axum::http::StatusCode::OK
    } else {
        axum::http::StatusCode::NOT_FOUND
    }
}

pub(super) async fn delete_task(
    Path(task_id): Path<String>,
    State(db): State<SharedDb>,
) -> axum::http::StatusCode {
    let mut db = db.lock().await;
    let len_before = db.tasks.len();
    db.tasks.retain(|t| t.id != task_id);
    if db.tasks.len() < len_before {
        axum::http::StatusCode::OK
    } else {
        axum::http::StatusCode::NOT_FOUND
    }
}
