use axum::{
    extract::{Path, State},
    Json,
};
use chrono::Utc;

use crate::types::*;

use super::db::{new_id, SharedDb};

pub(super) async fn create_spec(
    Path(project_id): Path<String>,
    State(db): State<SharedDb>,
    Json(req): Json<CreateSpecRequest>,
) -> Json<StorageSpec> {
    let now = Utc::now().to_rfc3339();
    let spec = StorageSpec {
        id: new_id(),
        project_id: Some(project_id),
        org_id: req.org_id,
        title: Some(req.title),
        order_index: req.order_index,
        markdown_contents: req.markdown_contents,
        created_at: Some(now.clone()),
        updated_at: Some(now),
    };
    let mut db = db.lock().await;
    db.specs.push(spec.clone());
    Json(spec)
}

pub(super) async fn get_spec(
    Path(spec_id): Path<String>,
    State(db): State<SharedDb>,
) -> Result<Json<StorageSpec>, axum::http::StatusCode> {
    let db = db.lock().await;
    db.specs
        .iter()
        .find(|s| s.id == spec_id)
        .cloned()
        .map(Json)
        .ok_or(axum::http::StatusCode::NOT_FOUND)
}

pub(super) async fn update_spec(
    Path(spec_id): Path<String>,
    State(db): State<SharedDb>,
    Json(req): Json<UpdateSpecRequest>,
) -> axum::http::StatusCode {
    let mut db = db.lock().await;
    if let Some(spec) = db.specs.iter_mut().find(|s| s.id == spec_id) {
        if let Some(title) = req.title {
            spec.title = Some(title);
        }
        if let Some(order_index) = req.order_index {
            spec.order_index = Some(order_index);
        }
        if let Some(markdown_contents) = req.markdown_contents {
            spec.markdown_contents = Some(markdown_contents);
        }
        spec.updated_at = Some(Utc::now().to_rfc3339());
        axum::http::StatusCode::OK
    } else {
        axum::http::StatusCode::NOT_FOUND
    }
}

pub(super) async fn delete_spec(
    Path(spec_id): Path<String>,
    State(db): State<SharedDb>,
) -> axum::http::StatusCode {
    let mut db = db.lock().await;
    let len_before = db.specs.len();
    db.specs.retain(|s| s.id != spec_id);
    if db.specs.len() < len_before {
        axum::http::StatusCode::NO_CONTENT
    } else {
        axum::http::StatusCode::NOT_FOUND
    }
}

pub(super) async fn list_specs(
    Path(project_id): Path<String>,
    State(db): State<SharedDb>,
) -> Json<Vec<StorageSpec>> {
    let db = db.lock().await;
    let specs: Vec<_> = db
        .specs
        .iter()
        .filter(|s| s.project_id.as_deref() == Some(&project_id))
        .cloned()
        .collect();
    Json(specs)
}
