//! Authenticated session-share handlers.
//!
//! [`create_session_share`] flips the `is_public` flag on a session the
//! caller owns and returns a ChatGPT-style public link
//! (`https://aura.ai/s/t_<32 hex>`). The share is a capability token
//! persisted on the session row in aura-storage (no snapshot copy); the
//! matching unauthenticated read path lives in
//! [`crate::handlers::public`].

use axum::extract::{Path, State};
use axum::http::HeaderMap;
use axum::Json;
use serde::Serialize;
use serde_json::json;
use tracing::info;

use aura_os_core::{AgentInstanceId, ProjectId, SessionId};
use aura_os_storage::UpdateSessionRequest;

use crate::error::{map_storage_error, ApiError, ApiResult};
use crate::state::{AppState, AuthJwt, AuthSession};

/// Public base URL that share tokens resolve to. The SPA serves the
/// `/s/:token` route behind this origin.
const SHARE_URL_BASE: &str = "https://aura.ai/s/";

/// How many leading characters of a share token are safe to log. The
/// token is a capability secret, so only a short prefix is emitted for
/// correlation — never the full value.
const TOKEN_LOG_PREFIX_LEN: usize = 6;

/// Response body for `POST .../share`. Serialized camelCase to match
/// the frontend `createSessionShare` contract (`{ shareId, url }`),
/// consistent with the other camelCase DTOs in this crate.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CreateShareResponse {
    /// The public share token (`t_<32 hex>`).
    share_id: String,
    /// Fully-qualified public URL the token resolves to.
    url: String,
}

/// Create (or reuse) a public share link for a session the caller owns.
///
/// Ownership is verified the same way
/// [`crate::handlers::agents::list_session_events`] gates its reads: the
/// session is loaded with the caller's JWT, so aura-storage rejects any
/// session the caller cannot see (surfaced here as 404). Idempotent —
/// an already-public session reuses its existing token so previously
/// shared links stay valid instead of minting a new one each click.
pub(crate) async fn create_session_share(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    AuthSession(session): AuthSession,
    headers: HeaderMap,
    Path((project_id, agent_instance_id, session_id)): Path<(
        ProjectId,
        AgentInstanceId,
        SessionId,
    )>,
) -> ApiResult<Json<CreateShareResponse>> {
    let user_agent = headers
        .get("user-agent")
        .and_then(|v| v.to_str().ok())
        .map(str::to_owned);
    let storage = state.require_storage_client()?;
    let sid = session_id.to_string();

    let existing = storage
        .get_session(&sid, &jwt)
        .await
        .map_err(|e| match &e {
            aura_os_storage::StorageError::Server { status: 404, .. } => {
                ApiError::not_found("session not found")
            }
            _ => map_storage_error(e),
        })?;

    // Idempotent reuse: a session that is already public keeps its
    // existing token so links shared earlier keep resolving.
    if existing.is_public == Some(true) {
        if let Some(token) = existing.public_share_id {
            track_share_link_generated(
                &state,
                &session.user_id,
                &session_id,
                &project_id,
                &agent_instance_id,
                true,
                user_agent.as_deref(),
            );
            return Ok(Json(build_response(token)));
        }
    }

    let token = format!("t_{}", uuid::Uuid::new_v4().simple());
    storage
        .update_session(
            &sid,
            &jwt,
            &UpdateSessionRequest {
                is_public: Some(true),
                public_share_id: Some(token.clone()),
                ..Default::default()
            },
        )
        .await
        .map_err(map_storage_error)?;

    let prefix: String = token.chars().take(TOKEN_LOG_PREFIX_LEN).collect();
    info!(session_id = %sid, token_prefix = %prefix, "Created public session share");
    track_share_link_generated(
        &state,
        &session.user_id,
        &session_id,
        &project_id,
        &agent_instance_id,
        false,
        user_agent.as_deref(),
    );

    Ok(Json(build_response(token)))
}

#[allow(clippy::too_many_arguments)]
fn track_share_link_generated(
    state: &AppState,
    owner_user_id: &str,
    session_id: &SessionId,
    project_id: &ProjectId,
    agent_instance_id: &AgentInstanceId,
    reused: bool,
    user_agent: Option<&str>,
) {
    if let Some(mixpanel) = &state.mixpanel {
        let mut properties = json!({
            "session_id": session_id.to_string(),
            "project_id": project_id.to_string(),
            "agent_instance_id": agent_instance_id.to_string(),
            "reused": reused,
        });
        // Derive the same `$os` the client SDK reports so this
        // server-emitted event isn't bucketed as `$os = "(not set)"`.
        if let Some(os) = crate::mixpanel::os_from_user_agent(user_agent) {
            if let Some(map) = properties.as_object_mut() {
                map.insert("$os".to_string(), json!(os));
            }
        }
        mixpanel.track_event(
            crate::mixpanel::EVENT_SHARE_LINK_GENERATED,
            owner_user_id,
            properties,
        );
    }
}

/// Assemble the `{ shareId, url }` response from a share token.
fn build_response(token: String) -> CreateShareResponse {
    let url = format!("{SHARE_URL_BASE}{token}");
    CreateShareResponse {
        share_id: token,
        url,
    }
}
