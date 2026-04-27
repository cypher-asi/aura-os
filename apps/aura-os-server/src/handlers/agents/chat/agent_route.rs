//! `POST /v1/agents/:agent_id/chat/stream` route. Resolves the target
//! agent, prepares the harness `SessionConfig`, kicks off persistence,
//! and hands off to the SSE driver.

use aura_os_core::{AgentId, AgentPermissions, ChatRole, OrgId, SessionEvent};
use aura_os_harness::{ConversationMessage, SessionConfig};
use axum::extract::{Path, State};
use axum::Json;
use tracing::{error, info, warn};

use crate::dto::SendChatRequest;
use crate::error::{ApiError, ApiResult};
use crate::handlers::projects_helpers::{is_project_tool_action, project_tool_max_turns};
use crate::state::{AppState, AuthJwt};

use super::busy::reject_if_partition_busy;
use super::compaction::{
    append_project_state_to_system_prompt, load_project_state_snapshot,
    session_events_to_conversation_history,
};
use super::constants::{CONVERSATION_HISTORY_WARN_BYTES, DEFAULT_AGENT_HISTORY_WINDOW_LIMIT};
use super::discovery::find_matching_project_agents;
use super::loaders::load_current_session_events_for_agent_with_matched;
use super::persist::ChatPersistCtx;
use super::request::slice_recent_agent_events;
use super::setup::{
    has_live_session, remove_live_session, setup_agent_chat_persistence_with_matched,
};
use super::streaming::{open_harness_chat_stream, OpenChatStreamArgs};
use super::tools::{build_session_installed_tools, InstalledToolsCtx};
use super::types::SseResponse;

use super::super::runtime::{build_harness_provider_config, effective_model};
use crate::handlers::billing::require_credits_for_auth_source;

pub(crate) async fn send_agent_event_stream(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    crate::state::AuthSession(auth_session): crate::state::AuthSession,
    Path(agent_id): Path<AgentId>,
    Json(body): Json<SendChatRequest>,
) -> ApiResult<SseResponse> {
    let agent = resolve_agent_for_chat(&state, &agent_id, &jwt).await?;
    require_credits_for_auth_source(&state, &jwt, &agent.auth_source).await?;
    info!(%agent_id, action = ?body.action, "Agent message stream requested");

    if agent.adapter_type != "aura_harness" {
        return Err(ApiError::bad_request(format!(
            "adapter `{}` is no longer supported; only `aura_harness` agents can be chatted with",
            agent.adapter_type
        )));
    }

    // Block the bare-agent chat route when *any* AgentInstance of
    // this template is currently running an automaton. The legacy
    // route has no project / instance scope of its own, so it
    // collides with the harness turn-lock as soon as any partition
    // for this template is occupied. Surfacing `agent_busy` here
    // matches the instance-route guard and keeps the raw upstream
    // "turn in progress" wording from leaking to the UI.
    reject_if_partition_busy(&state, &agent_id, None).await?;

    let force_new = body.new_session.unwrap_or(false);
    let partition_agent_id = aura_os_core::harness_agent_id(&agent_id, None);
    let session_key = partition_agent_id.clone();
    if force_new {
        remove_live_session(&state, &session_key).await;
    }
    let live_session = has_live_session(&state, &session_key).await;

    let (persist_ctx, conversation_messages) =
        load_persistence_and_history(&state, &agent_id, &jwt, force_new, live_session).await;

    log_persistence_status(&agent_id, persist_ctx.is_some());
    log_history_size(&agent_id, conversation_messages.as_deref());

    let project_state_snapshot =
        load_project_state_for_agent(&state, &body, &persist_ctx, &jwt, force_new, live_session)
            .await;

    let model = effective_model(&agent, body.model.clone());
    let org_integrations = fetch_org_integrations(&state, agent.org_id.as_ref(), &jwt).await;

    let effective_project_id = resolve_effective_project_id(&body, &persist_ctx);
    let normalized_perms = normalize_agent_perms(&agent, effective_project_id.as_deref());

    let installed_tools = build_session_installed_tools(
        &InstalledToolsCtx {
            state: &state,
            org_id: agent.org_id.as_ref(),
            jwt: &jwt,
            context: "agent_chat",
            agent_id: &agent_id.to_string(),
            integrations: org_integrations.as_deref(),
        },
        &normalized_perms,
    )
    .await?;
    let installed_integrations =
        installed_workspace_integrations(agent.org_id.as_ref(), org_integrations.as_deref());

    // Mirror the cap applied in `instance_route.rs::send_event_stream`:
    // tool-driven actions like `generate_specs` get bounded so a
    // runaway loop returns instead of stalling past Node's default
    // `headersTimeout`. Interactive chat stays uncapped.
    let max_turns = is_project_tool_action(body.action.as_deref()).then(project_tool_max_turns);

    let config = SessionConfig {
        system_prompt: Some(append_project_state_to_system_prompt(
            &agent.system_prompt,
            project_state_snapshot.as_deref(),
        )),
        agent_id: Some(partition_agent_id),
        template_agent_id: Some(agent_id.to_string()),
        user_id: Some(auth_session.user_id.clone()),
        agent_name: Some(agent.name.clone()),
        model: model.clone(),
        max_turns,
        token: Some(jwt.clone()),
        conversation_messages,
        project_id: body.project_id.clone(),
        aura_org_id: agent.org_id.as_ref().map(|o| o.to_string()),
        aura_session_id: persist_ctx.as_ref().map(|c| c.session_id.clone()),
        provider_config: build_harness_provider_config(
            agent.harness_mode(),
            &agent.auth_source,
            None,
            model.as_deref(),
        )?,
        installed_tools,
        installed_integrations,
        agent_permissions: (&normalized_perms).into(),
        intent_classifier: agent.intent_classifier.clone(),
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

async fn load_persistence_and_history(
    state: &AppState,
    agent_id: &AgentId,
    jwt: &str,
    force_new: bool,
    live_session: bool,
) -> (Option<ChatPersistCtx>, Option<Vec<ConversationMessage>>) {
    // `setup_agent_chat_persistence` and the history loader both need
    // the set of project agents bound to this agent id. Previously
    // each called `find_matching_project_agents` independently, which
    // doubled the `list_orgs` / `list_projects_by_org` /
    // `list_project_agents` fan-out on every turn. Fetch it once here
    // and thread it into both consumers.
    let Some(ref storage) = state.storage_client else {
        return (None, None);
    };
    let matching = find_matching_project_agents(state, storage, jwt, &agent_id.to_string()).await;

    let persist_fut =
        setup_agent_chat_persistence_with_matched(storage, agent_id, jwt, force_new, &matching);
    let history_fut =
        build_history_future(storage, agent_id, jwt, &matching, force_new, live_session);

    let (persist_ctx, conversation_messages) = tokio::join!(persist_fut, history_fut);
    (persist_ctx, conversation_messages)
}

async fn build_history_future(
    storage: &aura_os_storage::StorageClient,
    agent_id: &AgentId,
    jwt: &str,
    matching: &[aura_os_storage::StorageProjectAgent],
    force_new: bool,
    live_session: bool,
) -> Option<Vec<ConversationMessage>> {
    // LLM context rebuild on cold start: load only the current storage
    // session, not the full multi-session aggregate. See
    // `load_current_session_events_for_agent` doc-comment for rationale.
    if force_new || live_session {
        return None;
    }
    let stored =
        load_current_session_events_for_agent_with_matched(storage, agent_id, jwt, matching).await;
    if stored.is_empty() {
        return None;
    }
    let bounded = slice_recent_agent_events(stored, Some(DEFAULT_AGENT_HISTORY_WINDOW_LIMIT), 0);
    Some(session_events_to_conversation_history(&bounded))
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
