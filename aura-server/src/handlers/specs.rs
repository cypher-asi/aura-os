use std::convert::Infallible;

use axum::extract::{Path, State};
use axum::response::sse::{Event, Sse};
use axum::Json;
use tokio::sync::mpsc;
use tokio_stream::wrappers::UnboundedReceiverStream;
use tokio_stream::StreamExt;
use tracing::{error, info};

use aura_core::{ProjectId, Spec, SpecId};
use aura_engine::EngineEvent;
use aura_services::SpecStreamEvent;

use crate::error::{ApiError, ApiResult};
use crate::state::AppState;

pub async fn list_specs(
    State(state): State<AppState>,
    Path(project_id): Path<ProjectId>,
) -> ApiResult<Json<Vec<Spec>>> {
    let specs = state
        .spec_gen_service
        .list_specs(&project_id)
        .map_err(|e| ApiError::internal(e.to_string()))?;
    Ok(Json(specs))
}

pub async fn get_spec(
    State(state): State<AppState>,
    Path((project_id, spec_id)): Path<(ProjectId, SpecId)>,
) -> ApiResult<Json<Spec>> {
    let spec = state
        .spec_gen_service
        .get_spec(&project_id, &spec_id)
        .map_err(|e| match e {
            aura_services::SpecGenError::Store(aura_store::StoreError::NotFound(_)) => {
                ApiError::not_found("spec not found")
            }
            _ => ApiError::internal(e.to_string()),
        })?;
    Ok(Json(spec))
}

pub async fn generate_specs(
    State(state): State<AppState>,
    Path(project_id): Path<ProjectId>,
) -> ApiResult<Json<Vec<Spec>>> {
    info!(%project_id, "Spec generation requested");

    let _ = state.event_tx.send(EngineEvent::SpecGenStarted {
        project_id,
    });

    let (progress_tx, mut progress_rx) = mpsc::unbounded_channel::<String>();

    let event_tx = state.event_tx.clone();
    let pid = project_id;
    tokio::spawn(async move {
        while let Some(stage) = progress_rx.recv().await {
            info!(%pid, stage, "Spec generation progress");
            let _ = event_tx.send(EngineEvent::SpecGenProgress {
                project_id: pid,
                stage,
            });
        }
    });

    let result = state
        .spec_gen_service
        .generate_specs_with_progress(&project_id, Some(progress_tx))
        .await;

    match result {
        Ok(specs) => {
            info!(%project_id, count = specs.len(), "Spec generation completed");
            let _ = state.event_tx.send(EngineEvent::SpecGenCompleted {
                project_id,
                spec_count: specs.len(),
            });
            Ok(Json(specs))
        }
        Err(e) => {
            error!(%project_id, error = %e, "Spec generation failed");
            let _ = state.event_tx.send(EngineEvent::SpecGenFailed {
                project_id,
                reason: e.to_string(),
            });
            Err(match &e {
                aura_services::SpecGenError::ProjectNotFound(_) => {
                    ApiError::not_found("project not found")
                }
                aura_services::SpecGenError::RequirementsFileNotFound(p) => {
                    ApiError::bad_request(format!("requirements file not found: {p}"))
                }
                aura_services::SpecGenError::Settings(_) => {
                    ApiError::bad_request("API key not configured")
                }
                _ => ApiError::internal(e.to_string()),
            })
        }
    }
}

pub async fn generate_specs_stream(
    State(state): State<AppState>,
    Path(project_id): Path<ProjectId>,
) -> Sse<impl futures_core::Stream<Item = Result<Event, Infallible>>> {
    info!(%project_id, "Streaming spec generation requested");

    let _ = state.event_tx.send(EngineEvent::SpecGenStarted { project_id });

    let (tx, rx) = mpsc::unbounded_channel::<SpecStreamEvent>();

    let spec_gen = state.spec_gen_service.clone();
    let pid = project_id;
    tokio::spawn(async move {
        spec_gen.generate_specs_streaming(&pid, tx).await;
    });

    let event_tx_map = state.event_tx.clone();
    let stream = UnboundedReceiverStream::new(rx).map(move |evt| {
        let sse_event = match &evt {
            SpecStreamEvent::Progress(stage) => {
                Event::default()
                    .event("progress")
                    .json_data(serde_json::json!({ "stage": stage }))
                    .unwrap()
            }
            SpecStreamEvent::Generating { tokens } => {
                Event::default()
                    .event("generating")
                    .json_data(serde_json::json!({ "tokens": tokens }))
                    .unwrap()
            }
            SpecStreamEvent::Complete(specs) => {
                let _ = event_tx_map.send(EngineEvent::SpecGenCompleted {
                    project_id,
                    spec_count: specs.len(),
                });
                Event::default()
                    .event("complete")
                    .json_data(serde_json::json!({ "specs": specs }))
                    .unwrap()
            }
            SpecStreamEvent::Error(msg) => {
                let _ = event_tx_map.send(EngineEvent::SpecGenFailed {
                    project_id,
                    reason: msg.clone(),
                });
                Event::default()
                    .event("error")
                    .json_data(serde_json::json!({ "message": msg }))
                    .unwrap()
            }
        };
        Ok(sse_event)
    });

    Sse::new(stream)
}
