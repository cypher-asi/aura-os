//! `POST /v1/projects/:project_id/agents/:instance_id/chat/stream`
//! route. Runs an agent instance chat turn — refreshes permissions
//! from the parent template, builds the project-aware system prompt,
//! and hands off to the SSE driver.

use aura_os_core::{AgentInstanceId, AgentPermissions, OrgId, ProjectId};
use aura_os_harness::SessionConfig;
use axum::extract::{Path, State};
use axum::Json;
use tracing::{info, warn};

use crate::dto::SendChatRequest;
use crate::error::{map_storage_error, ApiError, ApiResult};
use crate::handlers::billing::require_credits_for_auth_source;
use crate::handlers::projects_helpers::resolve_agent_instance_workspace_path;
use crate::state::{AppState, AuthJwt};

use super::compaction::{
    append_project_state_to_system_prompt, load_project_state_snapshot,
    session_events_to_conversation_history,
};
use super::loaders::load_current_session_events_for_instance;
use super::setup::{has_live_session, remove_live_session, setup_project_chat_persistence};
use super::streaming::{open_harness_chat_stream, OpenChatStreamArgs};
use super::tools::{build_session_installed_tools, InstalledToolsCtx};
use super::types::SseResponse;

use super::super::runtime::build_harness_provider_config;

pub(crate) async fn send_event_stream(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    crate::state::AuthSession(auth_session): crate::state::AuthSession,
    Path((project_id, agent_instance_id)): Path<(ProjectId, AgentInstanceId)>,
    Json(body): Json<SendChatRequest>,
) -> ApiResult<SseResponse> {
    let instance = state
        .agent_instance_service
        .get_instance(&project_id, &agent_instance_id)
        .await
        .map_err(|e| ApiError::internal(format!("looking up agent instance: {e}")))?;
    require_credits_for_auth_source(&state, &jwt, &instance.auth_source).await?;
    info!(%project_id, %agent_instance_id, action = ?body.action, "Message stream requested");

    // `body.commands` is accepted for API compatibility but not yet wired
    // through to the harness — preserve the original chat.rs behavior.
    let _ = body.commands;

    reject_if_automaton_running(&state, &project_id, &agent_instance_id).await?;

    let partition_agent_id =
        aura_os_core::harness_agent_id(&instance.agent_id, Some(&agent_instance_id));
    let session_key = partition_agent_id.clone();
    let force_new = body.new_session.unwrap_or(false);
    let persist_ctx =
        setup_project_chat_persistence(&state, &project_id, &agent_instance_id, &jwt, force_new)
            .await;
    if force_new {
        remove_live_session(&state, &session_key).await;
    }

    let (conversation_messages, project_state_snapshot) = load_history_and_project_state(
        &state,
        &session_key,
        &project_id,
        &agent_instance_id,
        &jwt,
        force_new,
    )
    .await?;

    let pid_str = project_id.to_string();
    let project_path =
        resolve_agent_instance_workspace_path(&state, &project_id, Some(agent_instance_id)).await;
    let system_prompt = build_project_system_prompt(
        &state,
        &project_id,
        &instance.system_prompt,
        project_path.as_deref(),
    );
    let system_prompt =
        append_project_state_to_system_prompt(&system_prompt, project_state_snapshot.as_deref());

    let model = pick_instance_model(&body, &instance);
    let org_integrations = fetch_org_integrations(&state, instance.org_id.as_ref(), &jwt).await;
    let normalized_instance_perms = normalize_instance_perms(&state, &instance, &pid_str).await;

    let installed_tools = build_session_installed_tools(
        &InstalledToolsCtx {
            state: &state,
            org_id: instance.org_id.as_ref(),
            jwt: &jwt,
            context: "instance_chat",
            agent_id: &agent_instance_id.to_string(),
            integrations: org_integrations.as_deref(),
        },
        &normalized_instance_perms,
    )
    .await?;
    let installed_integrations =
        installed_workspace_integrations(instance.org_id.as_ref(), org_integrations.as_deref());

    let config = SessionConfig {
        system_prompt: Some(system_prompt),
        agent_id: Some(partition_agent_id),
        template_agent_id: Some(instance.agent_id.to_string()),
        user_id: Some(auth_session.user_id.clone()),
        agent_name: Some(instance.name.clone()),
        model: model.clone(),
        token: Some(jwt),
        conversation_messages,
        project_id: Some(pid_str),
        project_path,
        aura_org_id: instance.org_id.as_ref().map(|o| o.to_string()),
        aura_session_id: persist_ctx.as_ref().map(|c| c.session_id.clone()),
        provider_config: build_harness_provider_config(
            &instance.auth_source,
            None,
            model.as_deref(),
        )?,
        installed_tools,
        installed_integrations,
        agent_permissions: (&normalized_instance_perms).into(),
        intent_classifier: instance.intent_classifier.clone(),
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
        },
    )
    .await
}

/// Reject new chat turns when this agent is already running an
/// automation loop upstream. The harness enforces one in-flight
/// turn per `agent_id` (shared by `/v1/agents/{id}/sessions` and
/// `/v1/agents/{id}/automaton/start`), so a `UserMessage` posted
/// while the loop is active surfaces as the raw upstream error
/// "A turn is currently in progress; send cancel first" with no
/// way for the UI to cancel it. Catching the conflict here lets
/// the frontend render a targeted "stop automation to chat"
/// affordance instead.
async fn reject_if_automaton_running(
    state: &AppState,
    project_id: &ProjectId,
    agent_instance_id: &AgentInstanceId,
) -> ApiResult<()> {
    let reg = state.automaton_registry.lock().await;
    let Some(entry) = reg.get(&(*project_id, *agent_instance_id)) else {
        return Ok(());
    };
    let live = entry.alive.load(std::sync::atomic::Ordering::Acquire);
    if !live || entry.paused {
        return Ok(());
    }
    let automaton_id = entry.automaton_id.clone();
    drop(reg);
    warn!(
        %project_id,
        %agent_instance_id,
        %automaton_id,
        "Rejecting chat turn: agent is running an automation loop",
    );
    Err(ApiError::agent_busy(
        "Agent is currently running an automation task. Stop the loop to chat.",
        Some(automaton_id),
    ))
}

async fn load_history_and_project_state(
    state: &AppState,
    session_key: &str,
    project_id: &ProjectId,
    agent_instance_id: &AgentInstanceId,
    jwt: &str,
    force_new: bool,
) -> ApiResult<(
    Option<Vec<aura_os_harness::ConversationMessage>>,
    Option<String>,
)> {
    if force_new {
        return Ok((None, None));
    }
    if has_live_session(state, session_key).await {
        return Ok((None, None));
    }
    // LLM context rebuild on cold start: load only the current storage
    // session, not the full multi-session aggregate. See
    // `load_current_session_events_for_instance` doc-comment for rationale.
    let stored = load_current_session_events_for_instance(state, agent_instance_id, jwt)
        .await
        .map_err(map_storage_error)?;
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

pub(super) fn build_project_system_prompt(
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

fn render_project_context(
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

fn render_project_context_fallback(project_id: &ProjectId) -> String {
    format!(
        "<project_context>\nproject_id: {}\n</project_context>\n\n\
         IMPORTANT: When calling tools that accept a project_id parameter, always use the project_id above.\n\n\
         IMPORTANT: For filesystem and command tools, treat the project root as `.` and always use relative paths. Never pass `/` or any other absolute host path.\n\n\
         IMPORTANT: When creating or updating specs, put the markdown only in the `markdown_contents` tool argument and keep visible assistant text to a short preview. Create large or multi-phase plans as multiple focused specs, one `create_spec` call at a time, instead of one huge markdown payload.\n\n",
        project_id,
    )
}
