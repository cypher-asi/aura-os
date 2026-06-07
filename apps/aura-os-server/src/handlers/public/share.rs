//! Public (unauthenticated) read of a shared session transcript.
//!
//! Mirrors the unauthenticated `pub_list_feedback` shape — no JWT and
//! no guest token. The viewer has no credentials, so aura-os-server
//! resolves the shared session with its own `X-Internal-Token`
//! (`AURA_STORAGE_INTERNAL_TOKEN`) and only serves the transcript when
//! the owner has flipped `is_public`. The `public_share_id` is a
//! capability token: it is validated at the storage-client boundary
//! (`validate_share_token`) and only a short prefix is ever logged.

use axum::extract::{Path, State};
use axum::http::HeaderMap;
use axum::Json;
use tracing::info;

use aura_os_core::SessionEvent;

use crate::error::{map_storage_error, ApiError, ApiResult};
use crate::handlers::agents::conversions_pub::events_to_session_history;
use crate::state::AppState;

/// How many leading characters of a share token are safe to log.
const TOKEN_LOG_PREFIX_LEN: usize = 6;

/// `GET /api/public/share/:token`. Resolves a public share token to a
/// read-only transcript rendered the same way the authenticated
/// `list_session_events` handler renders history.
///
/// Returns 404 when the token is unknown / malformed, the session is
/// not (or no longer) public, or its events cannot be loaded — a
/// private session must never leak through this anonymous path.
pub(crate) async fn get_public_share(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(token): Path<String>,
) -> ApiResult<Json<Vec<SessionEvent>>> {
    let storage = state.require_storage_client()?;
    let prefix: String = token.chars().take(TOKEN_LOG_PREFIX_LEN).collect();

    let session = storage
        .get_session_by_share_internal(&token)
        .await
        .map_err(|e| match &e {
            // Unknown token (404) or a malformed token rejected by the
            // boundary validator both resolve to "no such share".
            aura_os_storage::StorageError::Server { status: 404, .. }
            | aura_os_storage::StorageError::Validation(_) => {
                ApiError::not_found("share not found")
            }
            _ => {
                info!(token_prefix = %prefix, error = %e, "public share lookup failed");
                map_storage_error(e)
            }
        })?;

    if session.is_public != Some(true) {
        return Err(ApiError::not_found("share not found"));
    }

    let events = storage
        .list_events_internal(&session.id)
        .await
        .map_err(|e| {
            info!(token_prefix = %prefix, error = %e, "public share events load failed");
            map_storage_error(e)
        })?;

    // Project to the same UI history shape `list_session_events`
    // returns. `project_agent_id` may be absent on older rows; fall back
    // to the session id so the event→message conversion still yields a
    // stable, render-safe agent instance id.
    let project_agent_id = session
        .project_agent_id
        .clone()
        .unwrap_or_else(|| session.id.clone());
    let project_id = session.project_id.clone().unwrap_or_default();
    let messages = events_to_session_history(&events, &project_agent_id, &project_id);
    let event_count = session
        .event_count
        .or_else(|| u32::try_from(events.len()).ok());
    if let Some(mixpanel) = &state.mixpanel {
        let user_agent = headers.get("user-agent").and_then(|v| v.to_str().ok());
        mixpanel.track_share_link_opened(
            &token,
            &session.id,
            !messages.is_empty(),
            event_count,
            user_agent,
        );
    }

    Ok(Json(messages))
}
