use axum::extract::{Path, State};
use axum::Json;
use tokio::sync::mpsc;
use tracing::{error, info};

use aura_core::{ProjectId, Spec, SpecId};
use aura_engine::EngineEvent;

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
