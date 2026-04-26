use axum::{
    extract::{Path, Query, State},
    Json,
};
use chrono::Utc;
use serde::Deserialize;

use crate::types::*;

use super::db::{new_id, SharedDb};

#[derive(Debug, Deserialize)]
pub(super) struct EventListQuery {
    limit: Option<usize>,
    offset: Option<usize>,
}

pub(super) async fn create_event(
    Path(session_id): Path<String>,
    State(db): State<SharedDb>,
    Json(req): Json<CreateSessionEventRequest>,
) -> Json<StorageSessionEvent> {
    let evt = StorageSessionEvent {
        id: new_id(),
        session_id: Some(session_id),
        user_id: req.user_id,
        agent_id: req.agent_id,
        sender: req.sender,
        project_id: req.project_id,
        org_id: req.org_id,
        event_type: Some(req.event_type),
        content: req.content,
        created_at: Some(Utc::now().to_rfc3339()),
    };
    let mut db = db.lock().await;
    db.events.push(evt.clone());
    Json(evt)
}

pub(super) async fn list_events(
    Path(session_id): Path<String>,
    Query(query): Query<EventListQuery>,
    State(db): State<SharedDb>,
) -> Json<Vec<StorageSessionEvent>> {
    let db = db.lock().await;
    let limit = query.limit.unwrap_or(100).clamp(1, 500);
    let offset = query.offset.unwrap_or(0);
    let evts: Vec<_> = db
        .events
        .iter()
        .filter(|e| e.session_id.as_deref() == Some(&session_id))
        .skip(offset)
        .take(limit)
        .cloned()
        .collect();
    Json(evts)
}
