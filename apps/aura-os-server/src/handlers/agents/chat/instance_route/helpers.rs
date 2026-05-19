//! Per-turn setup helpers for the instance chat route — model picking, org-id resolution, integrations fetch, permissions normalisation, and pre-stream history hydration.

use aura_os_core::{AgentInstanceId, AgentPermissions, OrgId, ProjectId, SessionId};

use crate::dto::SendChatRequest;
use crate::error::{map_storage_error, ApiResult};
use crate::state::AppState;

use super::super::compaction::{
    load_project_state_snapshot, session_events_to_conversation_history,
};
use super::super::loaders::{
    load_current_session_events_for_instance, load_pinned_session_events_for_instance,
};
use super::super::setup::has_live_session;

pub(super) async fn load_history_and_project_state(
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

pub(super) fn pick_instance_model(
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

pub(super) fn resolve_effective_org_id(
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

pub(super) async fn fetch_org_integrations(
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
pub(super) async fn normalize_instance_perms(
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

pub(super) fn installed_workspace_integrations(
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
