//! Ownership resolution for the standalone-agent per-session read
//! surface (`/api/agents/:agent_id/sessions/:session_id/...`).
//!
//! Shared by the plain and paginated event listings so both enforce the
//! exact same checks: the session's `project_agent_id` binding must
//! resolve to a project-agent whose template `agent_id` matches the URL
//! parameter.

use aura_os_core::{AgentId, SessionId};
use aura_os_storage::{StorageClient, StorageSession};
use tracing::warn;

use crate::error::{map_storage_error, ApiError, ApiResult};
use crate::handlers::agents::sessions::reject_deleted_storage_session;

/// A storage session proven to belong to the URL `agent_id`, plus the
/// binding id needed to reconstruct its history.
pub(super) struct OwnedAgentSession {
    pub(super) session: StorageSession,
    pub(super) project_agent_id: String,
}

/// Resolve `session_id` and enforce that it belongs to the template
/// `agent_id`. Any mismatch (or missing binding) returns 404 — we don't
/// differentiate "session belongs to another agent" from "session does
/// not exist" because both leak nothing useful to a caller probing for
/// ids.
pub(super) async fn resolve_agent_owned_session(
    storage: &StorageClient,
    jwt: &str,
    agent_id: &AgentId,
    session_id: &SessionId,
) -> ApiResult<OwnedAgentSession> {
    let session = storage
        .get_session(&session_id.to_string(), jwt)
        .await
        .map_err(map_session_lookup_error)?;
    reject_deleted_storage_session(&session, "session not found")?;

    let project_agent_id = session
        .project_agent_id
        .clone()
        .ok_or_else(|| ApiError::not_found("session not found"))?;

    let project_agent = storage
        .get_project_agent(&project_agent_id, jwt)
        .await
        .map_err(map_session_lookup_error)?;

    let agent_id_str = agent_id.to_string();
    let owns_session = project_agent.agent_id.as_deref() == Some(agent_id_str.as_str());
    if !owns_session {
        warn!(
            %agent_id,
            %session_id,
            owner_agent_id = ?project_agent.agent_id,
            "agent session access: session does not belong to URL agent",
        );
        return Err(ApiError::not_found("session not found"));
    }

    Ok(OwnedAgentSession {
        session,
        project_agent_id,
    })
}

/// 404s from aura-storage stay 404 ("session not found"); everything
/// else keeps its upstream context via `map_storage_error`.
fn map_session_lookup_error(
    error: aura_os_storage::StorageError,
) -> (axum::http::StatusCode, axum::Json<ApiError>) {
    match &error {
        aura_os_storage::StorageError::Server { status: 404, .. } => {
            ApiError::not_found("session not found")
        }
        _ => map_storage_error(error),
    }
}
