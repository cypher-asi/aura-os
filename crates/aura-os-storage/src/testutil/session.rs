use axum::{
    extract::{Path, State},
    Json,
};
use chrono::Utc;

use crate::types::*;

use super::db::{new_id, SharedDb};

pub(super) async fn create_session(
    Path(project_agent_id): Path<String>,
    State(db): State<SharedDb>,
    Json(req): Json<CreateSessionRequest>,
) -> Json<StorageSession> {
    let session = StorageSession {
        id: new_id(),
        project_agent_id: Some(project_agent_id),
        project_id: Some(req.project_id),
        org_id: req.org_id,
        model: req.model,
        status: req.status.or(Some("active".to_string())),
        context_usage_estimate: req.context_usage_estimate,
        total_input_tokens: Some(0),
        total_output_tokens: Some(0),
        summary_of_previous_context: req.summary_of_previous_context,
        tasks_worked_count: Some(0),
        ended_at: None,
        started_at: Some(Utc::now().to_rfc3339()),
        created_at: Some(Utc::now().to_rfc3339()),
        updated_at: Some(Utc::now().to_rfc3339()),
    };
    let mut db = db.lock().await;
    db.sessions.push(session.clone());
    Json(session)
}

pub(super) async fn get_session(
    Path(session_id): Path<String>,
    State(db): State<SharedDb>,
) -> Result<Json<StorageSession>, axum::http::StatusCode> {
    let db = db.lock().await;
    db.sessions
        .iter()
        .find(|s| s.id == session_id)
        .cloned()
        .map(Json)
        .ok_or(axum::http::StatusCode::NOT_FOUND)
}

pub(super) async fn update_session(
    Path(session_id): Path<String>,
    State(db): State<SharedDb>,
    Json(req): Json<UpdateSessionRequest>,
) -> axum::http::StatusCode {
    let mut db = db.lock().await;
    if let Some(session) = db.sessions.iter_mut().find(|s| s.id == session_id) {
        if let Some(status) = req.status {
            session.status = Some(status);
        }
        if let Some(total_input_tokens) = req.total_input_tokens {
            session.total_input_tokens = Some(total_input_tokens);
        }
        if let Some(total_output_tokens) = req.total_output_tokens {
            session.total_output_tokens = Some(total_output_tokens);
        }
        if let Some(usage) = req.context_usage_estimate {
            session.context_usage_estimate = Some(usage);
        }
        if let Some(summary) = req.summary_of_previous_context {
            session.summary_of_previous_context = Some(summary);
        }
        if let Some(count) = req.tasks_worked_count {
            session.tasks_worked_count = Some(count);
        }
        if let Some(ended) = req.ended_at {
            session.ended_at = Some(ended);
        }
        session.updated_at = Some(Utc::now().to_rfc3339());
        axum::http::StatusCode::OK
    } else {
        axum::http::StatusCode::NOT_FOUND
    }
}

pub(super) async fn list_sessions(
    Path(project_agent_id): Path<String>,
    State(db): State<SharedDb>,
) -> Json<Vec<StorageSession>> {
    let db = db.lock().await;
    let filtered: Vec<StorageSession> = db
        .sessions
        .iter()
        .filter(|s| s.project_agent_id.as_deref() == Some(project_agent_id.as_str()))
        .cloned()
        .collect();
    Json(filtered)
}

pub(super) async fn delete_session(
    Path(session_id): Path<String>,
    State(db): State<SharedDb>,
) -> axum::http::StatusCode {
    let mut db = db.lock().await;
    let len_before = db.sessions.len();
    db.sessions.retain(|s| s.id != session_id);
    if db.sessions.len() < len_before {
        db.events
            .retain(|e| e.session_id.as_deref() != Some(session_id.as_str()));
        axum::http::StatusCode::OK
    } else {
        axum::http::StatusCode::NOT_FOUND
    }
}
