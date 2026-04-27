//! Spec generation flows: synchronous JSON, SSE-streamed, and the
//! "regenerate summary" entry point. All three share a single
//! [`open_spec_gen_session`] that opens a project tool session and
//! enqueues the generation prompt.

use std::convert::Infallible;

use axum::extract::{Path, Query, State};
use axum::http::HeaderValue;
use axum::response::sse::{Event, KeepAlive, Sse};
use axum::Json;
use futures_util::stream;
use tokio::sync::broadcast;
use tracing::info;

use aura_os_core::{AgentInstanceId, HarnessMode, ProjectId, Spec};
use aura_os_harness::{HarnessInbound, HarnessOutbound, HarnessSession, UserMessage};

use crate::handlers::agents::chat::errors::map_harness_error_to_api;

use super::super::projects_helpers::{project_tool_deadline, project_tool_session_config};
use super::{load_generated_specs, resolve_harness_mode, specs_changed_since, SpecQueryParams};
use crate::error::{ApiError, ApiResult};
use crate::state::{AppState, AuthJwt, AuthSession};

const SSE_NO_BUFFERING_HEADERS: [(&str, HeaderValue); 1] =
    [("X-Accel-Buffering", HeaderValue::from_static("no"))];

pub(crate) async fn generate_specs_summary(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    AuthSession(session): AuthSession,
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
        Some(&session.user_id),
    )
    .await?;
    let session = harness.open_session(session_config).await.map_err(|e| {
        map_harness_error_to_api(&e, state.harness_ws_slots, |err| {
            ApiError::internal(format!("opening spec summary session: {err}"))
        })
    })?;

    session
        .commands_tx
        .try_send(HarnessInbound::UserMessage(UserMessage {
            content: format!("Generate specs summary for project {project_id}"),
            tool_hints: None,
            attachments: None,
        }))
        .map_err(|e| ApiError::internal(format!("sending spec summary command: {e}")))?;

    let mut rx = session.events_tx.subscribe();
    let deadline = project_tool_deadline();
    let summary_loop = async {
        while let Ok(event) = rx.recv().await {
            match event {
                HarnessOutbound::AssistantMessageEnd(_) => return SpecSummaryOutcome::Completed,
                HarnessOutbound::Error(err) => {
                    return SpecSummaryOutcome::HarnessError(err.message);
                }
                _ => continue,
            }
        }
        SpecSummaryOutcome::StreamEnded
    };

    match tokio::time::timeout(deadline, summary_loop).await {
        Ok(SpecSummaryOutcome::Completed) | Ok(SpecSummaryOutcome::StreamEnded) => {}
        Ok(SpecSummaryOutcome::HarnessError(message)) => {
            return Err(ApiError::internal(message));
        }
        Err(_) => {
            // Wall-clock deadline exceeded — the project may still have
            // a partial summary persisted, so return it instead of
            // letting the JS client trip Node's default `headersTimeout`.
            tracing::warn!(
                project_id = %project_id,
                deadline_secs = deadline.as_secs(),
                "spec summary deadline exceeded; returning best-effort project"
            );
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
    user_id: &str,
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
        Some(user_id),
    )
    .await?;
    let session = harness.open_session(session_config).await.map_err(|e| {
        map_harness_error_to_api(&e, state.harness_ws_slots, |err| {
            ApiError::internal(format!("opening spec gen session: {err}"))
        })
    })?;

    session
        .commands_tx
        .try_send(HarnessInbound::UserMessage(UserMessage {
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
    AuthSession(session): AuthSession,
    Path(project_id): Path<ProjectId>,
    Query(params): Query<SpecQueryParams>,
) -> ApiResult<Json<Vec<Spec>>> {
    info!(%project_id, "Spec generation requested");
    let mode = resolve_harness_mode(&state, &project_id, &params).await?;
    let baseline_specs = load_generated_specs(&state, &project_id, &jwt).await?;
    let session = open_spec_gen_session(
        &state,
        &project_id,
        mode,
        params.agent_instance_id,
        &jwt,
        &session.user_id,
    )
    .await?;
    let mut rx = session.events_tx.subscribe();
    let deadline = project_tool_deadline();
    let gen_loop = async {
        while let Ok(event) = rx.recv().await {
            match event {
                HarnessOutbound::AssistantMessageEnd(_) => return SpecGenOutcome::Completed,
                HarnessOutbound::Error(err) => return SpecGenOutcome::HarnessError(err.message),
                _ => continue,
            }
        }
        SpecGenOutcome::StreamEnded
    };

    match tokio::time::timeout(deadline, gen_loop).await {
        Ok(SpecGenOutcome::Completed) => {
            let mut specs = load_generated_specs(&state, &project_id, &jwt).await?;
            specs.sort_by_key(|s| s.order_index);
            info!(%project_id, count = specs.len(), "Spec generation completed");
            Ok(Json(specs))
        }
        Ok(SpecGenOutcome::HarnessError(message)) => {
            let specs = load_generated_specs(&state, &project_id, &jwt).await?;
            if specs_changed_since(&baseline_specs, &specs) {
                info!(
                    %project_id,
                    count = specs.len(),
                    error = %message,
                    "Spec generation returned newly stored specs despite harness error"
                );
                Ok(Json(specs))
            } else {
                Err(ApiError::internal(message))
            }
        }
        Ok(SpecGenOutcome::StreamEnded) => Err(ApiError::internal(
            "spec generation stream ended without result",
        )),
        Err(_) => {
            // Wall-clock deadline exceeded — surface any newly persisted
            // specs so partial progress isn't lost, otherwise return a
            // typed error before the JS client's default `headersTimeout`
            // turns this into the cryptic `fetch failed`.
            tracing::warn!(
                project_id = %project_id,
                deadline_secs = deadline.as_secs(),
                "spec generation deadline exceeded; returning best-effort spec list"
            );
            let mut specs = load_generated_specs(&state, &project_id, &jwt).await?;
            specs.sort_by_key(|s| s.order_index);
            if specs_changed_since(&baseline_specs, &specs) {
                Ok(Json(specs))
            } else {
                Err(ApiError::internal(format!(
                    "spec generation exceeded {}s deadline without producing specs",
                    deadline.as_secs()
                )))
            }
        }
    }
}

enum SpecGenOutcome {
    Completed,
    HarnessError(String),
    StreamEnded,
}

enum SpecSummaryOutcome {
    Completed,
    HarnessError(String),
    StreamEnded,
}

pub(crate) async fn generate_specs_stream(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    AuthSession(session): AuthSession,
    Path(project_id): Path<ProjectId>,
    Query(params): Query<SpecQueryParams>,
) -> ApiResult<(
    [(&'static str, HeaderValue); 1],
    Sse<impl futures_core::Stream<Item = Result<Event, Infallible>>>,
)> {
    info!(%project_id, "Streaming spec generation requested");
    let mode = resolve_harness_mode(&state, &project_id, &params).await?;
    let harness_session = open_spec_gen_session(
        &state,
        &project_id,
        mode,
        params.agent_instance_id,
        &jwt,
        &session.user_id,
    )
    .await?;

    let rx = harness_session.events_tx.subscribe();
    let stream = harness_specs_to_sse(harness_session, rx);

    Ok((
        SSE_NO_BUFFERING_HEADERS,
        Sse::new(stream).keep_alive(KeepAlive::default()),
    ))
}

/// SSE stream that owns the [`HarnessSession`] for its full lifetime.
///
/// The previous implementation built a [`tokio_stream::wrappers::BroadcastStream`]
/// from `session.events_tx.subscribe()` and immediately let `session` go out
/// of scope. Dropping `session` dropped its `commands_tx`, which made the
/// `aura-os-harness` WS bridge writer close the upstream WebSocket sink the
/// moment the SSE response was returned. The harness then tore the session
/// down right after `Skill permissions resolved`, before the agent loop had
/// produced anything, so callers (e.g. the SWE-bench driver) only ever saw
/// an instantly-closed stream.
///
/// Holding `HarnessSession` inside the [`stream::unfold`] state pins
/// `commands_tx` to the SSE response. The harness stays connected until the
/// stream ends — either because we observe a terminal event
/// ([`HarnessOutbound::AssistantMessageEnd`] / [`HarnessOutbound::Error`]) or
/// because the broadcast receiver is closed — at which point dropping the
/// state closes the upstream WS naturally.
fn harness_specs_to_sse(
    session: HarnessSession,
    rx: broadcast::Receiver<HarnessOutbound>,
) -> impl futures_core::Stream<Item = Result<Event, Infallible>> + Send {
    stream::unfold((session, rx, false), |(session, mut rx, done)| async move {
        if done {
            return None;
        }
        loop {
            match rx.recv().await {
                Ok(evt) => {
                    let terminal = matches!(
                        evt,
                        HarnessOutbound::AssistantMessageEnd(_) | HarnessOutbound::Error(_)
                    );
                    let event = super::super::sse::harness_event_to_sse(&evt);
                    return Some((event, (session, rx, terminal)));
                }
                Err(broadcast::error::RecvError::Lagged(_)) => continue,
                Err(broadcast::error::RecvError::Closed) => return None,
            }
        }
    })
}
