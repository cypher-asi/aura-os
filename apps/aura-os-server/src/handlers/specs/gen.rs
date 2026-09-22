//! Spec generation flows: synchronous JSON, SSE-streamed, and the
//! "regenerate summary" entry point. All three share a single
//! [`open_spec_gen_session`] that opens a project tool session and
//! enqueues the generation prompt.

use std::convert::Infallible;

use axum::extract::{Path, Query, State};
use axum::http::HeaderValue;
use axum::response::sse::{Event, KeepAlive, Sse};
use axum::Json;
use tracing::info;

use aura_os_core::{AgentInstanceId, HarnessMode, ProjectId, Spec};
use aura_os_harness::{HarnessInbound, HarnessOutbound, SessionConfig, UserMessage};

use crate::live_streams::{StreamKind, StreamScope};

use crate::handlers::agents::chat::errors::map_harness_error_to_api;
use crate::handlers::plan_mode::{
    append_plan_mode_suffix, plan_mode_tool_hints, plan_mode_tool_permissions,
    wrap_user_content_for_plan_mode,
};

use super::super::projects_helpers::{project_tool_deadline, project_tool_session_config};
use super::{load_generated_specs, resolve_harness_mode, specs_changed_since, SpecQueryParams};
use crate::error::{ApiError, ApiResult};
use crate::state::{AppState, AuthJwt, AuthSession};

/// Apply the shared plan-mode policy to a `SessionConfig` built by
/// [`project_tool_session_config`]: append the plan-mode rules to the
/// system prompt and stamp the hard-disabled tool list onto
/// `tool_permissions`. Used by both `generate_specs` and
/// `generate_specs_summary` so the dedicated `/specs/generate*`
/// endpoints stay in lock-step with chat plan mode.
fn apply_plan_mode_policy(mut config: SessionConfig) -> SessionConfig {
    // Append the plan-mode suffix onto `agent_system_prompt` — the field
    // `build_runtime_request` actually forwards to the harness as
    // `<agent_system_prompt>`. The legacy `system_prompt` field this used
    // to mutate was dropped on the wire, so the plan-mode rules never
    // reached the spec-generation session.
    let base_prompt = config.agent_system_prompt.unwrap_or_default();
    config.agent_system_prompt = Some(append_plan_mode_suffix(&base_prompt));
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
    // The model has only read tools here — it produces the summary as
    // its final assistant *message text*, not via a tool call — so we
    // accumulate the latest assistant message and treat it as the
    // summary. `tool_use` stops mean another (tool-calling) turn is
    // coming, so we keep waiting for the model's final message.
    let summary_loop = async {
        let mut latest_text = String::new();
        let mut captured = String::new();
        while let Ok(event) = rx.recv().await {
            match event {
                HarnessOutbound::AssistantMessageStart(_) => latest_text.clear(),
                HarnessOutbound::TextDelta(delta) => latest_text.push_str(&delta.text),
                HarnessOutbound::AssistantMessageEnd(end) => {
                    if !latest_text.trim().is_empty() {
                        captured = latest_text.clone();
                    }
                    if end.stop_reason != "tool_use" {
                        return SpecSummaryOutcome::Completed(captured);
                    }
                }
                HarnessOutbound::Error(err) => {
                    return SpecSummaryOutcome::HarnessError(err.message);
                }
                _ => continue,
            }
        }
        SpecSummaryOutcome::StreamEnded(captured)
    };

    let summary = match tokio::time::timeout(deadline, summary_loop).await {
        Ok(SpecSummaryOutcome::Completed(text)) | Ok(SpecSummaryOutcome::StreamEnded(text)) => text,
        Ok(SpecSummaryOutcome::HarnessError(message)) => {
            return Err(ApiError::internal(message));
        }
        Err(_) => {
            // Wall-clock deadline exceeded — return the project as-is so
            // the JS client doesn't trip Node's default `headersTimeout`.
            tracing::warn!(
                project_id = %project_id,
                deadline_secs = deadline.as_secs(),
                "spec summary deadline exceeded; returning best-effort project"
            );
            String::new()
        }
    };

    let mut project = state
        .project_service
        .get_project_async(&project_id)
        .await
        .map_err(|_e| ApiError::not_found("project not found"))?;

    // `specs_summary` is a local-shadow-only field (it is not part of
    // the network project payload — see `network_project_to_core`), so
    // we persist the generated text by writing the merged project back
    // through `save_project_shadow`. Without this the harness produced a
    // summary that was never stored, and the client kept seeing "No
    // summary yet."
    let summary = summary.trim().to_string();
    if !summary.is_empty() {
        project.specs_summary = Some(summary);
        if let Err(e) = state.project_service.save_project_shadow(&project) {
            tracing::warn!(
                project_id = %project_id,
                error = %e,
                "failed to persist generated specs summary"
            );
        }
    }
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
        "Generate specs for project {project_id}. Inspect the repo first via `read_file`, \
         `list_files`, `find_files`, and `search_code` so you can name concrete files, modules, \
         and symbols in the spec body \u{2014} do not invent paths. Then create one or more \
         specs via `create_spec`. Each spec must follow the spec content contract from the \
         system prompt: `## Background / Context`, `## Goals`, `## Non-Goals`, `## Affected \
         Files & Modules`, `## Interfaces & Signatures` (current and proposed shape pasted \
         verbatim from the source when modifying existing code), `## Design / Approach`, \
         `## External References`, and `## Definition of Done`. Do not stop until the specs \
         have been created."
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
    Completed(String),
    HarnessError(String),
    StreamEnded(String),
}

pub(crate) async fn generate_specs_stream(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    AuthSession(session): AuthSession,
    Path(project_id): Path<ProjectId>,
    Query(params): Query<SpecQueryParams>,
) -> ApiResult<(
    [(&'static str, HeaderValue); 2],
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

    // Register the session with the live-stream registry so its
    // lifetime is owned there rather than by this SSE response. The
    // client can reconnect (or a reloaded tab can rediscover this run
    // via `GET /api/streams/active`) and reattach with `?since=<seq>`
    // without restarting generation. We serve the very same resumable
    // SSE body that `GET /api/streams/:id` would.
    let scope = spec_stream_scope(&session.user_id, &project_id, params.agent_instance_id);
    let live = state
        .live_streams
        .register(StreamKind::SpecGen, scope, harness_session);
    let attach_header = HeaderValue::from_str(&live.attach_id)
        .unwrap_or_else(|_| HeaderValue::from_static("invalid"));
    let stream = crate::handlers::streams::attach_sse(live, 0);

    Ok((
        [
            ("X-Accel-Buffering", HeaderValue::from_static("no")),
            ("X-Aura-Attach-Id", attach_header),
        ],
        Sse::new(stream).keep_alive(KeepAlive::default()),
    ))
}

/// Build the live-stream scope for a spec-generation run so the owning
/// user (and a project / agent-instance filter) can rediscover it via
/// `GET /api/streams/active`.
fn spec_stream_scope(
    user_id: &str,
    project_id: &ProjectId,
    agent_instance_id: Option<AgentInstanceId>,
) -> StreamScope {
    StreamScope {
        user_id: Some(user_id.to_string()),
        project_id: Some(project_id.to_string()),
        agent_id: None,
        agent_instance_id: agent_instance_id.map(|a| a.to_string()),
        session_id: None,
        parent_tool_use_id: None,
        child_run_id: None,
    }
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
            agent_system_prompt: Some("base prompt".to_string()),
            ..Default::default()
        };
        config = apply_plan_mode_policy(config);
        let prompt = config.agent_system_prompt.expect("system prompt set");
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
