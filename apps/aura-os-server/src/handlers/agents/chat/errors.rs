//! Error mapping helpers for the chat handler — translate harness /
//! session-bridge / storage failures into user-facing API errors.

use aura_os_core::HarnessMode;
use aura_os_harness::{ErrorMsg, SessionBridgeError};
use axum::http::StatusCode;
use axum::Json;
use tracing::warn;

use crate::error::ApiError;

/// Wire-level error code emitted by aura-harness when a new
/// `UserMessage` arrives on an agent that already has a turn in flight.
#[allow(dead_code)] // wired up by callers in Phase 1 of robust-concurrent-agent-infra
const HARNESS_TURN_IN_PROGRESS_CODE: &str = "turn_in_progress";

/// Substring of the raw harness error message ("A turn is currently
/// in progress; send cancel first") used as a fallback when the
/// `code` field is missing or stale.
#[allow(dead_code)] // wired up by callers in Phase 1 of robust-concurrent-agent-infra
const HARNESS_TURN_IN_PROGRESS_MESSAGE_FRAGMENT: &str = "turn is currently in progress";

/// Recognize a harness `Error` event that means "this agent already
/// has a turn in flight" and remap it to the structured
/// [`ApiError::agent_busy`] response so the frontend can render the
/// "stop automation to chat" affordance instead of leaking the raw
/// upstream wording.
///
/// Returns `Some` for the turn-in-progress condition (matched either
/// by the canonical `turn_in_progress` code or by the legacy raw
/// message string), `None` otherwise so the caller passes the event
/// through unchanged.
///
/// Phase 0: this helper is exposed for callers that already inspect
/// harness `ErrorMsg`s; the swarm HTTP path still surfaces 4xx bodies
/// as flattened anyhow strings — Phase 0.5 will converge those paths
/// onto a structured wire shape we can match here.
#[allow(dead_code)] // wired up by callers in Phase 1 of robust-concurrent-agent-infra
pub(crate) fn remap_harness_error_to_api(err: &ErrorMsg) -> Option<(StatusCode, Json<ApiError>)> {
    if err.code == HARNESS_TURN_IN_PROGRESS_CODE
        || err
            .message
            .to_ascii_lowercase()
            .contains(HARNESS_TURN_IN_PROGRESS_MESSAGE_FRAGMENT)
    {
        return Some(ApiError::agent_busy(
            "Agent is currently running another turn. Please wait.",
            None,
        ));
    }
    None
}

pub(super) fn map_session_bridge_start_error(
    key: &str,
    harness_mode: HarnessMode,
) -> impl FnOnce(SessionBridgeError) -> (StatusCode, Json<ApiError>) + '_ {
    move |err| {
        warn!(
            session_key = key,
            ?harness_mode,
            error = %err,
            "Failed to open delegated harness chat session"
        );
        map_session_bridge_error(err)
    }
}

pub(super) fn map_session_bridge_error(err: SessionBridgeError) -> (StatusCode, Json<ApiError>) {
    match err {
        SessionBridgeError::Open(message) => map_harness_session_startup_error(&message),
        SessionBridgeError::Send(message) => {
            ApiError::internal(format!("sending user message: {message}"))
        }
    }
}

pub(super) fn map_harness_session_startup_error(message: &str) -> (StatusCode, Json<ApiError>) {
    let normalized = message.to_ascii_lowercase();

    if normalized.contains("swarm gateway is not configured") {
        return ApiError::service_unavailable(
            "remote agent runtime is not configured (SWARM_BASE_URL)",
        );
    }

    if normalized.contains("did not become ready within")
        || normalized.contains("entered error state")
    {
        return ApiError::service_unavailable(format!(
            "remote agent is still provisioning or unavailable: {message}"
        ));
    }

    if normalized.contains("swarm create agent request failed")
        || normalized.contains("swarm create session request failed")
        || normalized.contains("swarm create agent failed with")
        || normalized.contains("swarm create session failed with")
        || normalized.contains("swarm agent readiness check failed")
        || normalized.contains("swarm websocket")
    {
        return ApiError::bad_gateway(format!("remote agent runtime startup failed: {message}"));
    }

    if normalized.contains("local harness websocket connect failed") {
        return ApiError::service_unavailable(format!("local harness is unavailable: {message}"));
    }

    if normalized.contains("local harness session_init send failed")
        || normalized.contains("harness error during init")
        || normalized.contains("connection closed before session_ready")
    {
        return ApiError::bad_gateway(format!("local harness startup failed: {message}"));
    }

    ApiError::internal(format!("opening harness session: {message}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn err(code: &str, message: &str) -> ErrorMsg {
        ErrorMsg {
            code: code.to_string(),
            message: message.to_string(),
            recoverable: false,
        }
    }

    #[test]
    fn remap_harness_error_to_api_matches_canonical_code() {
        let mapped = remap_harness_error_to_api(&err("turn_in_progress", "anything"))
            .expect("turn_in_progress code should remap to agent_busy");
        let (status, Json(body)) = mapped;
        assert_eq!(status, StatusCode::CONFLICT);
        assert_eq!(body.code, "agent_busy");
    }

    #[test]
    fn remap_harness_error_to_api_falls_back_to_message_string() {
        let mapped = remap_harness_error_to_api(&err(
            "internal_error",
            "A turn is currently in progress; send cancel first",
        ))
        .expect("legacy raw message should remap to agent_busy");
        let (status, Json(body)) = mapped;
        assert_eq!(status, StatusCode::CONFLICT);
        assert_eq!(body.code, "agent_busy");
    }

    #[test]
    fn remap_harness_error_to_api_passes_through_unrelated_errors() {
        let result = remap_harness_error_to_api(&err("something_else", "boom"));
        assert!(result.is_none());
    }
}
