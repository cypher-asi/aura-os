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
use aura_os_harness::{
    HarnessInbound, HarnessOutbound, HarnessSession, SessionConfig, UserMessage,
};

use crate::handlers::agents::chat::errors::map_harness_error_to_api;
use crate::handlers::plan_mode::{
    append_plan_mode_suffix, plan_mode_tool_hints, plan_mode_tool_permissions,
    wrap_user_content_for_plan_mode,
};

use super::super::projects_helpers::{project_tool_deadline, project_tool_session_config};
use super::{load_generated_specs, resolve_harness_mode, specs_changed_since, SpecQueryParams};
use crate::error::{ApiError, ApiResult};
use crate::state::{AppState, AuthJwt, AuthSession};

const SSE_NO_BUFFERING_HEADERS: [(&str, HeaderValue); 1] =
    [("X-Accel-Buffering", HeaderValue::from_static("no"))];

/// Apply the shared plan-mode policy to a `SessionConfig` built by
/// [`project_tool_session_config`]: append the plan-mode rules to the
/// system prompt and stamp the hard-disabled tool list onto
/// `tool_permissions`. Used by both `generate_specs` and
/// `generate_specs_summary` so the dedicated `/specs/generate*`
/// endpoints stay in lock-step with chat plan mode.
fn apply_plan_mode_policy(mut config: SessionConfig) -> SessionConfig {
    let base_prompt = config.system_prompt.unwrap_or_default();
    config.system_prompt = Some(append_plan_mode_suffix(&base_prompt));
    config.tool_permissions = Some(plan_mode_tool_permissions());
    config
}

// Note: the previous `spec_generation_tool_hints()` helper has been
// inlined into the shared `crate::handlers::plan_mode::plan_mode_tool_hints`
// so chat plan mode, public-chat plan mode, and the dedicated
// `/specs/generate*` endpoints all advertise the same tool surface.

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
    // Spec summary regeneration is the same surface as plan mode: reuse
    // the shared system-prompt + tool-permission policy so a future
    // change to the plan-mode rules only has to land in one place.
    let session_config = apply_plan_mode_policy(session_config);
    let session = harness.open_session(session_config).await.map_err(|e| {
        map_harness_error_to_api(&e, state.harness_ws_slots, |err| {
            ApiError::internal(format!("opening spec summary session: {err}"))
        })
    })?;

    session
        .commands_tx
        .try_send(HarnessInbound::UserMessage(UserMessage {
            content: wrap_user_content_for_plan_mode(&format!(
                "Generate specs summary for project {project_id}"
            )),
            tool_hints: Some(plan_mode_tool_hints()),
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
    // The dedicated `/specs/generate*` endpoints and chat plan mode
    // share their system-prompt suffix + tool-permission policy via
    // `apply_plan_mode_policy`. The per-turn user-message content is
    // still tailored here so the model is told *which* project to
    // generate specs for and that it must not stop until the specs are
    // created (an instruction that is too noisy to live in the shared
    // suffix but is essential for this non-interactive flow).
    let session_config = apply_plan_mode_policy(session_config);
    let session = harness.open_session(session_config).await.map_err(|e| {
        map_harness_error_to_api(&e, state.harness_ws_slots, |err| {
            ApiError::internal(format!("opening spec gen session: {err}"))
        })
    })?;

    let spec_gen_instruction = format!(
        "Generate specs for project {project_id}. Inspect the project first, then create one or more concrete specs using the available project spec tools. Do not stop until the specs have been created."
    );

    session
        .commands_tx
        .try_send(HarnessInbound::UserMessage(UserMessage {
            content: wrap_user_content_for_plan_mode(&spec_gen_instruction),
            tool_hints: Some(plan_mode_tool_hints()),
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

#[cfg(test)]
mod tests {
    use super::apply_plan_mode_policy;
    use crate::handlers::plan_mode::{plan_mode_tool_hints, PLAN_MODE_SYSTEM_PROMPT_SUFFIX};
    use aura_os_harness::SessionConfig;
    use aura_protocol::ToolStateWire;

    #[test]
    fn spec_generation_tool_hints_scope_project_spec_surface() {
        // The /specs/generate endpoints now route their hints through
        // the shared `plan_mode_tool_hints` so the wire payload stays
        // identical to chat plan mode. This regression guard fails if
        // someone narrows or widens the shared list without touching
        // the dedicated endpoint at the same time.
        let hints = plan_mode_tool_hints();

        assert!(hints.contains(&"read_file".to_string()));
        assert!(hints.contains(&"create_spec".to_string()));
        assert!(
            hints.contains(&"create_task".to_string()),
            "plan mode now advertises task organization; spec-gen must inherit it",
        );
        assert!(hints.contains(&"update_task".to_string()));
        assert!(hints.contains(&"delete_task".to_string()));
        assert!(hints.contains(&"transition_task".to_string()));
        assert!(!hints.contains(&"run_command".to_string()));
        assert!(!hints.contains(&"run_task".to_string()));
    }

    #[test]
    fn apply_plan_mode_policy_suffixes_prompt_and_stamps_tool_permissions() {
        let mut config = SessionConfig {
            system_prompt: Some("base prompt".to_string()),
            ..Default::default()
        };
        config = apply_plan_mode_policy(config);
        let prompt = config.system_prompt.expect("system prompt set");
        assert!(prompt.starts_with("base prompt"));
        assert!(prompt.ends_with(PLAN_MODE_SYSTEM_PROMPT_SUFFIX));

        let perms = config
            .tool_permissions
            .expect("plan mode must stamp tool_permissions");
        for forbidden in ["write_file", "edit_file", "run_command", "git_commit"] {
            assert_eq!(
                perms.per_tool.get(forbidden),
                Some(&ToolStateWire::Off),
                "spec generation must disable `{forbidden}` via the shared plan-mode policy",
            );
        }
    }
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
