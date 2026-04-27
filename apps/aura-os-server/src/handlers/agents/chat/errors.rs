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
const HARNESS_TURN_IN_PROGRESS_CODE: &str = "turn_in_progress";

/// Substring of the raw harness error message ("A turn is currently
/// in progress; send cancel first") used as a fallback when the
/// `code` field is missing or stale.
const HARNESS_TURN_IN_PROGRESS_MESSAGE_FRAGMENT: &str = "turn is currently in progress";

/// Single source of truth for the user-visible "agent is busy with
/// another turn" wording. Used by both the structured API-error
/// remap (`remap_harness_error_to_api`) and the in-stream SSE remap
/// (`remap_harness_error_to_sse`) so the frontend sees one
/// consistent message regardless of which path surfaced the
/// conflict.
const AGENT_BUSY_CONCURRENT_TURN_MESSAGE: &str =
    "Agent is currently running another turn. Please wait.";

/// True when this `ErrorMsg` matches the harness "turn already in
/// progress" condition — either by the canonical
/// `turn_in_progress` code or by the legacy raw message string.
fn is_turn_in_progress(err: &ErrorMsg) -> bool {
    err.code == HARNESS_TURN_IN_PROGRESS_CODE
        || err
            .message
            .to_ascii_lowercase()
            .contains(HARNESS_TURN_IN_PROGRESS_MESSAGE_FRAGMENT)
}

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
    if is_turn_in_progress(err) {
        return Some(ApiError::agent_busy(
            AGENT_BUSY_CONCURRENT_TURN_MESSAGE,
            None,
        ));
    }
    None
}

/// In-stream variant of [`remap_harness_error_to_api`]. Returns a
/// cleaned [`ErrorMsg`] with the canonical `agent_busy` code and
/// the same user-visible wording the structured API path uses,
/// preserving the upstream `recoverable` flag. Returns `None` for
/// any other error so callers pass the original event through
/// unchanged.
///
/// Used by the chat SSE forwarder to swap out a mid-stream
/// `HarnessOutbound::Error { code: "turn_in_progress", … }` (which
/// happens when a `UserMessage` races an in-flight turn on the
/// same partition — e.g. fast double-click on send) for a
/// structured `agent_busy` error event before closing the stream,
/// so the UI never sees the raw harness wording.
pub(super) fn remap_harness_error_to_sse(err: &ErrorMsg) -> Option<ErrorMsg> {
    if !is_turn_in_progress(err) {
        return None;
    }
    Some(ErrorMsg {
        code: "agent_busy".to_string(),
        message: AGENT_BUSY_CONCURRENT_TURN_MESSAGE.to_string(),
        recoverable: err.recoverable,
    })
}

pub(super) fn map_session_bridge_start_error(
    key: &str,
    harness_mode: HarnessMode,
    ws_slots_cap: usize,
) -> impl FnOnce(SessionBridgeError) -> (StatusCode, Json<ApiError>) + '_ {
    move |err| {
        warn!(
            session_key = key,
            ?harness_mode,
            error = %err,
            "Failed to open delegated harness chat session"
        );
        map_session_bridge_error(err, ws_slots_cap)
    }
}

pub(super) fn map_session_bridge_error(
    err: SessionBridgeError,
    ws_slots_cap: usize,
) -> (StatusCode, Json<ApiError>) {
    match err {
        SessionBridgeError::Open(message) => map_harness_session_startup_error(&message),
        SessionBridgeError::Send(message) => {
            ApiError::internal(format!("sending user message: {message}"))
        }
        SessionBridgeError::CapacityExhausted(_) => {
            ApiError::harness_capacity_exhausted(ws_slots_cap)
        }
    }
}

/// Single source of truth for "translate a raw `harness.open_session`
/// failure into an [`ApiError`]". Used by the non-chat session-open
/// call sites (runtime, specs gen, task extraction) which receive an
/// `anyhow::Error` rather than a typed [`SessionBridgeError`]. The
/// chat path goes through [`map_session_bridge_error`] which has its
/// own typed variants but funnels capacity exhaustion to the same
/// `ApiError::harness_capacity_exhausted` constructor.
///
/// `fallback` is invoked for non-capacity errors so each caller keeps
/// its own context-specific wording (e.g. "opening spec gen session").
///
/// See `crates/aura-os-harness/src/error.rs` for the upstream
/// detection contract — both [`HarnessError::is_capacity_exhausted`]
/// and `SessionBridgeError::CapacityExhausted` resolve to the same
/// 503 here.
pub(crate) fn map_harness_error_to_api(
    err: &anyhow::Error,
    ws_slots_cap: usize,
    fallback: impl FnOnce(&anyhow::Error) -> (StatusCode, Json<ApiError>),
) -> (StatusCode, Json<ApiError>) {
    if aura_os_harness::HarnessError::is_capacity_exhausted(err) {
        ApiError::harness_capacity_exhausted(ws_slots_cap)
    } else {
        fallback(err)
    }
}

pub(super) fn map_harness_session_startup_error(message: &str) -> (StatusCode, Json<ApiError>) {
    let normalized = message.to_ascii_lowercase();

    if normalized.contains("invalid_provider_config")
        || normalized.contains("unsupported session provider")
    {
        return ApiError::bad_gateway(format!(
            "agent runtime provider is not supported by this harness: {message}"
        ));
    }

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

    #[test]
    fn remap_harness_error_to_sse_matches_canonical_code() {
        let mut original = err("turn_in_progress", "anything");
        original.recoverable = true;
        let mapped = remap_harness_error_to_sse(&original)
            .expect("turn_in_progress code should remap to agent_busy");
        assert_eq!(mapped.code, "agent_busy");
        assert_eq!(mapped.message, AGENT_BUSY_CONCURRENT_TURN_MESSAGE);
        assert!(
            mapped.recoverable,
            "recoverable flag from upstream must be preserved"
        );
    }

    #[test]
    fn remap_harness_error_to_sse_falls_back_to_message_string() {
        let mapped = remap_harness_error_to_sse(&err(
            "internal_error",
            "A turn is currently in progress; send cancel first",
        ))
        .expect("legacy raw message should remap to agent_busy");
        assert_eq!(mapped.code, "agent_busy");
        assert_eq!(mapped.message, AGENT_BUSY_CONCURRENT_TURN_MESSAGE);
    }

    #[test]
    fn remap_harness_error_to_sse_passes_through_unrelated_errors() {
        assert!(remap_harness_error_to_sse(&err("something_else", "boom")).is_none());
    }

    #[test]
    fn map_harness_error_to_api_capacity_exhausted_remaps_to_503() {
        let err = anyhow::Error::new(aura_os_harness::HarnessError::CapacityExhausted)
            .context("upstream WS slots full");
        let (status, Json(body)) = map_harness_error_to_api(&err, 96, |_| {
            unreachable!("capacity errors must NOT hit the fallback");
        });
        assert_eq!(status, StatusCode::SERVICE_UNAVAILABLE);
        assert_eq!(body.code, "harness_capacity_exhausted");
        let data = body
            .data
            .as_ref()
            .expect("structured data must be populated");
        assert_eq!(data["configured_cap"], 96);
        assert_eq!(data["retry_after_seconds"], 5);
    }

    #[test]
    fn map_harness_error_to_api_non_capacity_uses_fallback() {
        let err = anyhow::anyhow!("DNS lookup failed");
        let (status, Json(body)) = map_harness_error_to_api(&err, 128, |e| {
            ApiError::bad_gateway(format!("opening session: {e}"))
        });
        assert_eq!(status, StatusCode::BAD_GATEWAY);
        assert_ne!(body.code, "harness_capacity_exhausted");
        assert!(
            body.error.contains("DNS lookup failed"),
            "fallback wording must be preserved, got: {}",
            body.error
        );
    }

    #[test]
    fn map_session_bridge_error_capacity_exhausted_remaps_to_503() {
        let err = SessionBridgeError::CapacityExhausted("upstream WS slots full".to_string());
        let (status, Json(body)) = map_session_bridge_error(err, 96);
        assert_eq!(status, StatusCode::SERVICE_UNAVAILABLE);
        assert_eq!(body.code, "harness_capacity_exhausted");
        let data = body
            .data
            .as_ref()
            .expect("structured data must be populated");
        assert_eq!(data["configured_cap"], 96);
    }

    #[test]
    fn map_session_bridge_error_send_returns_internal() {
        let err = SessionBridgeError::Send("channel closed".to_string());
        let (status, Json(body)) = map_session_bridge_error(err, 128);
        assert_eq!(status, StatusCode::INTERNAL_SERVER_ERROR);
        assert_ne!(body.code, "harness_capacity_exhausted");
    }

    #[test]
    fn map_startup_error_explains_unsupported_provider_config() {
        let (status, Json(body)) = map_harness_session_startup_error(
            "Harness error during init (invalid_provider_config): unsupported session provider `aura_proxy`",
        );

        assert_eq!(status, StatusCode::BAD_GATEWAY);
        assert!(body.error.contains("provider is not supported"));
    }
}
