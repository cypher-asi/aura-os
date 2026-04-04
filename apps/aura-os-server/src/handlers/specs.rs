use std::collections::HashMap;
use std::convert::Infallible;

use axum::extract::{Path, Query, State};
use axum::http::HeaderValue;
use axum::response::sse::{Event, KeepAlive, Sse};
use axum::Json;
use serde::Deserialize;
use std::time::Duration;
use tokio_stream::StreamExt;
use tracing::info;

use aura_os_core::{AgentInstanceId, HarnessMode, ProjectId, Spec, SpecId};
use aura_os_link::{HarnessInbound, HarnessOutbound, UserMessage};

use super::projects_helpers::project_tool_session_config;
use crate::error::{ApiError, ApiResult};
use crate::state::{AppState, AuthJwt};

const SPEC_RESULT_POLL_INTERVAL: Duration = Duration::from_millis(250);
const SPEC_RESULT_POLL_TIMEOUT: Duration = Duration::from_secs(5);

async fn load_generated_specs(
    state: &AppState,
    project_id: &ProjectId,
    jwt: &str,
) -> ApiResult<Vec<Spec>> {
    let storage = state.require_storage_client()?;
    let started_at = tokio::time::Instant::now();
    let mut specs: Vec<Spec> = loop {
        let storage_specs = storage
            .list_specs(&project_id.to_string(), jwt)
            .await
            .map_err(|e| ApiError::internal(format!("listing specs: {e}")))?;
        let specs: Vec<Spec> = storage_specs
            .into_iter()
            .filter_map(|s| Spec::try_from(s).ok())
            .collect();
        if !specs.is_empty() || started_at.elapsed() >= SPEC_RESULT_POLL_TIMEOUT {
            break specs;
        }
        tokio::time::sleep(SPEC_RESULT_POLL_INTERVAL).await;
    };
    specs.sort_by_key(|s| s.order_index);
    Ok(specs)
}

fn specs_changed_since(before: &[Spec], after: &[Spec]) -> bool {
    if before.len() != after.len() {
        return true;
    }

    let before_versions: HashMap<_, _> = before
        .iter()
        .map(|spec| (spec.spec_id, spec.updated_at))
        .collect();

    after.iter().any(|spec| {
        before_versions
            .get(&spec.spec_id)
            .is_none_or(|updated_at| *updated_at != spec.updated_at)
    })
}

#[derive(Debug, Deserialize, Default)]
pub(crate) struct SpecQueryParams {
    pub agent_instance_id: Option<AgentInstanceId>,
}

async fn resolve_harness_mode(
    state: &AppState,
    project_id: &ProjectId,
    params: &SpecQueryParams,
) -> ApiResult<HarnessMode> {
    if let Some(aiid) = params.agent_instance_id {
        let instance = state
            .agent_instance_service
            .get_instance(project_id, &aiid)
            .await
            .map_err(|e| match e {
                aura_os_agents::AgentError::NotFound => {
                    ApiError::not_found(format!("agent instance {aiid} not found"))
                }
                other => ApiError::internal(format!("looking up agent instance {aiid}: {other}")),
            })?;
        Ok(instance.harness_mode())
    } else {
        Ok(HarnessMode::Local)
    }
}

pub(crate) async fn list_specs(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    Path(project_id): Path<ProjectId>,
) -> ApiResult<Json<Vec<Spec>>> {
    let storage = state.require_storage_client()?;
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

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CreateSpecBody {
    pub title: String,
    #[serde(alias = "markdown_contents")]
    pub markdown_contents: Option<String>,
    #[serde(alias = "order_index")]
    pub order_index: Option<i32>,
}

pub(crate) async fn create_spec(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    Path(project_id): Path<ProjectId>,
    Json(req): Json<CreateSpecBody>,
) -> ApiResult<Json<Spec>> {
    let storage = state.require_storage_client()?;
    let created = storage
        .create_spec(
            &project_id.to_string(),
            &jwt,
            &aura_os_storage::CreateSpecRequest {
                title: req.title,
                org_id: None,
                order_index: req.order_index,
                markdown_contents: req.markdown_contents,
            },
        )
        .await
        .map_err(|e| ApiError::internal(format!("creating spec: {e}")))?;
    let spec = Spec::try_from(created).map_err(ApiError::internal)?;
    Ok(Json(spec))
}

pub(crate) async fn generate_specs_summary(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    Path(project_id): Path<ProjectId>,
    Query(params): Query<SpecQueryParams>,
) -> ApiResult<Json<aura_os_core::Project>> {
    info!(%project_id, "Specs summary regeneration requested");

    let mode = resolve_harness_mode(&state, &project_id, &params).await?;
    let harness = state.harness_for(mode);
    let session_config = project_tool_session_config(
        &state,
        &project_id,
        "spec-summary",
        mode,
        params.agent_instance_id,
        &jwt,
    )
    .await;
    let session = harness
        .open_session(session_config)
        .await
        .map_err(|e| ApiError::internal(format!("opening spec summary session: {e}")))?;

    session
        .commands_tx
        .send(HarnessInbound::UserMessage(UserMessage {
            content: format!("Generate specs summary for project {project_id}"),
            tool_hints: None,
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
    AuthJwt(jwt): AuthJwt,
    Path((_project_id, spec_id)): Path<(ProjectId, SpecId)>,
) -> ApiResult<Json<Spec>> {
    let storage = state.require_storage_client()?;
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

#[derive(Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub(crate) struct UpdateSpecBody {
    pub title: Option<String>,
    #[serde(alias = "order_index")]
    pub order_index: Option<i32>,
    #[serde(alias = "markdown_contents")]
    pub markdown_contents: Option<String>,
}

pub(crate) async fn update_spec(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    Path((_project_id, spec_id)): Path<(ProjectId, SpecId)>,
    Json(req): Json<UpdateSpecBody>,
) -> ApiResult<Json<Spec>> {
    let storage = state.require_storage_client()?;
    storage
        .update_spec(
            &spec_id.to_string(),
            &jwt,
            &aura_os_storage::types::UpdateSpecRequest {
                title: req.title,
                order_index: req.order_index,
                markdown_contents: req.markdown_contents,
            },
        )
        .await
        .map_err(|e| match &e {
            aura_os_storage::StorageError::Server { status: 404, .. } => {
                ApiError::not_found("spec not found")
            }
            aura_os_storage::StorageError::Server { status: 400, body } => {
                ApiError::bad_request(body.clone())
            }
            _ => ApiError::internal(format!("updating spec: {e}")),
        })?;

    let storage_spec =
        storage
            .get_spec(&spec_id.to_string(), &jwt)
            .await
            .map_err(|e| match &e {
                aura_os_storage::StorageError::Server { status: 404, .. } => {
                    ApiError::not_found("spec not found")
                }
                _ => ApiError::internal(format!("fetching updated spec: {e}")),
            })?;
    let spec = Spec::try_from(storage_spec).map_err(ApiError::internal)?;
    Ok(Json(spec))
}

pub(crate) async fn delete_spec(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    Path((_project_id, spec_id)): Path<(ProjectId, SpecId)>,
) -> ApiResult<axum::http::StatusCode> {
    let storage = state.require_storage_client()?;
    storage
        .delete_spec(&spec_id.to_string(), &jwt)
        .await
        .map_err(|e| match &e {
            aura_os_storage::StorageError::Server { status: 404, .. } => {
                ApiError::not_found("spec not found")
            }
            _ => ApiError::internal(format!("deleting spec: {e}")),
        })?;
    Ok(axum::http::StatusCode::NO_CONTENT)
}

const SSE_NO_BUFFERING_HEADERS: [(&str, HeaderValue); 1] =
    [("X-Accel-Buffering", HeaderValue::from_static("no"))];

async fn open_spec_gen_session(
    state: &AppState,
    project_id: &ProjectId,
    harness_mode: HarnessMode,
    agent_instance_id: Option<AgentInstanceId>,
    jwt: &str,
) -> ApiResult<aura_os_link::HarnessSession> {
    super::billing::require_credits(state, jwt).await?;

    let harness = state.harness_for(harness_mode);
    let session_config = project_tool_session_config(
        state,
        project_id,
        "spec-gen",
        harness_mode,
        agent_instance_id,
        jwt,
    )
    .await;
    let session = harness
        .open_session(session_config)
        .await
        .map_err(|e| ApiError::internal(format!("opening spec gen session: {e}")))?;

    session
        .commands_tx
        .send(HarnessInbound::UserMessage(UserMessage {
            content: format!(
                "Generate specs for project {project_id}. Inspect the project first, then create one or more concrete specs using the available project spec tools. Do not stop until the specs have been created."
            ),
            tool_hints: None,
        }))
        .map_err(|e| ApiError::internal(format!("sending spec gen command: {e}")))?;

    Ok(session)
}

pub(crate) async fn generate_specs(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    Path(project_id): Path<ProjectId>,
    Query(params): Query<SpecQueryParams>,
) -> ApiResult<Json<Vec<Spec>>> {
    info!(%project_id, "Spec generation requested");
    let mode = resolve_harness_mode(&state, &project_id, &params).await?;
    let baseline_specs = load_generated_specs(&state, &project_id, &jwt).await?;
    let session =
        open_spec_gen_session(&state, &project_id, mode, params.agent_instance_id, &jwt).await?;
    let mut rx = session.events_tx.subscribe();

    while let Ok(event) = rx.recv().await {
        match event {
            HarnessOutbound::AssistantMessageEnd(_) => {
                let mut specs = load_generated_specs(&state, &project_id, &jwt).await?;
                specs.sort_by_key(|s| s.order_index);
                info!(%project_id, count = specs.len(), "Spec generation completed");
                return Ok(Json(specs));
            }
            HarnessOutbound::Error(err) => {
                let specs = load_generated_specs(&state, &project_id, &jwt).await?;
                if specs_changed_since(&baseline_specs, &specs) {
                    info!(
                        %project_id,
                        count = specs.len(),
                        error = %err.message,
                        "Spec generation returned newly stored specs despite harness error"
                    );
                    return Ok(Json(specs));
                }
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
    AuthJwt(jwt): AuthJwt,
    Path(project_id): Path<ProjectId>,
    Query(params): Query<SpecQueryParams>,
) -> ApiResult<(
    [(&'static str, HeaderValue); 1],
    Sse<impl futures_core::Stream<Item = Result<Event, Infallible>>>,
)> {
    info!(%project_id, "Streaming spec generation requested");
    let mode = resolve_harness_mode(&state, &project_id, &params).await?;
    let session =
        open_spec_gen_session(&state, &project_id, mode, params.agent_instance_id, &jwt).await?;

    let stream = tokio_stream::wrappers::BroadcastStream::new(session.events_tx.subscribe())
        .filter_map(|r| r.ok())
        .map(|evt| super::sse::harness_event_to_sse(&evt));

    Ok((
        SSE_NO_BUFFERING_HEADERS,
        Sse::new(stream).keep_alive(KeepAlive::default()),
    ))
}
