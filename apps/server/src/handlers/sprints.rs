use std::convert::Infallible;

use axum::extract::{Path, State};
use axum::response::sse::{Event, Sse};
use axum::Json;
use chrono::Utc;
use serde::Deserialize;
use tokio::sync::mpsc;
use tokio_stream::wrappers::UnboundedReceiverStream;
use tokio_stream::StreamExt;
use tracing::{error, info};

use aura_core::{ProjectId, Sprint, SprintId};
use aura_claude::ClaudeStreamEvent;

use crate::error::{ApiError, ApiResult};
use crate::state::AppState;

#[derive(Deserialize)]
pub struct CreateSprintRequest {
    pub title: String,
    #[serde(default)]
    pub prompt: String,
}

#[derive(Deserialize)]
pub struct UpdateSprintRequest {
    pub title: Option<String>,
    pub prompt: Option<String>,
}

#[derive(Deserialize)]
pub struct ReorderSprintsRequest {
    pub sprint_ids: Vec<SprintId>,
}

pub async fn list_sprints(
    State(state): State<AppState>,
    Path(project_id): Path<ProjectId>,
) -> ApiResult<Json<Vec<Sprint>>> {
    let mut sprints = state
        .store
        .list_sprints_by_project(&project_id)
        .map_err(|e| ApiError::internal(e.to_string()))?;
    sprints.sort_by_key(|s| s.order_index);
    Ok(Json(sprints))
}

pub async fn create_sprint(
    State(state): State<AppState>,
    Path(project_id): Path<ProjectId>,
    Json(body): Json<CreateSprintRequest>,
) -> ApiResult<Json<Sprint>> {
    let existing = state
        .store
        .list_sprints_by_project(&project_id)
        .map_err(|e| ApiError::internal(e.to_string()))?;

    let now = Utc::now();
    let sprint = Sprint {
        sprint_id: SprintId::new(),
        project_id,
        title: body.title,
        prompt: body.prompt,
        order_index: existing.len() as u32,
        generated_at: None,
        created_at: now,
        updated_at: now,
    };

    state
        .store
        .put_sprint(&sprint)
        .map_err(|e| ApiError::internal(e.to_string()))?;

    info!(%project_id, sprint_id = %sprint.sprint_id, "Sprint created");
    Ok(Json(sprint))
}

pub async fn get_sprint(
    State(state): State<AppState>,
    Path((project_id, sprint_id)): Path<(ProjectId, SprintId)>,
) -> ApiResult<Json<Sprint>> {
    let sprint = state
        .store
        .get_sprint(&project_id, &sprint_id)
        .map_err(|e| match e {
            aura_store::StoreError::NotFound(_) => ApiError::not_found("sprint not found"),
            _ => ApiError::internal(e.to_string()),
        })?;
    Ok(Json(sprint))
}

pub async fn update_sprint(
    State(state): State<AppState>,
    Path((project_id, sprint_id)): Path<(ProjectId, SprintId)>,
    Json(body): Json<UpdateSprintRequest>,
) -> ApiResult<Json<Sprint>> {
    let mut sprint = state
        .store
        .get_sprint(&project_id, &sprint_id)
        .map_err(|e| match e {
            aura_store::StoreError::NotFound(_) => ApiError::not_found("sprint not found"),
            _ => ApiError::internal(e.to_string()),
        })?;

    if let Some(title) = body.title {
        sprint.title = title;
    }
    if let Some(prompt) = body.prompt {
        sprint.prompt = prompt;
    }
    sprint.updated_at = Utc::now();

    state
        .store
        .put_sprint(&sprint)
        .map_err(|e| ApiError::internal(e.to_string()))?;

    Ok(Json(sprint))
}

pub async fn delete_sprint(
    State(state): State<AppState>,
    Path((project_id, sprint_id)): Path<(ProjectId, SprintId)>,
) -> ApiResult<Json<()>> {
    state
        .store
        .delete_sprint(&project_id, &sprint_id)
        .map_err(|e| ApiError::internal(e.to_string()))?;

    info!(%project_id, %sprint_id, "Sprint deleted");
    Ok(Json(()))
}

pub async fn generate_sprint(
    State(state): State<AppState>,
    Path((project_id, sprint_id)): Path<(ProjectId, SprintId)>,
) -> ApiResult<Json<Sprint>> {
    super::billing::require_credits(&state).await?;
    let sprint = state
        .store
        .get_sprint(&project_id, &sprint_id)
        .map_err(|e| match e {
            aura_store::StoreError::NotFound(_) => ApiError::not_found("sprint not found"),
            _ => ApiError::internal(e.to_string()),
        })?;

    let api_key = state
        .settings_service
        .get_decrypted_api_key()
        .map_err(|e| ApiError::internal(format!("API key error: {e}")))?;

    let sprint = state
        .sprint_gen
        .generate(&api_key, sprint)
        .await
        .map_err(|e| ApiError::internal(format!("Sprint generation failed: {e}")))?;

    Ok(Json(sprint))
}

pub async fn generate_sprint_stream(
    State(state): State<AppState>,
    Path((project_id, sprint_id)): Path<(ProjectId, SprintId)>,
) -> ApiResult<Sse<impl futures_core::Stream<Item = Result<Event, Infallible>>>> {
    super::billing::require_credits(&state).await?;
    let sprint = state
        .store
        .get_sprint(&project_id, &sprint_id)
        .map_err(|e| match e {
            aura_store::StoreError::NotFound(_) => ApiError::not_found("sprint not found"),
            _ => ApiError::internal(e.to_string()),
        })?;

    let api_key = state
        .settings_service
        .get_decrypted_api_key()
        .map_err(|e| ApiError::internal(format!("API key error: {e}")))?;

    let (claude_tx, claude_rx) = mpsc::unbounded_channel::<ClaudeStreamEvent>();
    let (sse_tx, sse_rx) = mpsc::unbounded_channel::<Event>();

    let sse_tx_fwd = sse_tx.clone();
    let sprint_gen = state.sprint_gen.clone();

    tokio::spawn(async move {
        match sprint_gen.generate_stream(&api_key, sprint, claude_tx).await {
            Ok(sprint) => {
                let _ = sse_tx.send(
                    Event::default()
                        .event("done")
                        .json_data(serde_json::json!({ "sprint": sprint }))
                        .unwrap(),
                );
            }
            Err(e) => {
                error!(%project_id, %sprint_id, error = %e, "Streaming sprint generation failed");
                let _ = sse_tx.send(
                    Event::default()
                        .event("error")
                        .json_data(serde_json::json!({ "message": e.to_string() }))
                        .unwrap(),
                );
            }
        }
    });

    tokio::spawn(forward_claude_events(claude_rx, sse_tx_fwd));

    let stream = UnboundedReceiverStream::new(sse_rx)
        .map(|evt| Ok::<_, Infallible>(evt));

    Ok(Sse::new(stream))
}

async fn forward_claude_events(
    mut rx: mpsc::UnboundedReceiver<ClaudeStreamEvent>,
    sse_tx: mpsc::UnboundedSender<Event>,
) {
    while let Some(evt) = rx.recv().await {
        let event = match &evt {
            ClaudeStreamEvent::Delta(text) => {
                Event::default()
                    .event("delta")
                    .json_data(serde_json::json!({ "text": text }))
                    .unwrap()
            }
            ClaudeStreamEvent::Done { input_tokens, output_tokens, .. } => {
                Event::default()
                    .event("generating")
                    .json_data(serde_json::json!({
                        "input_tokens": input_tokens,
                        "output_tokens": output_tokens,
                    }))
                    .unwrap()
            }
            ClaudeStreamEvent::Error(msg) => {
                Event::default()
                    .event("error")
                    .json_data(serde_json::json!({ "message": msg }))
                    .unwrap()
            }
            ClaudeStreamEvent::ToolUse { .. } | ClaudeStreamEvent::ThinkingDelta(_) => continue,
        };
        if sse_tx.send(event).is_err() {
            break;
        }
    }
}

pub async fn reorder_sprints(
    State(state): State<AppState>,
    Path(project_id): Path<ProjectId>,
    Json(body): Json<ReorderSprintsRequest>,
) -> ApiResult<Json<Vec<Sprint>>> {
    let mut sprints = state
        .store
        .list_sprints_by_project(&project_id)
        .map_err(|e| ApiError::internal(e.to_string()))?;

    let id_to_index: std::collections::HashMap<SprintId, u32> = body
        .sprint_ids
        .iter()
        .enumerate()
        .map(|(i, id)| (*id, i as u32))
        .collect();

    for sprint in &mut sprints {
        if let Some(&new_idx) = id_to_index.get(&sprint.sprint_id) {
            sprint.order_index = new_idx;
            sprint.updated_at = Utc::now();
            state
                .store
                .put_sprint(sprint)
                .map_err(|e| ApiError::internal(e.to_string()))?;
        }
    }

    sprints.sort_by_key(|s| s.order_index);
    Ok(Json(sprints))
}
