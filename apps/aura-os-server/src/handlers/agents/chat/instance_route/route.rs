//! Axum handler for `POST /v1/projects/:project_id/agents/:instance_id/chat/stream`.

use aura_os_core::{AgentInstanceId, ProjectId, SessionId};
use aura_os_harness::SessionConfig;
use axum::extract::{Path, State};
use axum::Json;
use tracing::info;

use crate::dto::SendChatRequest;
use crate::error::{ApiError, ApiResult};
use crate::handlers::agents::workspace_tools::{
    installed_workspace_integrations_for_session, integrations_for_optional_org_with_token,
};
use crate::handlers::billing::require_credits_for_auth_source;
use crate::handlers::plan_mode::{is_plan_mode_action, session_tool_permissions};
use crate::handlers::projects_helpers::{
    is_project_tool_action, project_tool_max_turns, resolve_project_tool_workspace_path,
};
use crate::state::{AppState, AuthJwt};

use super::super::agent_route::parse_wire_session_id;
use super::super::busy::{reject_if_partition_busy, BusyScope};
use super::super::computer_use_gate::computer_use_session_fields;
use super::super::cross_agent_reply::read_cross_agent_depth;
use super::super::persist::{
    build_chat_partition, try_pin_session, ChatPersistRequest, PinnedSessionOutcome,
};
use super::super::runtime_gate::ensure_chat_runtime_allowed;
use super::super::setup::setup_project_chat_persistence;
use super::super::streaming::{open_harness_chat_stream, OpenChatStreamArgs};
use super::super::tools::{build_session_installed_tools, InstalledToolsCtx};
use super::super::typed_session::{
    build_typed_session_fields, TypedProjectInputs, TypedSessionFields, TypedSessionInputs,
};
use super::super::types::SseResponse;

use super::super::super::runtime::{
    resolve_council_mechanism, resolve_council_members, resolve_mixture_members,
    second_opinion_presentation, session_model_overrides_with_cache,
};

use super::client_retry::header_indicates_client_retry;
use super::helpers::{
    load_history_and_project_state, normalize_instance_perms, pick_instance_model,
    resolve_effective_org_id,
};

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
    ensure_chat_runtime_allowed(&state, instance.harness_mode())?;
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

    let persist_outcome =
        setup_project_chat_persistence(&state, &project_id, &agent_instance_id, &persist_request)
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
    let partition_agent_id = build_chat_partition(
        &instance.agent_id,
        Some(&agent_instance_id),
        persist_ctx.as_ref(),
    );
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
    let project_path = resolve_project_tool_workspace_path(
        &state,
        &project_id,
        instance.harness_mode(),
        Some(agent_instance_id),
    )
    .await?;

    let model = pick_instance_model(&body, &instance);

    // AURA Council: only active when the client sends >= 2 models, the
    // same gate the agent route uses. A single model (or an absent
    // `council`) leaves the single-model path below unchanged. Each
    // member resolves against the instance's default model and shares
    // the per-instance override cache-key prefix + 24h retention.
    let active_council = body.council.as_ref().filter(|c| c.models.len() >= 2);
    let active_mixture = body.mixture.as_ref();
    if active_council.is_some() && active_mixture.is_some() {
        return Err(ApiError::bad_request(
            "send one multi-agent strategy: council or mixture, not both",
        ));
    }
    let council = match (active_council, active_mixture) {
        (Some(council_body), None) => Some(resolve_council_members(
            instance.default_model.as_deref(),
            council_body,
            Some(&format!("instance:{agent_instance_id}")),
            Some("24h"),
        )?),
        (None, Some(mixture_body)) => Some(resolve_mixture_members(
            instance.default_model.as_deref(),
            mixture_body,
            Some(&format!("instance:{agent_instance_id}")),
            Some("24h"),
        )?),
        _ => None,
    };
    // Council-wide combine mechanism (synthesize / contrast /
    // side_by_side). Only meaningful when the council is active; the
    // single-model path leaves it `None`.
    let council_mechanism = active_council
        .map(resolve_council_mechanism)
        .or_else(|| active_mixture.map(|_| aura_os_harness::CouncilMechanism::Synthesize));
    let council_presentation = active_mixture.map(|_| second_opinion_presentation());

    let effective_org_id = resolve_effective_org_id(&state, instance.org_id.as_ref(), &project_id);
    let org_integrations =
        integrations_for_optional_org_with_token(&state, effective_org_id.as_ref(), &jwt).await;
    let normalized_instance_perms = normalize_instance_perms(&state, &instance, &pid_str).await;
    let agent_instance_id_string = agent_instance_id.to_string();
    let template_agent_id_string = instance.agent_id.to_string();

    let installed_tools = build_session_installed_tools(
        &InstalledToolsCtx {
            state: &state,
            org_id: effective_org_id.as_ref(),
            jwt: &jwt,
            context: "instance_chat",
            agent_id: &agent_instance_id_string,
            template_agent_id: &template_agent_id_string,
            project_id: Some(&pid_str),
            integrations: org_integrations.as_deref(),
        },
        &normalized_instance_perms,
    )
    .await?;
    let installed_integrations =
        installed_workspace_integrations_for_session(org_integrations.as_deref());

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
    // hits this surface with `action=generate_specs`, the helper folds
    // the shared plan-mode rules into the typed
    // `agent_system_prompt` and hard-disables the code-writing tools
    // via `tool_permissions`. The cold-start session sees the strict
    // policy; warm sessions keep their existing config but still get
    // the per-turn preamble + tool_hints applied inside
    // `open_harness_chat_stream`. See `crate::handlers::plan_mode`
    // for the full contract.
    let is_plan_mode = is_plan_mode_action(body.action.as_deref());
    let tool_permissions =
        session_tool_permissions(&normalized_instance_perms.tool_permissions, is_plan_mode);

    // Chat-WS migration: forward typed identity / skills /
    // operator-prompt / project_info on the wire and let the harness
    // assemble the `<chat_capabilities>` + `<agent_identity>` +
    // `<agent_skills>` + `<agent_system_prompt>` + `<project_context>`
    // + `<agents_md>` envelope via `SystemPromptBuilder` from the typed
    // identity / project-info wire fields.
    let TypedSessionFields {
        agent_identity,
        agent_skills,
        agent_system_prompt,
        project_info,
    } = build_typed_session_fields(
        &state,
        TypedSessionInputs {
            name: &instance.name,
            role: &instance.role,
            personality: &instance.personality,
            skills: &instance.skills,
            agent_template_prompt: &instance.system_prompt,
            project_state_snapshot: project_state_snapshot.as_deref(),
            plan_mode: is_plan_mode,
            project: Some(TypedProjectInputs {
                project_id: &project_id,
                workspace_path: project_path.as_deref(),
            }),
        },
    );

    let (computer_use, computer_executor_url) = computer_use_session_fields();
    let local_project_counts =
        crate::usage_signals::local_project_counts(&state, effective_org_id.as_ref());
    let binding_source =
        crate::usage_signals::AgentBindingSource::from_wire(instance.source.as_deref());
    let usage_signal_context = Some(crate::usage_signals::UsageSignalContext {
        user_id: auth_session.user_id.clone(),
        turn_started_at: std::time::Instant::now(),
        route_kind: crate::usage_signals::TurnRouteKind::ProjectAgent,
        binding_source,
        // ZeroAuthSession::created_at is auth validation time, not account creation time.
        account_age_days: None,
        is_zero_pro: Some(auth_session.is_zero_pro),
        is_access_granted: Some(auth_session.is_access_granted),
        local_project_count: local_project_counts.local_project_count,
        same_org_project_count: local_project_counts.same_org_project_count,
        has_project_context: true,
        has_user_project_instance: crate::usage_signals::user_visible_binding(binding_source),
        is_auto_home_only: matches!(
            binding_source,
            crate::usage_signals::AgentBindingSource::AutoHome
        ),
        is_plan_mode,
        is_cross_agent: body
            .originating_agent_id
            .as_deref()
            .map(|id| !id.trim().is_empty())
            .unwrap_or(false)
            || body
                .from_agent_id
                .as_deref()
                .map(|id| !id.trim().is_empty())
                .unwrap_or(false),
        is_council: active_council.is_some() || active_mixture.is_some(),
        is_new_session: force_new,
        attachment_count: crate::usage_signals::attachment_count(&body.attachments),
        installed_tool_count: crate::usage_signals::option_vec_len(&installed_tools),
        installed_integration_count: crate::usage_signals::option_vec_len(&installed_integrations),
        client_ip_hash: crate::usage_signals::client_ip_hash_from_headers(&headers),
    });
    let config = SessionConfig {
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
        agent_identity,
        agent_skills,
        agent_system_prompt,
        project_info,
        reasoning_effort: body.reasoning_effort.clone(),
        council,
        council_mechanism,
        council_presentation,
        computer_use,
        computer_executor_url,
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
            usage_signal_context,
        },
    )
    .await
}
