//! Error mapping helpers for the chat handler — translate harness /
//! session-bridge / storage failures into user-facing API errors.

use aura_os_core::HarnessMode;
use aura_os_harness::SessionBridgeError;
use axum::http::StatusCode;
use axum::Json;
use tracing::warn;

use crate::error::ApiError;

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
