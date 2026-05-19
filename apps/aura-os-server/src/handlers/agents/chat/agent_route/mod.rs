//! `POST /v1/agents/:agent_id/chat/stream` route. Resolves the target agent, prepares the harness `SessionConfig`, kicks off persistence, and hands off to the SSE driver.

use aura_os_core::ProjectId;
use aura_os_harness::SessionConfig;
use axum::extract::{Path, State};
use axum::Json;
use tracing::info;

use crate::dto::SendChatRequest;
use crate::error::{ApiError, ApiResult};
use crate::handlers::billing::require_credits_for_auth_source;
use crate::handlers::plan_mode::{
    append_plan_mode_suffix, is_plan_mode_action, plan_mode_tool_permissions,
};
use crate::handlers::projects_helpers::{is_project_tool_action, project_tool_max_turns};
use crate::state::{AppState, AuthJwt};

use super::busy::{reject_if_partition_busy, BusyScope};
use super::cross_agent_reply::read_cross_agent_depth;
use super::persist::{build_chat_partition, ChatPersistRequest};
use super::setup::has_live_session;
use super::streaming::{open_harness_chat_stream, OpenChatStreamArgs};
use super::tools::{build_session_installed_tools, InstalledToolsCtx};
use super::types::SseResponse;

use super::super::runtime::{effective_model, session_model_overrides_with_cache};

mod helpers;
mod persistence;
mod prompt;
mod resolve;

use helpers::{
    fetch_org_integrations, installed_workspace_integrations, resolve_effective_org_id,
    resolve_effective_project_id,
};
use persistence::{
    load_history_for_agent, load_persistence_only, log_history_size, log_persistence_status,
    LoadAgentHistoryCtx,
};
use prompt::{build_agent_system_prompt, load_project_state_for_agent, normalize_agent_perms};
use resolve::{resolve_agent_for_chat, resolve_pinned_session_for_agent};

pub(crate) use resolve::parse_wire_session_id;

pub(crate) async fn send_agent_event_stream(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    crate::state::AuthSession(auth_session): crate::state::AuthSession,
    Path(agent_id): Path<aura_os_core::AgentId>,
    headers: axum::http::HeaderMap,
    Json(body): Json<SendChatRequest>,
) -> ApiResult<SseResponse> {
    // Phase 5 observability (5.3): the chat client sets
    // `X-Aura-Client-Retry: <n>` on every Phase 2 auto-retry POST.
    // Mirror the instance route's header parser so the same metric
    // bumps regardless of which chat endpoint the client hit.
    if super::instance_route::header_indicates_client_retry(&headers) {
        state
            .stability_metrics
            .inc_client_auto_retry_streamdropped();
    }

    let agent = resolve_agent_for_chat(&state, &agent_id, &jwt).await?;
    require_credits_for_auth_source(&state, &jwt, &agent.auth_source).await?;
    info!(%agent_id, action = ?body.action, "Agent message stream requested");

    if agent.adapter_type != "aura_harness" {
        return Err(ApiError::bad_request(format!(
            "adapter `{}` is no longer supported; only `aura_harness` agents can be chatted with",
            agent.adapter_type
        )));
    }

    // Phase 4: narrow the bare-agent guard. The legacy `None` branch
    // scanned EVERY instance of the template and rejected chat when
    // ANY was busy — but the bare-agent harness partition
    // `{template}::default` never collides with any automaton's
    // `{template}::{instance_uuid}` partition, so a loop on a sibling
    // instance has no harness-level reason to block bare-agent chat.
    //
    // When the chat request carries a `project_id`, scope the scan
    // to that project so an automaton in the same project on the
    // same template still blocks (matching the instance-route
    // semantics). Otherwise treat the bare-agent partition as
    // never-busy and rely on the harness's `turn_in_progress`
    // (Phase 2 SSE-remapped to `agent_busy`) for the rare collision
    // the narrowed guard misses.
    let bare_agent_project_scope = body
        .project_id
        .as_deref()
        .filter(|pid| !pid.is_empty())
        .and_then(|pid| pid.parse::<ProjectId>().ok());
    let busy_scope = match bare_agent_project_scope.as_ref() {
        Some(pid) => BusyScope::TemplateInProject { project_id: pid },
        None => BusyScope::Unscoped,
    };
    reject_if_partition_busy(&state, &agent_id, busy_scope).await?;

    let force_new = body.new_session.unwrap_or(false);

    // Parse the wire `session_id` once at ingress so every downstream
    // consumer sees a typed [`SessionId`]. A non-UUID at this surface
    // is a client bug (the chat UI mints UUIDs everywhere); surfacing
    // the structured 400 here is friendlier than letting it tunnel
    // through and 400 on mismatch a few layers deeper. Empty strings
    // are normalised to "no pin" so a stale `?session=` placeholder
    // doesn't trip the parser.
    let requested_session_id = parse_wire_session_id(body.session_id.as_deref())?;

    // Validate the caller-supplied pin (`SendChatRequest.session_id`)
    // against the agent's project bindings before we wire anything
    // up. Mismatches surface as a structured 400 — see the instance
    // route for the parallel rationale. `force_new` always wins.
    let pinned_session_id = if force_new {
        None
    } else {
        resolve_pinned_session_for_agent(&state, &agent_id, &jwt, requested_session_id.as_ref())
            .await?
    };

    // Phase 3 cycle-depth read. Inbound POSTs from prior cross-agent
    // reply callbacks carry `X-Aura-Cross-Agent-Depth: <n>`; we
    // thread it onto `ChatPersistCtx` so `persist_task` can refuse
    // to spawn another reply once the chain crosses
    // `MAX_CROSS_AGENT_REPLY_DEPTH`. Missing / malformed headers
    // default to 0 — direct user chats and legacy harness builds
    // start at the "fresh chain" depth.
    let cross_agent_depth = read_cross_agent_depth(&headers);

    // Build the per-turn request once and reuse it across the
    // persist resolution + history loader so the cross-agent reply
    // fields (originating_agent_id, cross_agent_depth, from_agent_id)
    // and the pin/force_new flags stay in lockstep at every call
    // site. See `persist::ChatPersistRequest` for the field-by-field
    // rationale; the borrowed shape mirrors the existing
    // `OpenChatStreamArgs` pattern in `streaming.rs`.
    let persist_request = ChatPersistRequest {
        jwt: &jwt,
        force_new,
        pinned_session_id: pinned_session_id.as_ref(),
        originating_agent_id: body.originating_agent_id.as_deref(),
        cross_agent_depth,
        from_agent_id: body.from_agent_id.as_deref(),
    };

    // Mirror the instance-route shape: resolve persist first, then
    // build the per-session partition string via `build_chat_partition`,
    // then check `has_live_session` against the real `session_key` so
    // the cold-vs-warm decision uses the same key the registry stores
    // under. This loses the cold-start `tokio::join` between persist
    // and history-load that the pre-Phase-1 code had — same tradeoff
    // `instance_route::load_history_and_project_state` already
    // accepts — but in exchange we restore the warm-session
    // history-rebuild skip that Phase 1's `live_session = false`
    // workaround disabled.
    let (persist_ctx, fork_info, matching) =
        load_persistence_only(&state, &agent_id, &persist_request).await;

    log_persistence_status(&agent_id, persist_ctx.is_some());

    let partition_agent_id = build_chat_partition(&agent_id, None, persist_ctx.as_ref());
    let session_key = partition_agent_id.clone();

    let live_session = has_live_session(&state, &session_key).await;

    let history_ctx = LoadAgentHistoryCtx {
        session_key: &session_key,
        jwt: &jwt,
        force_new,
        live_session,
        pinned_session_id: pinned_session_id.as_ref(),
        matching: &matching,
    };
    let conversation_messages = load_history_for_agent(&state, &agent_id, &history_ctx).await;

    log_history_size(&agent_id, conversation_messages.as_deref());

    // Phase 3 auto-fork: with per-session keys we no longer evict the
    // old `ChatSession` entry on fork — the fresh session lands on a
    // brand-new `session_key` (the new storage session_id changes the
    // third partition segment) and naturally has its own registry
    // entry. The old entry is orphaned and reaped on the usual
    // is_alive / dropped-channel path. The observability counter
    // still fires because the "user transparently rolled into the
    // fresh session" semantic is unchanged.
    if fork_info.is_some() {
        state.stability_metrics.inc_auto_fork_applied();
    }

    let project_state_snapshot =
        load_project_state_for_agent(&state, &body, &persist_ctx, &jwt, force_new, live_session)
            .await;

    let effective_project_id = resolve_effective_project_id(&body, &persist_ctx);
    let effective_org_id = resolve_effective_org_id(
        &state,
        agent.org_id.as_ref(),
        effective_project_id.as_deref(),
    );
    let model = effective_model(&agent, body.model.clone());
    let org_integrations = fetch_org_integrations(&state, effective_org_id.as_ref(), &jwt).await;
    let normalized_perms = normalize_agent_perms(&agent, effective_project_id.as_deref());

    let installed_tools = build_session_installed_tools(
        &InstalledToolsCtx {
            state: &state,
            org_id: effective_org_id.as_ref(),
            jwt: &jwt,
            context: "agent_chat",
            agent_id: &agent_id.to_string(),
            integrations: org_integrations.as_deref(),
        },
        &normalized_perms,
    )
    .await?;
    let installed_integrations =
        installed_workspace_integrations(effective_org_id.as_ref(), org_integrations.as_deref());

    // Mirror the cap applied in `instance_route.rs::send_event_stream`:
    // tool-driven actions like `generate_specs` get bounded so a
    // runaway loop returns instead of stalling past Node's default
    // `headersTimeout`. Interactive chat stays uncapped.
    let max_turns = is_project_tool_action(body.action.as_deref()).then(project_tool_max_turns);

    // Plan-mode parity with the instance route: when the client hits
    // this surface with `action=generate_specs`, append the shared
    // plan-mode system-prompt rules and hard-disable the
    // code-writing tools. Warm sessions keep their existing config
    // but still see the per-turn preamble + tool_hints applied inside
    // `open_harness_chat_stream`. See `crate::handlers::plan_mode`.
    let is_plan_mode = is_plan_mode_action(body.action.as_deref());

    // Project-bound bare-agent chats need the same `<project_context>`
    // block + workspace path as the instance route so workspace tools
    // (`list_files`, `read_file`, `run_command`) resolve relative to
    // the right repo and the LLM sees the canonical project_id /
    // name / description in its system prompt. Without this, a
    // bare-agent chat targeting a project (e.g. the CEO agent's
    // `send_to_agent` flow) silently lost workspace context and the
    // harness would refuse filesystem tool calls or run them against
    // the wrong cwd.
    let (system_prompt, project_path) = build_agent_system_prompt(
        &state,
        &agent,
        effective_project_id.as_deref(),
        agent.harness_mode(),
        project_state_snapshot.as_deref(),
    )
    .await;

    let system_prompt = if is_plan_mode {
        append_plan_mode_suffix(&system_prompt)
    } else {
        system_prompt
    };
    let tool_permissions = is_plan_mode.then(plan_mode_tool_permissions);

    let config = SessionConfig {
        system_prompt: Some(system_prompt),
        agent_id: Some(partition_agent_id),
        template_agent_id: Some(agent_id.to_string()),
        user_id: Some(auth_session.user_id.clone()),
        agent_name: Some(agent.name.clone()),
        model: model.clone(),
        max_turns,
        token: Some(jwt.clone()),
        conversation_messages,
        project_id: effective_project_id.clone(),
        project_path,
        aura_org_id: effective_org_id.as_ref().map(ToString::to_string),
        aura_session_id: persist_ctx.as_ref().map(|c| c.session_id.to_string()),
        provider_overrides: session_model_overrides_with_cache(
            model.as_deref(),
            Some(format!("agent:{agent_id}")),
            Some("24h"),
        ),
        installed_tools,
        installed_integrations,
        agent_permissions: (&normalized_perms).into(),
        intent_classifier: agent.intent_classifier.clone(),
        tool_permissions,
        ..Default::default()
    };

    open_harness_chat_stream(
        &state,
        OpenChatStreamArgs {
            session_key,
            harness_mode: agent.harness_mode(),
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
