use std::convert::Infallible;

use axum::extract::{Path, State};
use axum::response::sse::{Event, KeepAlive, Sse};
use axum::Json;
use tokio::sync::mpsc;
use tokio_stream::wrappers::UnboundedReceiverStream;
use tokio_stream::StreamExt;
use tracing::{error, info};

use aura_core::{ProjectId, Spec, SpecId};
use aura_engine::EngineEvent;
use aura_specs::SpecStreamEvent;

use crate::error::{ApiError, ApiResult};
use crate::state::AppState;

pub async fn list_specs(
    State(state): State<AppState>,
    Path(project_id): Path<ProjectId>,
) -> ApiResult<Json<Vec<Spec>>> {
    let storage = state.require_storage_client()?;
    let jwt = state.get_jwt()?;
    let storage_specs = storage
        .list_specs(&project_id.to_string(), &jwt)
        .await
        .map_err(|e| ApiError::internal(e.to_string()))?;
    let mut specs: Vec<Spec> = storage_specs
        .into_iter()
        .filter_map(|s| Spec::try_from(s).ok())
        .collect();
    specs.sort_by_key(|s| s.order_index);
    Ok(Json(specs))
}

pub async fn generate_specs_summary(
    State(state): State<AppState>,
    Path(project_id): Path<ProjectId>,
) -> ApiResult<Json<aura_core::Project>> {
    info!(%project_id, "Specs summary regeneration requested");
    state
        .spec_gen_service
        .regenerate_specs_summary(&project_id)
        .await
        .map_err(|e| ApiError::internal(e.to_string()))?;
    let project = state
        .project_service
        .get_project_async(&project_id)
        .await
        .map_err(|_e| ApiError::not_found("project not found"))?;
    Ok(Json(project))
}

pub async fn get_spec(
    State(state): State<AppState>,
    Path((_project_id, spec_id)): Path<(ProjectId, SpecId)>,
) -> ApiResult<Json<Spec>> {
    let storage = state.require_storage_client()?;
    let jwt = state.get_jwt()?;
    let storage_spec = storage
        .get_spec(&spec_id.to_string(), &jwt)
        .await
        .map_err(|e| match &e {
            aura_storage::StorageError::Server { status: 404, .. } => {
                ApiError::not_found("spec not found")
            }
            _ => ApiError::internal(e.to_string()),
        })?;
    let spec = Spec::try_from(storage_spec)
        .map_err(ApiError::internal)?;
    Ok(Json(spec))
}

pub async fn generate_specs(
    State(state): State<AppState>,
    Path(project_id): Path<ProjectId>,
) -> ApiResult<Json<Vec<Spec>>> {
    super::billing::require_credits(&state).await?;
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
                aura_specs::SpecGenError::ProjectNotFound(_) => {
                    ApiError::not_found("project not found")
                }
                aura_specs::SpecGenError::RequirementsFileNotFound(p) => {
                    ApiError::bad_request(format!("requirements file not found: {p}"))
                }
                aura_specs::SpecGenError::Settings(_) => {
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
) -> ApiResult<Sse<impl futures_core::Stream<Item = Result<Event, Infallible>>>> {
    super::billing::require_credits(&state).await?;
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
            SpecStreamEvent::SpecsTitle(title) => {
                Event::default()
                    .event("specs_title")
                    .json_data(serde_json::json!({ "title": title }))
                    .unwrap()
            }
            SpecStreamEvent::SpecsSummary(summary) => {
                Event::default()
                    .event("specs_summary")
                    .json_data(serde_json::json!({ "summary": summary }))
                    .unwrap()
            }
            SpecStreamEvent::Delta(text) => {
                Event::default()
                    .event("delta")
                    .json_data(serde_json::json!({ "text": text }))
                    .unwrap()
            }
            SpecStreamEvent::Generating { tokens } => {
                Event::default()
                    .event("generating")
                    .json_data(serde_json::json!({ "tokens": tokens }))
                    .unwrap()
            }
            SpecStreamEvent::SpecSaved(ref spec) => {
                let _ = event_tx_map.send(EngineEvent::SpecSaved {
                    project_id,
                    spec: spec.clone(),
                });
                Event::default()
                    .event("spec_saved")
                    .json_data(serde_json::json!({ "spec": spec }))
                    .unwrap()
            }
            SpecStreamEvent::TaskSaved(ref task) => {
                Event::default()
                    .event("task_saved")
                    .json_data(serde_json::json!({ "task": task }))
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
            SpecStreamEvent::TokenUsage { input_tokens, output_tokens } => {
                Event::default()
                    .event("token_usage")
                    .json_data(serde_json::json!({
                        "input_tokens": input_tokens,
                        "output_tokens": output_tokens,
                    }))
                    .unwrap()
            }
        };
        Ok(sse_event)
    });

    Ok(Sse::new(stream).keep_alive(KeepAlive::default()))
}
