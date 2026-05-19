//! `/reset-session` HTTP endpoints for both bare-agent and instance
//! chats. Sweep every live chat-session entry under the partition and
//! re-resolve persistence with `force_new=true` so the next user
//! message lands on a brand-new storage session row.

use aura_os_core::{AgentId, AgentInstanceId, ProjectId};
use axum::extract::{Path, State};
use axum::http::StatusCode;
use tracing::{info, warn};

use crate::error::ApiResult;
use crate::state::{AppState, AuthJwt};

use super::super::persist::ChatPersistRequest;
use super::persistence::{setup_agent_chat_persistence, setup_project_chat_persistence};
use super::registry::remove_live_sessions_for_partition;

pub(crate) async fn reset_agent_session(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    Path(agent_id): Path<AgentId>,
) -> ApiResult<StatusCode> {
    // The bare-template partition string is exactly the prefix that
    // sweeps `{template}::default` (legacy two-segment, == branch)
    // plus every `{template}::default::{session_id}` entry that the
    // Phase 1 chat route writes (three-segment, starts_with branch).
    // Exact-match eviction would silently no-op on every modern
    // bare-agent chat and leak the turn_slot mutex indefinitely.
    let partition = aura_os_core::harness_agent_id(&agent_id, None, None);
    remove_live_sessions_for_partition(&state, &partition).await;
    // `reset-session` is a destructive admin op, not a cross-agent
    // turn — there's no upstream sender to thread back into and the
    // chain depth resets to 0.
    let request = ChatPersistRequest {
        jwt: &jwt,
        force_new: true,
        pinned_session_id: None,
        originating_agent_id: None,
        cross_agent_depth: 0,
        from_agent_id: None,
    };
    let _ = setup_agent_chat_persistence(&state, &agent_id, &request).await;
    info!(%agent_id, "Agent chat session reset");
    Ok(StatusCode::NO_CONTENT)
}

pub(crate) async fn reset_instance_session(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    Path((project_id, agent_instance_id)): Path<(ProjectId, AgentInstanceId)>,
) -> ApiResult<StatusCode> {
    // Resolve the parent template id so the in-memory session_key matches
    // the partition the chat route stored under
    // (`{template}::{agent_instance_id}`). On lookup failure we fall
    // through to persistence-only reset — the live session (if any) will
    // self-heal on the next chat turn or on server restart, rather than
    // leaving a stale entry that masks a real "reset failed" signal to
    // the caller. Best-effort matches the spirit of
    // `invalidate_chat_sessions_for_agent`.
    let live_session_key = match state
        .agent_instance_service
        .get_instance(&project_id, &agent_instance_id)
        .await
    {
        Ok(instance) => Some(aura_os_core::harness_agent_id(
            &instance.agent_id,
            Some(&agent_instance_id),
            None,
        )),
        Err(e) => {
            warn!(
                %project_id,
                %agent_instance_id,
                error = %e,
                "Instance reset: cannot resolve parent template; skipping in-memory eviction",
            );
            None
        }
    };
    if let Some(key) = live_session_key {
        // The `live_session_key` built above is the two-segment
        // instance partition (`harness_agent_id(template, Some(instance), None)`).
        // After Phase 1 of parallel-session-chats the chat routes
        // store per-session entries under three-segment keys whose
        // prefix is exactly that string + `"::"`, so the prefix sweep
        // evicts every storage session under this instance in one
        // pass. The legacy two-segment form (callers that opted out
        // of the session segment) is covered by the `==` branch in
        // `remove_live_sessions_for_partition`.
        remove_live_sessions_for_partition(&state, &key).await;
    }
    // Reset endpoints aren't cross-agent turns; no sender to record,
    // the depth counter resets to 0, and there's no display-side
    // provenance to thread — the reset endpoint is admin scope, not
    // a chat turn.
    let request = ChatPersistRequest {
        jwt: &jwt,
        force_new: true,
        pinned_session_id: None,
        originating_agent_id: None,
        cross_agent_depth: 0,
        from_agent_id: None,
    };
    let _ = setup_project_chat_persistence(&state, &project_id, &agent_instance_id, &request).await;
    info!(%agent_instance_id, "Instance chat session reset");
    Ok(StatusCode::NO_CONTENT)
}
