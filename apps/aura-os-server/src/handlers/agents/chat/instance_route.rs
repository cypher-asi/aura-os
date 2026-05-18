//! `POST /v1/projects/:project_id/agents/:instance_id/chat/stream`
//! route. Runs an agent instance chat turn — refreshes permissions
//! from the parent template, builds the project-aware system prompt,
//! and hands off to the SSE driver.

use aura_os_core::{AgentInstanceId, AgentPermissions, OrgId, ProjectId, SessionId};
use aura_os_harness::SessionConfig;
use axum::extract::{Path, State};
use axum::Json;
use tracing::info;

use crate::dto::SendChatRequest;
use crate::error::{map_storage_error, ApiError, ApiResult};
use crate::handlers::billing::require_credits_for_auth_source;
use crate::handlers::plan_mode::{
    append_plan_mode_suffix, is_plan_mode_action, plan_mode_tool_permissions,
};
use crate::handlers::projects_helpers::{
    is_project_tool_action, project_tool_max_turns, resolve_agent_instance_workspace_path,
};
use crate::state::{AppState, AuthJwt};

use super::agent_route::parse_wire_session_id;
use super::busy::{reject_if_partition_busy, BusyScope};
use super::compaction::{
    append_project_state_to_system_prompt, load_project_state_snapshot,
    session_events_to_conversation_history,
};
use super::cross_agent_reply::read_cross_agent_depth;
use super::identity_preamble::build_identity_preamble;
use super::loaders::{
    load_current_session_events_for_instance, load_pinned_session_events_for_instance,
};
use super::persist::{
    build_chat_partition, try_pin_session, ChatPersistRequest, PinnedSessionOutcome,
};
use super::setup::{has_live_session, setup_project_chat_persistence};
use super::streaming::{open_harness_chat_stream, OpenChatStreamArgs};
use super::tools::{build_session_installed_tools, InstalledToolsCtx};
use super::types::SseResponse;

use super::super::runtime::session_model_overrides_with_cache;

/// Inbound header the chat client sets on every Phase 2 auto-retry
/// POST. Holds the retry attempt number as ASCII digits (1, 2, 3,
/// …); the server only checks for *presence* of a parseable
/// non-zero value to bump `client_auto_retry_streamdropped`. The
/// actual retry semantics (whether to retry, how long to back off)
/// stay client-side — this header is purely observability.
pub(super) const CLIENT_RETRY_HEADER: &str = "x-aura-client-retry";

/// Returns `true` if the request carries a parseable
/// `X-Aura-Client-Retry: <n>` header with `n >= 1`. Anything else —
/// missing header, blank string, non-ASCII bytes, non-numeric
/// payload, or `0` — is treated as "not a retry" and silently
/// ignored. Header parse failures must NEVER reject the request:
/// the counter is best-effort observability.
pub(super) fn header_indicates_client_retry(headers: &axum::http::HeaderMap) -> bool {
    let Some(value) = headers.get(CLIENT_RETRY_HEADER) else {
        return false;
    };
    let Ok(text) = value.to_str() else {
        return false;
    };
    text.trim().parse::<u64>().map(|n| n >= 1).unwrap_or(false)
}

pub(crate) async fn send_event_stream(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    crate::state::AuthSession(auth_session): crate::state::AuthSession,
    Path((project_id, agent_instance_id)): Path<(ProjectId, AgentInstanceId)>,
    headers: axum::http::HeaderMap,
    Json(body): Json<SendChatRequest>,
) -> ApiResult<SseResponse> {
    // Phase 5 observability (5.3): the chat client sets
    // `X-Aura-Client-Retry: <n>` on every auto-retry POST so the
    // server-side counter reflects the same close-reason the client
    // breadcrumb dispatcher emits. Header value MUST be ASCII digits;
    // anything else (missing, blank, non-numeric) is silently
    // ignored — the counter is best-effort observability, not
    // load-bearing for the request itself.
    if header_indicates_client_retry(&headers) {
        state
            .stability_metrics
            .inc_client_auto_retry_streamdropped();
    }

    let instance = state
        .agent_instance_service
        .get_instance(&project_id, &agent_instance_id)
        .await
        .map_err(|e| ApiError::internal(format!("looking up agent instance: {e}")))?;
    require_credits_for_auth_source(&state, &jwt, &instance.auth_source).await?;
    info!(%project_id, %agent_instance_id, action = ?body.action, "Message stream requested");

    reject_if_partition_busy(
        &state,
        &instance.agent_id,
        BusyScope::Instance {
            project_id: &project_id,
            agent_instance_id: &agent_instance_id,
        },
    )
    .await?;

    let force_new = body.new_session.unwrap_or(false);

    // Parse the wire `session_id` once at ingress so every downstream
    // consumer sees a typed [`SessionId`]; see
    // `agent_route::parse_wire_session_id` for the matching
    // helper. Empty strings normalise to "no pin"; non-UUIDs surface
    // a structured 400 immediately.
    let requested_session_id = parse_wire_session_id(body.session_id.as_deref())?;

    // Validate the caller-supplied pin (`SendChatRequest.session_id`)
    // against storage *before* opening the harness session. Surfacing
    // a structured 400 here is far less surprising than letting the
    // upstream resolve to a different session and write the user's
    // message into the wrong thread. `force_new` always wins.
    let pinned_session_id: Option<SessionId> = match (
        force_new,
        requested_session_id.as_ref(),
        &state.storage_client,
    ) {
        (true, _, _) | (_, None, _) | (_, _, None) => None,
        (false, Some(req), Some(storage)) => {
            match try_pin_session(
                storage.as_ref(),
                &jwt,
                &agent_instance_id.to_string(),
                Some(req),
            )
            .await
            {
                PinnedSessionOutcome::NotRequested => None,
                PinnedSessionOutcome::Matched(id) => Some(id),
                PinnedSessionOutcome::Mismatch { session_id } => {
                    return Err(ApiError::bad_request(format!(
                        "session_id `{session_id}` does not belong to agent instance `{agent_instance_id}`"
                    )));
                }
            }
        }
    };

    // Phase 3 cycle-depth read. Inbound POSTs from prior cross-agent
    // reply callbacks carry `X-Aura-Cross-Agent-Depth: <n>`; we
    // thread it onto `ChatPersistCtx` so `persist_task` can refuse
    // to spawn another reply once the chain crosses
    // `MAX_CROSS_AGENT_REPLY_DEPTH`. Missing / malformed headers
    // default to 0 — direct user chats and legacy harness builds
    // start at the "fresh chain" depth.
    let cross_agent_depth = read_cross_agent_depth(&headers);

    // Build the per-turn request once and reuse it across persist
    // resolution so the cross-agent reply fields
    // (originating_agent_id, cross_agent_depth, from_agent_id) and
    // the pin/force_new flags stay in lockstep. See
    // `persist::ChatPersistRequest` for the field-by-field rationale;
    // borrowed shape mirrors the existing `OpenChatStreamArgs`
    // pattern in `streaming.rs`.
    let persist_request = ChatPersistRequest {
        jwt: &jwt,
        force_new,
        pinned_session_id: pinned_session_id.as_ref(),
        originating_agent_id: body.originating_agent_id.as_deref(),
        cross_agent_depth,
        from_agent_id: body.from_agent_id.as_deref(),
    };

    let persist_outcome = setup_project_chat_persistence(
        &state,
        &project_id,
        &agent_instance_id,
        &persist_request,
    )
    .await;
    let (persist_ctx, fork_info) = match persist_outcome {
        Some((ctx, fork)) => (Some(ctx), fork),
        None => (None, None),
    };

    // Phase 1 of parallel-session-chats: two POSTs against the same
    // `(instance, model)` with different storage sessions need to
    // open distinct ChatSession entries (and take distinct turn
    // slots). `build_chat_partition` folds `persist_ctx.session_id`
    // into the third partition segment for us; see
    // `persist::build_chat_partition` for the parse-failure fallback.
    let partition_agent_id =
        build_chat_partition(&instance.agent_id, Some(&agent_instance_id), persist_ctx.as_ref());
    let session_key = partition_agent_id.clone();

    // Phase 3 auto-fork: with per-session keys the new fork session
    // lands on a brand-new `session_key` (the new storage session_id
    // changes the third partition segment) so the old `ChatSession`
    // entry is naturally orphaned and reaped on the usual
    // is_alive / dropped-channel path — no eviction needed. The
    // observability counter still fires because the "user
    // transparently rolled into the fresh session" semantic is
    // unchanged.
    if fork_info.is_some() {
        state.stability_metrics.inc_auto_fork_applied();
    }

    let (conversation_messages, project_state_snapshot) = load_history_and_project_state(
        &state,
        &session_key,
        &project_id,
        &agent_instance_id,
        &jwt,
        force_new,
        pinned_session_id.as_ref(),
    )
    .await?;

    let pid_str = project_id.to_string();
    let project_path =
        resolve_agent_instance_workspace_path(&state, &project_id, Some(agent_instance_id)).await;
    // Restore parity with the harness-side task-execution path
    // (`build_agent_preamble`): the chat hot path used to forward only
    // `instance.system_prompt`, silently dropping personality / role /
    // skills on every interactive turn. The identity preamble lands
    // FIRST — before the `<project_context>` block — so the LLM reads
    // "who am I" before "what project am I operating in", matching the
    // ordering `agentic_execution_system_prompt` uses.
    let identity_preamble = build_identity_preamble(
        &instance.name,
        &instance.role,
        &instance.personality,
        &instance.skills,
    );
    let project_block = build_project_system_prompt(
        &state,
        &project_id,
        &instance.system_prompt,
        project_path.as_deref(),
    );
    let system_prompt = format!("{identity_preamble}{project_block}");
    let system_prompt =
        append_project_state_to_system_prompt(&system_prompt, project_state_snapshot.as_deref());

    let model = pick_instance_model(&body, &instance);
    let effective_org_id = resolve_effective_org_id(&state, instance.org_id.as_ref(), &project_id);
    let org_integrations = fetch_org_integrations(&state, effective_org_id.as_ref(), &jwt).await;
    let normalized_instance_perms = normalize_instance_perms(&state, &instance, &pid_str).await;

    let installed_tools = build_session_installed_tools(
        &InstalledToolsCtx {
            state: &state,
            org_id: effective_org_id.as_ref(),
            jwt: &jwt,
            context: "instance_chat",
            agent_id: &agent_instance_id.to_string(),
            integrations: org_integrations.as_deref(),
        },
        &normalized_instance_perms,
    )
    .await?;
    let installed_integrations =
        installed_workspace_integrations(effective_org_id.as_ref(), org_integrations.as_deref());

    // Cap agentic steps for non-interactive tool flows like
    // `generate_specs` so a degenerate `list_specs` ↔ `create_spec`
    // loop returns within seconds instead of stalling for ~5 minutes
    // until Node's default `headersTimeout` trips and surfaces as the
    // opaque `TypeError: fetch failed` (see
    // `infra/evals/local-stack/.runtime/logs/harness.log` from the
    // 2026-04-27 SWE-bench `astropy__astropy-12907` repro). Real
    // interactive chat (`action == None | "chat" | "plan"`) stays
    // uncapped.
    let max_turns = is_project_tool_action(body.action.as_deref()).then(project_tool_max_turns);

    // Plan mode (spec-planning prompt unification): when the client
    // hits this surface with `action=generate_specs`, append the
    // shared plan-mode rules to the system prompt and hard-disable
    // the code-writing tools via `tool_permissions`. The cold-start
    // session sees the strict policy; warm sessions keep their
    // existing config but still get the per-turn preamble + tool_hints
    // applied inside `open_harness_chat_stream`. See
    // `crate::handlers::plan_mode` for the full contract.
    let is_plan_mode = is_plan_mode_action(body.action.as_deref());
    let system_prompt = if is_plan_mode {
        append_plan_mode_suffix(&system_prompt)
    } else {
        system_prompt
    };
    let tool_permissions = is_plan_mode.then(plan_mode_tool_permissions);

    let config = SessionConfig {
        system_prompt: Some(system_prompt),
        agent_id: Some(partition_agent_id),
        template_agent_id: Some(instance.agent_id.to_string()),
        user_id: Some(auth_session.user_id.clone()),
        agent_name: Some(instance.name.clone()),
        model: model.clone(),
        max_turns,
        token: Some(jwt),
        conversation_messages,
        project_id: Some(pid_str),
        project_path,
        aura_org_id: effective_org_id.as_ref().map(ToString::to_string),
        aura_session_id: persist_ctx.as_ref().map(|c| c.session_id.to_string()),
        provider_overrides: session_model_overrides_with_cache(
            model.as_deref(),
            Some(format!("instance:{agent_instance_id}")),
            Some("24h"),
        ),
        installed_tools,
        installed_integrations,
        agent_permissions: (&normalized_instance_perms).into(),
        intent_classifier: instance.intent_classifier.clone(),
        tool_permissions,
        ..Default::default()
    };

    open_harness_chat_stream(
        &state,
        OpenChatStreamArgs {
            session_key,
            harness_mode: instance.harness_mode(),
            session_config: config,
            user_content: body.content,
            requested_model: body.model,
            persist_ctx,
            attachments: body.attachments,
            commands: body.commands,
            fork_info,
            is_plan_mode,
        },
    )
    .await
}

async fn load_history_and_project_state(
    state: &AppState,
    session_key: &str,
    project_id: &ProjectId,
    agent_instance_id: &AgentInstanceId,
    jwt: &str,
    force_new: bool,
    pinned_session_id: Option<&SessionId>,
) -> ApiResult<(
    Option<Vec<aura_os_harness::ConversationMessage>>,
    Option<String>,
)> {
    if force_new {
        return Ok((None, None));
    }
    // After Phase 1 of parallel-session-chats the `session_key` itself
    // embeds the resolved storage session id, so "the partition has a
    // live harness session" is the same statement as "this storage
    // session has a warm harness session" — skipping the history
    // rebuild on a hit is safe by construction; we no longer need to
    // pre-evict on pin disagreement because a different storage
    // session resolves to a different `session_key` entirely.
    if has_live_session(state, session_key).await {
        return Ok((None, None));
    }
    // LLM context rebuild on cold start: load only the current storage
    // session, not the full multi-session aggregate. See
    // `load_current_session_events_for_instance` doc-comment for rationale.
    let stored = match pinned_session_id {
        Some(session_id) => {
            // Stringify once at this storage boundary; the loader
            // keeps `&str` to match the REST shape.
            let session_id_str = session_id.to_string();
            load_pinned_session_events_for_instance(
                state,
                agent_instance_id,
                jwt,
                &session_id_str,
                &project_id.to_string(),
            )
            .await
            .map_err(map_storage_error)?
        }
        None => load_current_session_events_for_instance(state, agent_instance_id, jwt)
            .await
            .map_err(map_storage_error)?,
    };
    let conversation_messages = if stored.is_empty() {
        None
    } else {
        Some(session_events_to_conversation_history(&stored))
    };
    let project_state_snapshot =
        load_project_state_snapshot(state, &project_id.to_string(), jwt).await;
    Ok((conversation_messages, project_state_snapshot))
}

fn pick_instance_model(
    body: &SendChatRequest,
    instance: &aura_os_core::AgentInstance,
) -> Option<String> {
    body.model
        .clone()
        .filter(|value| !value.trim().is_empty())
        .or_else(|| {
            instance
                .default_model
                .clone()
                .filter(|value| !value.trim().is_empty())
        })
}

fn resolve_effective_org_id(
    state: &AppState,
    preferred_org_id: Option<&OrgId>,
    project_id: &ProjectId,
) -> Option<OrgId> {
    preferred_org_id.cloned().or_else(|| {
        state
            .project_service
            .get_project(project_id)
            .ok()
            .map(|p| p.org_id)
    })
}

async fn fetch_org_integrations(
    state: &AppState,
    org_id: Option<&OrgId>,
    jwt: &str,
) -> Option<Vec<aura_os_core::OrgIntegration>> {
    match org_id {
        Some(org_id) => Some(
            crate::handlers::agents::workspace_tools::integrations_for_org_with_token(
                state,
                org_id,
                Some(jwt),
            )
            .await,
        ),
        None => None,
    }
}

/// Prefer the parent agent's *current* permissions bundle over the
/// instance-time snapshot so a toggle flip on the agent template's
/// `PermissionsTab` takes effect on the very next turn of every
/// project-bound chat. The snapshot in `instance.permissions` was
/// always documented as a "parent-lookup-failed" fallback — without
/// this lookup the instance session was the only place that silently
/// kept serving stale capabilities.
async fn normalize_instance_perms(
    state: &AppState,
    instance: &aura_os_core::AgentInstance,
    pid_str: &str,
) -> AgentPermissions {
    let fresh_parent_permissions = state
        .agent_service
        .get_agent_async("", &instance.agent_id)
        .await
        .or_else(|_| state.agent_service.get_agent_local(&instance.agent_id))
        .ok()
        .map(|parent| parent.permissions);
    let effective = fresh_parent_permissions.unwrap_or_else(|| instance.permissions.clone());
    effective
        .normalized_for_identity(&instance.name, Some(instance.role.as_str()))
        .with_project_self_caps(pid_str)
}

fn installed_workspace_integrations(
    org_id: Option<&OrgId>,
    org_integrations: Option<&[aura_os_core::OrgIntegration]>,
) -> Option<Vec<aura_os_harness::InstalledIntegration>> {
    match (org_id, org_integrations) {
        (Some(_), Some(ints)) => {
            let installed =
                crate::handlers::agents::workspace_tools::installed_workspace_integrations_with_integrations(
                    ints,
                );
            (!installed.is_empty()).then_some(installed)
        }
        _ => None,
    }
}

pub(crate) fn build_project_system_prompt(
    state: &AppState,
    project_id: &ProjectId,
    agent_prompt: &str,
    workspace_path: Option<&str>,
) -> String {
    let project_ctx = match state.project_service.get_project(project_id) {
        Ok(p) => render_project_context(project_id, &p.name, &p.description, workspace_path),
        Err(_) => render_project_context_fallback(project_id),
    };
    format!("{}{}", project_ctx, agent_prompt)
}

pub(crate) fn render_project_context(
    project_id: &ProjectId,
    name: &str,
    description: &str,
    workspace_path: Option<&str>,
) -> String {
    let mut ctx = format!(
        "<project_context>\nproject_id: {}\nproject_name: {}\n",
        project_id, name,
    );
    if !description.is_empty() {
        ctx.push_str(&format!("description: {}\n", description));
    }
    if let Some(workspace_path) = workspace_path.filter(|path| !path.is_empty()) {
        ctx.push_str(&format!("workspace: {}\n", workspace_path));
    }
    ctx.push_str("</project_context>\n\n");
    ctx.push_str("IMPORTANT: When calling tools that accept a project_id parameter, always use the project_id from the project_context above.\n\n");
    ctx.push_str(
        "IMPORTANT: For filesystem and command tools, treat the project root as `.` and always use paths relative to that root. \
         Never pass `/` or any other absolute host path to list_files, find_files, read_file, write_file, or run_command.\n\n",
    );
    ctx.push_str(
        "IMPORTANT: When creating or updating specs, put the markdown only in the `markdown_contents` tool argument and keep visible assistant text to a short preview. \
         Create large or multi-phase plans as multiple focused specs, one `create_spec` call at a time, instead of one huge markdown payload.\n\n",
    );
    ctx
}

#[cfg(test)]
mod client_retry_header_tests {
    use super::header_indicates_client_retry;
    use axum::http::HeaderMap;

    /// Pin the parsing rules for `X-Aura-Client-Retry`: any positive
    /// integer counts as a retry, blank / zero / non-numeric /
    /// missing values do not. The chat client always sends the
    /// attempt number (1+) on retries, so the threshold is "any
    /// positive integer". Header parse failures must never reject
    /// the request — the counter is best-effort observability.
    #[test]
    fn header_indicates_client_retry_only_for_positive_integers() {
        let mut headers = HeaderMap::new();
        assert!(
            !header_indicates_client_retry(&headers),
            "missing header must not bump the counter"
        );

        headers.insert("x-aura-client-retry", "1".parse().unwrap());
        assert!(header_indicates_client_retry(&headers));

        headers.insert("x-aura-client-retry", "  3  ".parse().unwrap());
        assert!(
            header_indicates_client_retry(&headers),
            "leading/trailing whitespace must be tolerated"
        );

        headers.insert("x-aura-client-retry", "0".parse().unwrap());
        assert!(
            !header_indicates_client_retry(&headers),
            "explicit 0 must not bump - only retries (>=1) count"
        );

        headers.insert("x-aura-client-retry", "abc".parse().unwrap());
        assert!(
            !header_indicates_client_retry(&headers),
            "non-numeric values must be silently ignored"
        );
    }
}

pub(crate) fn render_project_context_fallback(project_id: &ProjectId) -> String {
    format!(
        "<project_context>\nproject_id: {}\n</project_context>\n\n\
         IMPORTANT: When calling tools that accept a project_id parameter, always use the project_id above.\n\n\
         IMPORTANT: For filesystem and command tools, treat the project root as `.` and always use relative paths. Never pass `/` or any other absolute host path.\n\n\
         IMPORTANT: When creating or updating specs, put the markdown only in the `markdown_contents` tool argument and keep visible assistant text to a short preview. Create large or multi-phase plans as multiple focused specs, one `create_spec` call at a time, instead of one huge markdown payload.\n\n",
        project_id,
    )
}
