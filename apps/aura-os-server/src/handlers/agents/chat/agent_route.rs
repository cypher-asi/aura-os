//! `POST /v1/agents/:agent_id/chat/stream` route. Resolves the target
//! agent, prepares the harness `SessionConfig`, kicks off persistence,
//! and hands off to the SSE driver.

use aura_os_core::{AgentId, AgentPermissions, ChatRole, OrgId, ProjectId, SessionEvent, SessionId};
use aura_os_harness::{ConversationMessage, SessionConfig};
use axum::extract::{Path, State};
use axum::Json;
use tracing::{error, info, warn};

use crate::dto::SendChatRequest;
use crate::error::{ApiError, ApiResult};
use crate::handlers::plan_mode::{
    append_plan_mode_suffix, is_plan_mode_action, plan_mode_tool_permissions,
};
use crate::handlers::projects_helpers::{
    is_project_tool_action, project_tool_max_turns, resolve_project_tool_workspace_path,
};
use crate::state::{AppState, AuthJwt};

use super::busy::{reject_if_partition_busy, BusyScope};
use super::compaction::{
    append_project_state_to_system_prompt, load_project_state_snapshot,
    session_events_to_conversation_history,
};
use super::constants::{CONVERSATION_HISTORY_WARN_BYTES, DEFAULT_AGENT_HISTORY_WINDOW_LIMIT};
use super::cross_agent_reply::read_cross_agent_depth;
use super::discovery::find_matching_project_agents;
use super::identity_preamble::build_identity_preamble;
use super::instance_route::build_project_system_prompt;
use super::loaders::{
    load_current_session_events_for_agent_with_matched, load_pinned_session_events_for_agent,
};
use super::persist::{
    build_chat_partition, try_pin_session, ChatPersistCtx, ChatPersistRequest,
    ChatSessionResolveDeps, ForkInfo, PinnedSessionOutcome,
};
use super::request::slice_recent_agent_events;
use super::setup::{
    has_live_session, lazy_repair_home_project_binding, setup_agent_chat_persistence_with_matched,
};
use super::streaming::{open_harness_chat_stream, OpenChatStreamArgs};
use super::tools::{build_session_installed_tools, InstalledToolsCtx};
use super::types::SseResponse;

use super::super::runtime::{effective_model, session_model_overrides_with_cache};
use crate::handlers::billing::require_credits_for_auth_source;

pub(crate) async fn send_agent_event_stream(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    crate::state::AuthSession(auth_session): crate::state::AuthSession,
    Path(agent_id): Path<AgentId>,
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

/// Resolve the target agent with the *caller's* JWT rather than the
/// ambient `SettingsStore::get_jwt()` cache. The cache is shared
/// in-memory state that races under concurrent requests (e.g. the UI
/// polling `remote_agent/state` for 12 agents in parallel while the
/// CEO issues `send_to_agent`), which previously caused
/// `get_agent_async` to query aura-network with the wrong bearer and
/// surface spurious 404s. The local shadow is only used as a strict
/// `NotFound` fallback; any other upstream failure bubbles up as a 5xx
/// so we don't mask transient network issues behind "agent not found".
async fn resolve_agent_for_chat(
    state: &AppState,
    agent_id: &AgentId,
    jwt: &str,
) -> ApiResult<aura_os_core::Agent> {
    match state.agent_service.get_agent_with_jwt(jwt, agent_id).await {
        Ok(a) => Ok(a),
        Err(aura_os_agents::AgentError::NotFound) => {
            state.agent_service.get_agent_local(agent_id).map_err(|_| {
                warn!(
                    %agent_id,
                    "agent resolution failed: not in network or local shadow",
                );
                ApiError::not_found(format!(
                    "agent {agent_id} not found in network or local shadow"
                ))
            })
        }
        Err(e) => {
            warn!(%agent_id, error = %e, "agent resolution failed via network");
            Err(ApiError::internal(format!(
                "resolving agent {agent_id}: {e}"
            )))
        }
    }
}

/// Validate the caller-supplied `pinned_session_id` against the
/// agent's project bindings. Standalone agents may be bound to
/// multiple projects (each with its own session list), so the pin
/// is accepted when it matches *any* binding and rejected otherwise.
async fn resolve_pinned_session_for_agent(
    state: &AppState,
    agent_id: &AgentId,
    jwt: &str,
    requested_session_id: Option<&SessionId>,
) -> ApiResult<Option<SessionId>> {
    let Some(requested) = requested_session_id else {
        return Ok(None);
    };
    let Some(ref storage) = state.storage_client else {
        // Without storage we can't validate; pretend no pin was
        // requested. `setup_agent_chat_persistence` would no-op
        // anyway on the persist side.
        return Ok(None);
    };
    let matching = find_matching_project_agents(state, storage, jwt, &agent_id.to_string()).await;
    for binding in &matching {
        match try_pin_session(storage.as_ref(), jwt, &binding.id, Some(requested)).await {
            PinnedSessionOutcome::Matched(id) => return Ok(Some(id)),
            PinnedSessionOutcome::NotRequested | PinnedSessionOutcome::Mismatch { .. } => continue,
        }
    }
    Err(ApiError::bad_request(format!(
        "session_id `{requested}` does not belong to agent `{agent_id}`"
    )))
}

/// Parse the wire `session_id` (`Option<String>` on
/// `SendChatRequest`) into the typed [`SessionId`] at the route
/// boundary, normalising the empty string to `None` so a stale
/// `?session=` placeholder doesn't surface as a parse error. A
/// non-UUID string maps to a structured 400 rather than tunneling
/// through the rest of the persist pipeline.
pub(super) fn parse_wire_session_id(raw: Option<&str>) -> ApiResult<Option<SessionId>> {
    let Some(trimmed) = raw.map(str::trim).filter(|s| !s.is_empty()) else {
        return Ok(None);
    };
    match trimmed.parse::<SessionId>() {
        Ok(id) => Ok(Some(id)),
        Err(error) => Err(ApiError::bad_request(format!(
            "session_id `{trimmed}` is not a valid UUID: {error}"
        ))),
    }
}

/// Resolve `ChatPersistCtx` and fork state without loading any
/// conversation history. The returned `matching` list is the
/// one-time-fetched `find_matching_project_agents` result that the
/// downstream [`load_history_for_agent`] reuses, preserving the
/// once-per-turn dedup that the pre-refactor combined helper had.
async fn load_persistence_only(
    state: &AppState,
    agent_id: &AgentId,
    request: &ChatPersistRequest<'_>,
) -> (
    Option<ChatPersistCtx>,
    Option<ForkInfo>,
    Vec<aura_os_storage::StorageProjectAgent>,
) {
    let Some(ref storage) = state.storage_client else {
        return (None, None, Vec::new());
    };
    let mut matching =
        find_matching_project_agents(state, storage, request.jwt, &agent_id.to_string()).await;

    // Self-heal: if the agent has no `project_agent` binding yet
    // (typically because the best-effort auto-bind in
    // `crud::create_agent` failed transiently or `agent.org_id` wasn't
    // populated on the network record at create time), run the same
    // lazy Home-project repair the legacy `setup_agent_chat_persistence`
    // wrapper performs. Without this the deduped hot path lets a brand
    // new user's first chat fail Tier-1 preflight with
    // `missing aura_session_id` because `persist_ctx` would be `None`
    // and `SessionConfig.aura_session_id` defaults to `None`. The
    // repair busts the discovery cache and returns the refreshed match
    // list, so persist + history below see the just-created binding.
    if matching.is_empty() {
        matching =
            lazy_repair_home_project_binding(state, storage, agent_id, request.jwt).await;
    }

    let deps = ChatSessionResolveDeps {
        session_service: state.session_service.as_ref(),
        auto_fork_threshold: state.chat_auto_fork_threshold,
    };
    let persist_outcome =
        setup_agent_chat_persistence_with_matched(storage, agent_id, &matching, request, &deps)
            .await;
    let (persist_ctx, fork_info) = match persist_outcome {
        Some((ctx, fork)) => (Some(ctx), fork),
        None => (None, None),
    };
    (persist_ctx, fork_info, matching)
}

/// Inputs to [`load_history_for_agent`]. Bundles the per-turn flags
/// (`force_new`, `live_session`, `pinned_session_id`) with the
/// dedup-shared `matching` list and the `session_key` used for the
/// cold-vs-warm log line so the helper stays inside the
/// 5-parameter budget. Mirrors the existing `OpenChatStreamArgs`
/// pattern in `streaming.rs`.
pub(super) struct LoadAgentHistoryCtx<'a> {
    pub(super) session_key: &'a str,
    pub(super) jwt: &'a str,
    pub(super) force_new: bool,
    pub(super) live_session: bool,
    pub(super) pinned_session_id: Option<&'a SessionId>,
    pub(super) matching: &'a [aura_os_storage::StorageProjectAgent],
}

/// Load the conversation-history slice for a cold-start agent chat
/// turn, mirroring the warm-skip shape that
/// `instance_route::load_history_and_project_state` uses. Bails early
/// on `force_new` or when `live_session` is true so a warm bare-agent
/// session reuses the harness's in-memory history instead of paying
/// the storage round-trip + bounded-slice + format-conversion cost on
/// every turn. `session_key` is logged so the cold/warm transition is
/// greppable when a perf regression report points at the wrong key
/// shape. `matching` is the dedup-shared list from
/// [`load_persistence_only`].
async fn load_history_for_agent(
    state: &AppState,
    agent_id: &AgentId,
    ctx: &LoadAgentHistoryCtx<'_>,
) -> Option<Vec<ConversationMessage>> {
    if ctx.force_new || ctx.live_session {
        return None;
    }
    let storage = state.storage_client.as_ref()?;
    info!(%agent_id, session_key = %ctx.session_key, "agent chat: cold start, loading history slice");
    let stored = match ctx.pinned_session_id {
        Some(session_id) => {
            load_pinned_history_for_agent(storage, ctx.jwt, session_id, ctx.matching)
                .await
                .unwrap_or_default()
        }
        None => {
            load_current_session_events_for_agent_with_matched(
                storage, agent_id, ctx.jwt, ctx.matching,
            )
            .await
        }
    };
    if stored.is_empty() {
        return None;
    }
    let bounded = slice_recent_agent_events(stored, Some(DEFAULT_AGENT_HISTORY_WINDOW_LIMIT), 0);
    Some(session_events_to_conversation_history(&bounded))
}

/// Locate the project binding the pinned `session_id` belongs to and
/// load its events. The binding lookup is what
/// `resolve_pinned_session_for_agent` already verified above; redoing
/// it here keeps the data path simple at the cost of one extra
/// `list_sessions` round trip per turn — the alternative would be
/// threading the matched binding through `load_history_for_agent`
/// just for this branch.
async fn load_pinned_history_for_agent(
    storage: &aura_os_storage::StorageClient,
    jwt: &str,
    session_id: &SessionId,
    matching: &[aura_os_storage::StorageProjectAgent],
) -> Result<Vec<SessionEvent>, aura_os_storage::StorageError> {
    // Stringify once at this storage boundary; the loader call below
    // ultimately reaches into `storage.list_events(&str, ...)` which
    // keeps `&str` deliberately (the `aura_os_storage` REST shape).
    let session_id_str = session_id.to_string();
    for binding in matching {
        let sessions = storage.list_sessions(&binding.id, jwt).await?;
        if sessions.iter().any(|s| s.id == session_id_str) {
            let project_id = binding.project_id.as_deref().unwrap_or_default();
            return load_pinned_session_events_for_agent(
                storage,
                jwt,
                &session_id_str,
                &binding.id,
                project_id,
            )
            .await;
        }
    }
    Ok(Vec::new())
}

fn log_persistence_status(agent_id: &AgentId, persist_ready: bool) {
    if persist_ready {
        info!(%agent_id, "agent chat: persistence context ready");
    } else {
        error!(%agent_id, "agent chat: persistence context unavailable — chat will NOT be saved");
    }
}

/// Surface the byte size of the flat-text history we're about to ship
/// into the harness `SessionConfig`. This is the cold-start payload
/// (warm sessions skip it via `get_or_create_chat_session`). A `warn!`
/// above `CONVERSATION_HISTORY_WARN_BYTES` makes the next context-bloat
/// regression visible in logs without needing a user bug report.
fn log_history_size(agent_id: &AgentId, msgs: Option<&[ConversationMessage]>) {
    let Some(msgs) = msgs else { return };
    let total_bytes: usize = msgs.iter().map(|m| m.content.len()).sum();
    let count = msgs.len();
    if total_bytes > CONVERSATION_HISTORY_WARN_BYTES {
        warn!(
            %agent_id,
            history_messages = count,
            history_bytes = total_bytes,
            "agent chat: conversation history is large — possible context bloat"
        );
    } else {
        info!(
            %agent_id,
            history_messages = count,
            history_bytes = total_bytes,
            "agent chat: conversation history prepared"
        );
    }
}

/// Project-state continuity: on cold start, load a specs+tasks snapshot
/// for the project we're resolving the chat under so it can be appended
/// to the harness system prompt. Warm sessions keep whatever snapshot
/// was wired into the existing session, so we skip the fetch entirely.
async fn load_project_state_for_agent(
    state: &AppState,
    body: &SendChatRequest,
    persist_ctx: &Option<ChatPersistCtx>,
    jwt: &str,
    force_new: bool,
    live_session: bool,
) -> Option<String> {
    if force_new || live_session {
        return None;
    }
    let snapshot_project_id = body
        .project_id
        .as_ref()
        .map(|project_id| project_id.to_string())
        .or_else(|| persist_ctx.as_ref().map(|ctx| ctx.project_id.clone()));
    match snapshot_project_id {
        Some(project_id) => load_project_state_snapshot(state, &project_id, jwt).await,
        None => None,
    }
}

/// Fetch org integrations exactly once per turn and feed both the
/// tool catalog and the installed-integrations list from the same
/// slice. Previously each of those helpers called
/// `integrations_for_org_with_token` independently, doubling the
/// upstream round-trip on every chat message.
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

/// Resolve the project binding for this turn. Prefer the explicit
/// `body.project_id` (the interface sends it whenever the user is
/// talking to the agent in a project context), and fall back to the
/// `persist_ctx.project_id` inferred from the agent's project-binding
/// record (`find_matching_project_agents`) so the splice fires even
/// for legacy clients that don't thread the project id through the
/// chat body. Without this fallback the CEO-agent flow — where the
/// LLM asks the agent to operate on specs for an implicit project —
/// would still ship a bundle missing `ReadProject`/`WriteProject`,
/// and the harness would deny `list_specs` / `create_spec` by name.
fn resolve_effective_project_id(
    body: &SendChatRequest,
    persist_ctx: &Option<ChatPersistCtx>,
) -> Option<String> {
    body.project_id
        .as_deref()
        .filter(|pid| !pid.is_empty())
        .map(|pid| pid.to_string())
        .or_else(|| {
            persist_ctx
                .as_ref()
                .map(|ctx| ctx.project_id.clone())
                .filter(|pid| !pid.is_empty())
        })
}

fn resolve_effective_org_id(
    state: &AppState,
    preferred_org_id: Option<&OrgId>,
    effective_project_id: Option<&str>,
) -> Option<OrgId> {
    preferred_org_id.cloned().or_else(|| {
        effective_project_id
            .and_then(|pid| pid.parse::<ProjectId>().ok())
            .and_then(|pid| state.project_service.get_project(&pid).ok())
            .map(|project| project.org_id)
    })
}

/// When the turn is project-bound (either explicitly via the body or
/// implicitly via the persistence context), splice the self-project
/// `ReadProject` / `WriteProject` caps into the agent's normalized
/// bundle so the harness receives `SessionConfig.agent_permissions`
/// that let `visible_tools_with_permissions` expose the matching
/// project-scoped native tools.
fn normalize_agent_perms(
    agent: &aura_os_core::Agent,
    effective_project_id: Option<&str>,
) -> AgentPermissions {
    let base_perms = agent
        .permissions
        .clone()
        .normalized_for_identity(&agent.name, Some(agent.role.as_str()));
    match effective_project_id {
        Some(pid) => base_perms.with_project_self_caps(pid),
        None => base_perms,
    }
}

/// Compose the system prompt + workspace path for the bare-agent
/// chat route, mirroring `instance_route::send_event_stream`'s
/// behaviour:
///
/// * If the turn is project-bound (explicit `body.project_id` or
///   inferred via the persistence context), wrap the agent
///   template prompt with the project-aware `<project_context>`
///   block via [`build_project_system_prompt`] and resolve the
///   workspace path so workspace tools see a real cwd.
/// * Otherwise fall back to the bare template prompt with no
///   workspace path (legacy bare-agent semantics).
///
/// In either case the project-state snapshot (specs / tasks
/// summary) is appended last, matching the instance route.
async fn build_agent_system_prompt(
    state: &AppState,
    agent: &aura_os_core::Agent,
    effective_project_id: Option<&str>,
    harness_mode: aura_os_core::HarnessMode,
    project_state_snapshot: Option<&str>,
) -> (String, Option<String>) {
    // Restore parity with the harness-side task-execution path
    // (`build_agent_preamble`): the chat hot path used to forward only
    // `agent.system_prompt`, silently dropping personality / role /
    // skills on every interactive turn. The identity preamble lands
    // FIRST — before the `<project_context>` block — so the LLM reads
    // "who am I" before "what project am I operating in", matching the
    // ordering `agentic_execution_system_prompt` uses.
    let preamble =
        build_identity_preamble(&agent.name, &agent.role, &agent.personality, &agent.skills);
    let (base_prompt, project_path) = match effective_project_id
        .and_then(|pid| pid.parse::<ProjectId>().ok())
    {
        Some(project_id) => {
            // Bare-agent chats have no AgentInstanceId; fall back to
            // project-level workspace resolution (handles both
            // explicit `project.local_workspace_path` and the
            // canonical `data_dir`-rooted layout for Local /
            // Swarm).
            let project_path =
                resolve_project_tool_workspace_path(state, &project_id, harness_mode, None).await;
            let project_block = build_project_system_prompt(
                state,
                &project_id,
                &agent.system_prompt,
                project_path.as_deref(),
            );
            (format!("{preamble}{project_block}"), project_path)
        }
        None => (format!("{preamble}{}", agent.system_prompt), None),
    };
    let with_state = append_project_state_to_system_prompt(&base_prompt, project_state_snapshot);
    (with_state, project_path)
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

#[allow(dead_code)]
fn _quiet_unused(_: ChatRole, _: SessionEvent) {}
