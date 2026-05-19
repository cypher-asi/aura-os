//! Shared helpers used by every adapter handler (loop-instance / user-id resolution and the per-call stream timeouts).

use std::str::FromStr;
use std::time::Duration;

use aura_os_core::{AgentInstanceId, ProjectId, UserId};

use crate::error::{ApiError, ApiResult};
use crate::state::{AppState, AuthSession};

use super::super::types::LoopQueryParams;

pub(super) const LOOP_STREAM_TIMEOUT: Duration = Duration::from_secs(24 * 60 * 60);
pub(super) const TASK_STREAM_TIMEOUT: Duration = Duration::from_secs(6 * 60 * 60);

/// Resolve the `agent_instance_id` to use for an automation loop.
///
/// When the caller pins an explicit id, honour it — that's the
/// "I want the loop for *this* binding" case. Otherwise lazily
/// resolve the project's canonical `Loop`-roled instance via
/// [`AgentInstanceService::ensure_default_loop_instance`], which
/// promotes a `Chat` instance to `Loop` on first use. The fallback
/// keeps us out of the "random UUID -> unreachable registry slot"
/// failure mode that motivated the original
/// `require_agent_instance_id` guard while still letting the
/// frontend omit the param when it doesn't yet know the project's
/// loop instance.
pub(super) async fn resolve_loop_instance_id(
    state: &AppState,
    project_id: ProjectId,
    params: &LoopQueryParams,
) -> ApiResult<AgentInstanceId> {
    if let Some(id) = params.agent_instance_id {
        return Ok(id);
    }
    let instance = state
        .agent_instance_service
        .ensure_default_loop_instance(&project_id)
        .await
        .map_err(|e| match e {
            aura_os_agents::AgentError::NotFound => ApiError::bad_request(
                "agent_instance_id is required: project has no usable template \
                 instance to promote to a Loop binding",
            ),
            other => ApiError::internal(format!("resolving default loop instance: {other}")),
        })?;
    Ok(instance.agent_instance_id)
}

/// Resolve the signed-in user id for loop identity.
///
/// When the auth session lacks a network user id we fall back to the
/// string user id parsed into a UUID; as a last resort we mint a new
/// UserId so the loop is still addressable in telemetry. This should
/// never happen for fully-validated zOS sessions, but we guard against
/// it rather than `.expect()`.
pub(super) fn loop_user_id(session: &AuthSession) -> UserId {
    if let Some(uid) = session.0.network_user_id {
        return uid;
    }
    UserId::from_str(&session.0.user_id).unwrap_or_else(|_| UserId::new())
}
