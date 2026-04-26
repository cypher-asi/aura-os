//! Spec generation flows: synchronous JSON, SSE-streamed, and the
//! "regenerate summary" entry point. All three share a single
//! [`open_spec_gen_session`] that opens a project tool session and
//! enqueues the generation prompt.

use std::convert::Infallible;

use axum::extract::{Path, Query, State};
use axum::http::HeaderValue;
use axum::response::sse::{Event, KeepAlive, Sse};
use axum::Json;
use tokio_stream::StreamExt;
use tracing::info;

use aura_os_core::{AgentInstanceId, HarnessMode, ProjectId, Spec};
use aura_os_harness::{HarnessInbound, HarnessOutbound, UserMessage};

use super::super::projects_helpers::project_tool_session_config;
use super::{load_generated_specs, resolve_harness_mode, specs_changed_since, SpecQueryParams};
use crate::error::{ApiError, ApiResult};
use crate::state::{AppState, AuthJwt};

const SSE_NO_BUFFERING_HEADERS: [(&str, HeaderValue); 1] =
    [("X-Accel-Buffering", HeaderValue::from_static("no"))];

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
            attachments: None,
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

async fn open_spec_gen_session(
    state: &AppState,
    project_id: &ProjectId,
    harness_mode: HarnessMode,
    agent_instance_id: Option<AgentInstanceId>,
    jwt: &str,
) -> ApiResult<aura_os_harness::HarnessSession> {
    super::super::billing::require_credits(state, jwt).await?;

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
                "Generate specs for project {project_id}. Inspect the project first, then create one or more concrete specs using the available project spec tools. \
                 Every spec MUST end with a `## Definition of Done` section listing the exact build, test, format, and lint commands that must pass before any task derived from the spec can be marked done, plus 3\u{2013}7 observable acceptance criteria. \
                 If you implement a type that is defined by an external spec or RFC, cite the authoritative source (URL or section number) in the spec itself — do not guess sizes, field layouts, or constants. \
                 Do not stop until the specs have been created."
            ),
            tool_hints: None,
            attachments: None,
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
        .map(|evt| super::super::sse::harness_event_to_sse(&evt));

    Ok((
        SSE_NO_BUFFERING_HEADERS,
        Sse::new(stream).keep_alive(KeepAlive::default()),
    ))
}
