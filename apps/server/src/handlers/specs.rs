use std::convert::Infallible;

use axum::extract::{Path, State};
use axum::http::HeaderValue;
use axum::response::sse::{Event, KeepAlive, Sse};
use axum::Json;
use tokio_stream::wrappers::UnboundedReceiverStream;
use tokio_stream::StreamExt;
use tracing::info;

use aura_os_core::{ProjectId, Spec, SpecId};
use aura_os_link::AutomatonEvent;

use crate::error::{ApiError, ApiResult};
use crate::state::AppState;

pub(crate) async fn list_specs(
    State(state): State<AppState>,
    Path(project_id): Path<ProjectId>,
) -> ApiResult<Json<Vec<Spec>>> {
    let storage = state.require_storage_client()?;
    let jwt = state.get_jwt()?;
    let storage_specs = storage
        .list_specs(&project_id.to_string(), &jwt)
        .await
        .map_err(|e| ApiError::internal(format!("listing specs: {e}")))?;
    let mut specs: Vec<Spec> = storage_specs
        .into_iter()
        .filter_map(|s| Spec::try_from(s).ok())
        .collect();
    specs.sort_by_key(|s| s.order_index);
    Ok(Json(specs))
}

pub(crate) async fn generate_specs_summary(
    State(state): State<AppState>,
    Path(project_id): Path<ProjectId>,
) -> ApiResult<Json<aura_os_core::Project>> {
    info!(%project_id, "Specs summary regeneration requested");

    let config = serde_json::json!({
        "project_id": project_id.to_string(),
    });
    let resp = state
        .swarm_client
        .install("spec-summary", config)
        .await
        .map_err(|e| ApiError::internal(format!("installing spec summary agent: {e}")))?;

    let mut rx = state
        .swarm_client
        .events(&resp.automaton_id)
        .await
        .map_err(|e| ApiError::internal(format!("subscribing to spec summary events: {e}")))?;

    while let Some(event) = rx.recv().await {
        match event.event_type.as_str() {
            "complete" | "done" => break,
            "error" => {
                let msg = event
                    .data
                    .get("message")
                    .and_then(|m| m.as_str())
                    .unwrap_or("spec summary generation failed");
                return Err(ApiError::internal(msg.to_string()));
            }
            _ => continue,
        }
    }

    let project = state
        .project_service
        .get_project_async(&project_id)
        .await
        .map_err(|_e| ApiError::not_found("project not found"))?;
    Ok(Json(project))
}

pub(crate) async fn get_spec(
    State(state): State<AppState>,
    Path((_project_id, spec_id)): Path<(ProjectId, SpecId)>,
) -> ApiResult<Json<Spec>> {
    let storage = state.require_storage_client()?;
    let jwt = state.get_jwt()?;
    let storage_spec =
        storage
            .get_spec(&spec_id.to_string(), &jwt)
            .await
            .map_err(|e| match &e {
                aura_os_storage::StorageError::Server { status: 404, .. } => {
                    ApiError::not_found("spec not found")
                }
                _ => ApiError::internal(format!("fetching spec: {e}")),
            })?;
    let spec = Spec::try_from(storage_spec).map_err(ApiError::internal)?;
    Ok(Json(spec))
}

const SSE_NO_BUFFERING_HEADERS: [(&str, HeaderValue); 1] =
    [("X-Accel-Buffering", HeaderValue::from_static("no"))];

async fn install_spec_gen(
    state: &AppState,
    project_id: &ProjectId,
) -> ApiResult<tokio::sync::mpsc::UnboundedReceiver<AutomatonEvent>> {
    super::billing::require_credits(state).await?;

    let config = serde_json::json!({
        "project_id": project_id.to_string(),
    });

    let resp = state
        .swarm_client
        .install("spec-gen", config)
        .await
        .map_err(|e| ApiError::internal(format!("installing spec generation agent: {e}")))?;

    state
        .swarm_client
        .events(&resp.automaton_id)
        .await
        .map_err(|e| ApiError::internal(format!("subscribing to spec generation events: {e}")))
}

pub(crate) async fn generate_specs(
    State(state): State<AppState>,
    Path(project_id): Path<ProjectId>,
) -> ApiResult<Json<Vec<Spec>>> {
    info!(%project_id, "Spec generation requested");
    let mut rx = install_spec_gen(&state, &project_id).await?;

    while let Some(event) = rx.recv().await {
        match event.event_type.as_str() {
            "complete" => {
                let specs: Vec<Spec> = serde_json::from_value(
                    event.data.get("specs").cloned().unwrap_or_default(),
                )
                .unwrap_or_default();
                info!(%project_id, count = specs.len(), "Spec generation completed");
                return Ok(Json(specs));
            }
            "error" => {
                let reason = event
                    .data
                    .get("message")
                    .and_then(|m| m.as_str())
                    .unwrap_or("spec generation failed")
                    .to_string();
                return Err(ApiError::internal(reason));
            }
            _ => continue,
        }
    }

    Err(ApiError::internal(
        "spec generation stream ended without result",
    ))
}

pub(crate) async fn generate_specs_stream(
    State(state): State<AppState>,
    Path(project_id): Path<ProjectId>,
) -> ApiResult<(
    [(&'static str, HeaderValue); 1],
    Sse<impl futures_core::Stream<Item = Result<Event, Infallible>>>,
)> {
    info!(%project_id, "Streaming spec generation requested");
    let events_rx = install_spec_gen(&state, &project_id).await?;

    let stream = UnboundedReceiverStream::new(events_rx)
        .map(|evt| super::sse::automaton_event_to_sse(&evt));

    Ok((
        SSE_NO_BUFFERING_HEADERS,
        Sse::new(stream).keep_alive(KeepAlive::default()),
    ))
}
