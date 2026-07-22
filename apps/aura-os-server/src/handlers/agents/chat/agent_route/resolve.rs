//! Agent and session resolution helpers for the bare-agent chat
//! route: look up the agent against aura-network (with a local
//! shadow fallback), parse the wire `session_id`, and validate any
//! caller-supplied pin against the agent's project bindings.

use aura_os_core::{Agent, AgentId, SessionId, ZeroAuthSession};
use tracing::warn;

use crate::error::{ApiError, ApiResult};
use crate::state::AppState;

use super::super::discovery::find_matching_project_agents;
use super::super::persist::{try_pin_session, PinnedSessionOutcome};

/// Resolve the target agent with the *caller's* JWT rather than the
/// ambient `SettingsStore::get_jwt()` cache. The cache is shared
/// in-memory state that races under concurrent requests (e.g. the UI
/// polling `remote_agent/state` for 12 agents in parallel while the
/// CEO issues `send_to_agent`), which previously caused
/// `get_agent_async` to query aura-network with the wrong bearer and
/// surface spurious 404s. A local shadow is accepted only when its
/// persisted owner matches the authenticated session. That lets desktop
/// (and a hosted process with a warm caller-owned cache) survive a
/// transient directory outage without turning the shadow into a
/// cross-user authorization bypass.
pub(super) async fn resolve_agent_for_chat(
    state: &AppState,
    agent_id: &AgentId,
    jwt: &str,
    auth_session: &ZeroAuthSession,
) -> ApiResult<aura_os_core::Agent> {
    match state.agent_service.get_agent_with_jwt(jwt, agent_id).await {
        Ok(a) => Ok(a),
        Err(aura_os_agents::AgentError::NotFound) => {
            caller_owned_shadow(state, agent_id, auth_session).ok_or_else(|| {
                warn!(
                    %agent_id,
                    "agent resolution failed: not in network or caller-owned local shadow",
                );
                ApiError::not_found(format!(
                    "agent {agent_id} not found in network or caller-owned local shadow"
                ))
            })
        }
        Err(e) => {
            if let Some(agent) = caller_owned_shadow(state, agent_id, auth_session) {
                warn!(
                    %agent_id,
                    error = %e,
                    "agent resolution failed via network; using caller-owned local shadow"
                );
                return Ok(agent);
            }
            warn!(
                %agent_id,
                error = %e,
                "agent resolution failed via network and no caller-owned local shadow is available"
            );
            Err(ApiError::agent_directory_unavailable())
        }
    }
}

fn caller_owned_shadow(
    state: &AppState,
    agent_id: &AgentId,
    auth_session: &ZeroAuthSession,
) -> Option<Agent> {
    let agent = state.agent_service.get_agent_local(agent_id).ok()?;
    let owns_agent = agent.user_id == auth_session.user_id
        || auth_session
            .network_user_id
            .as_ref()
            .is_some_and(|user_id| agent.user_id == user_id.to_string());
    owns_agent.then_some(agent)
}

/// Validate the caller-supplied `pinned_session_id` against the
/// agent's project bindings. Standalone agents may be bound to
/// multiple projects (each with its own session list), so the pin
/// is accepted when it matches *any* binding and rejected otherwise.
pub(super) async fn resolve_pinned_session_for_agent(
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
pub(crate) fn parse_wire_session_id(raw: Option<&str>) -> ApiResult<Option<SessionId>> {
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
