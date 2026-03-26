use std::convert::Infallible;

use axum::extract::{Path, Query, State};
use axum::http::HeaderValue;
use axum::response::sse::{Event, KeepAlive, Sse};
use axum::Json;
use serde::Deserialize;
use tokio_stream::StreamExt;
use tracing::info;

use aura_os_core::{AgentInstanceId, HarnessMode, ProjectId, Spec, SpecId};
use aura_os_link::{HarnessInbound, HarnessOutbound, SessionConfig, UserMessage};

use crate::error::{ApiError, ApiResult};
use crate::state::AppState;

#[derive(Debug, Deserialize, Default)]
pub(crate) struct SpecQueryParams {
    pub agent_instance_id: Option<AgentInstanceId>,
}

async fn resolve_harness_mode(state: &AppState, project_id: &ProjectId, params: &SpecQueryParams) -> HarnessMode {
    if let Some(aiid) = params.agent_instance_id {
        state
            .agent_instance_service
            .get_instance(project_id, &aiid)
            .await
            .map(|inst| inst.harness_mode())
            .unwrap_or(HarnessMode::Local)
    } else {
        HarnessMode::Local
    }
}

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
    Query(params): Query<SpecQueryParams>,
) -> ApiResult<Json<aura_os_core::Project>> {
    info!(%project_id, "Specs summary regeneration requested");

    let mode = resolve_harness_mode(&state, &project_id, &params).await;
    let harness = state.harness_for(mode);
    let session = harness
        .open_session(SessionConfig {
            agent_id: Some(format!("spec-summary-{project_id}")),
            agent_name: Some("spec-summary".to_string()),
            ..Default::default()
        })
        .await
        .map_err(|e| ApiError::internal(format!("opening spec summary session: {e}")))?;

    session
        .commands_tx
        .send(HarnessInbound::UserMessage(UserMessage {
            content: format!("Generate specs summary for project {project_id}"),
        }))
        .map_err(|e| ApiError::internal(format!("sending spec summary command: {e}")))?;

    let mut rx = session.events_tx.subscribe();
    while let Ok(event) = rx.recv().await {
        match event {
            HarnessOutbound::AssistantMessageEnd(_) => break,
            HarnessOutbound::Error(err) => {
                return Err(ApiError::internal(err.message));
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

async fn open_spec_gen_session(
    state: &AppState,
    project_id: &ProjectId,
    harness_mode: HarnessMode,
) -> ApiResult<aura_os_link::HarnessSession> {
    super::billing::require_credits(state).await?;

    let harness = state.harness_for(harness_mode);
    let session = harness
        .open_session(SessionConfig {
            agent_id: Some(format!("spec-gen-{project_id}")),
            agent_name: Some("spec-gen".to_string()),
            ..Default::default()
        })
        .await
        .map_err(|e| ApiError::internal(format!("opening spec gen session: {e}")))?;

    session
        .commands_tx
        .send(HarnessInbound::UserMessage(UserMessage {
            content: format!("Generate specs for project {project_id}"),
        }))
        .map_err(|e| ApiError::internal(format!("sending spec gen command: {e}")))?;

    Ok(session)
}

pub(crate) async fn generate_specs(
    State(state): State<AppState>,
    Path(project_id): Path<ProjectId>,
    Query(params): Query<SpecQueryParams>,
) -> ApiResult<Json<Vec<Spec>>> {
    info!(%project_id, "Spec generation requested");
    let mode = resolve_harness_mode(&state, &project_id, &params).await;
    let session = open_spec_gen_session(&state, &project_id, mode).await?;
    let mut rx = session.events_tx.subscribe();

    while let Ok(event) = rx.recv().await {
        match event {
            HarnessOutbound::AssistantMessageEnd(_) => {
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
                info!(%project_id, count = specs.len(), "Spec generation completed");
                return Ok(Json(specs));
            }
            HarnessOutbound::Error(err) => {
                return Err(ApiError::internal(err.message));
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
    Query(params): Query<SpecQueryParams>,
) -> ApiResult<(
    [(&'static str, HeaderValue); 1],
    Sse<impl futures_core::Stream<Item = Result<Event, Infallible>>>,
)> {
    info!(%project_id, "Streaming spec generation requested");
    let mode = resolve_harness_mode(&state, &project_id, &params).await;
    let session = open_spec_gen_session(&state, &project_id, mode).await?;

    let stream = tokio_stream::wrappers::BroadcastStream::new(session.events_tx.subscribe())
        .filter_map(|r| r.ok())
        .map(|evt| super::sse::harness_event_to_sse(&evt));

    Ok((
        SSE_NO_BUFFERING_HEADERS,
        Sse::new(stream).keep_alive(KeepAlive::default()),
    ))
}
