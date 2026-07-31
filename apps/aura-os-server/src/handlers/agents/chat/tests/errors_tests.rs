//! Tests for the harness/session error → API error mapper.

use axum::http::StatusCode;

use super::super::errors::{map_harness_error_to_api, map_harness_session_startup_error};

#[test]
fn maps_swarm_configuration_errors_to_service_unavailable() {
    let (status, body) =
        map_harness_session_startup_error("swarm gateway is not configured (SWARM_BASE_URL)");

    assert_eq!(status, StatusCode::SERVICE_UNAVAILABLE);
    assert_eq!(body.0.code, "service_unavailable");
}

#[test]
fn maps_swarm_readiness_errors_to_service_unavailable() {
    let (status, body) = map_harness_session_startup_error(
        "swarm agent readiness check failed: agent abc did not become ready within 90s",
    );

    assert_eq!(status, StatusCode::SERVICE_UNAVAILABLE);
    assert_eq!(body.0.code, "service_unavailable");
    assert!(body.0.error.contains("still provisioning"));
}

#[test]
fn maps_swarm_session_start_errors_to_bad_gateway() {
    let (status, body) = map_harness_session_startup_error(
        "swarm create session failed with 502 Bad Gateway: upstream unavailable",
    );

    assert_eq!(status, StatusCode::BAD_GATEWAY);
    assert_eq!(body.0.code, "bad_gateway");
}

#[test]
fn maps_local_harness_connect_errors_to_service_unavailable() {
    let (status, body) =
        map_harness_session_startup_error("local harness websocket connect failed");

    assert_eq!(status, StatusCode::SERVICE_UNAVAILABLE);
    assert_eq!(body.0.code, "service_unavailable");
}

#[test]
fn maps_local_harness_run_transport_failure_to_service_unavailable() {
    let (status, body) = map_harness_session_startup_error(
        "harness POST /v1/run transport failure: local harness POST /v1/run failed: \
         error sending request for url (http://127.0.0.1:19080/v1/run)",
    );

    assert_eq!(status, StatusCode::SERVICE_UNAVAILABLE);
    assert_eq!(body.0.code, "service_unavailable");
    assert!(body.0.error.contains("managed harness"));
    assert!(!body.0.error.contains("localhost:8080"));
}

#[test]
fn maps_v1_run_404_to_bad_gateway_with_actionable_message() {
    // The `HarnessError::UpstreamStatus` Display string, flattened
    // through `SessionBridgeError::Open` on the chat cold-open path.
    let (status, body) =
        map_harness_session_startup_error("harness POST /v1/run returned status 404: ");

    assert_eq!(status, StatusCode::BAD_GATEWAY);
    assert_eq!(body.0.code, "bad_gateway");
    assert!(
        body.0.error.contains("incompatible version"),
        "404 should explain the harness is unreachable/incompatible, got: {}",
        body.0.error
    );
}

#[test]
fn maps_v1_run_non_404_status_to_bad_gateway() {
    let (status, body) =
        map_harness_session_startup_error("harness POST /v1/run returned status 500: boom");

    assert_eq!(status, StatusCode::BAD_GATEWAY);
    assert_eq!(body.0.code, "bad_gateway");
}

#[test]
fn typed_upstream_404_maps_to_bad_gateway() {
    let err = anyhow::Error::new(aura_os_harness::HarnessError::UpstreamStatus {
        status: 404,
        body: String::new(),
    });
    let (status, body) = map_harness_error_to_api(&err, 8, |_| fallback_marker());

    assert_eq!(status, StatusCode::BAD_GATEWAY);
    assert_eq!(body.0.code, "bad_gateway");
    assert!(body.0.error.contains("incompatible version"));
}

/// Sentinel fallback used by `typed_upstream_404_maps_to_bad_gateway`
/// to prove the upstream-status branch is taken BEFORE the fallback:
/// if the fallback ever runs the test fails on the 500 status.
fn fallback_marker() -> (StatusCode, axum::Json<crate::error::ApiError>) {
    crate::error::ApiError::internal("fallback should not be reached")
}
