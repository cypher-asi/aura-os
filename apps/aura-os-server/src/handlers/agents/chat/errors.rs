//! Error mapping helpers for the chat handler — translate harness /
//! session-bridge / storage failures into user-facing API errors.

use aura_os_core::HarnessMode;
use aura_os_harness::{ErrorMsg, SessionBridgeError};
use axum::http::StatusCode;
use axum::Json;
use tracing::warn;

use crate::error::ApiError;

/// Generate a short, user-friendly support ID stamped onto every
/// SSE-bound `ErrorMsg` so users can paste it back in feedback and
/// support can join their report to server logs immediately.
///
/// 12 lowercase hex chars (~48 bits of entropy) is plenty for
/// support-bundle disambiguation without leaking PII or asking users
/// to copy a 32-char UUID. Sourced from a v4 UUID — `uuid` is already
/// a workspace dependency, so no new crate is pulled in.
pub(crate) fn fresh_support_id() -> String {
    uuid::Uuid::new_v4().simple().to_string()[..12].to_string()
}

/// Stamp `err` in place with a fresh `support_id` and a stable
/// machine-readable `code`. The id is appended to the human-readable
/// message as `(support_id=<id>)` because the `aura_os_harness::ErrorMsg`
/// wire type does not yet carry a first-class `support_id` field —
/// Phase 6 will promote it. Returns the stamped id so the caller can
/// re-emit it on its own log line if it has additional context to
/// attach (agent_id, session_id, project_id, …).
///
/// Also emits a single structured tracing record:
/// - `tracing::warn!` for `recoverable: true` (user can retry, e.g.
///   `stream_stalled` / `turn_timeout`).
/// - `tracing::error!` for non-recoverable errors that terminated
///   the turn from the server's perspective.
pub(crate) fn stamp_support_id(err: &mut ErrorMsg, code: &str) -> String {
    // Reuse a pre-populated id (Phase 6 in-process sites such as the
    // harness `agent_stalled` emitter and the watchdog
    // `stream_stalled`/`turn_timeout` synth pre-stamp the field) so a
    // single error never carries two different ids on different
    // surfaces. Mint fresh only when neither side has done it.
    let id = err.support_id.clone().unwrap_or_else(fresh_support_id);
    err.code = code.to_string();
    // Avoid double-suffixing on retries: if the message already
    // contains the canonical suffix, leave it alone.
    if !err.message.contains("(support_id=") {
        err.message = format!("{} (support_id={id})", err.message);
    }
    err.support_id = Some(id.clone());
    if err.recoverable {
        tracing::warn!(
            support_id = %id,
            code = %err.code,
            recoverable = err.recoverable,
            message = %err.message,
            "SSE-bound harness error stamped with support_id"
        );
    } else {
        tracing::error!(
            support_id = %id,
            code = %err.code,
            recoverable = err.recoverable,
            message = %err.message,
            "SSE-bound harness error stamped with support_id"
        );
    }
    id
}

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
/// cleaned [`ErrorMsg`] suitable for forwarding to the SSE wire,
/// with two responsibilities:
///
/// 1. **Code/message normalization.** Turn-in-progress errors are
///    rewritten to the canonical `agent_busy` code + the same
///    user-visible wording the structured API path uses, so the UI
///    never has to string-match raw upstream wording. Other error
///    codes pass through unchanged (preserving the upstream
///    `recoverable` flag in both cases).
/// 2. **Support-ID stamping.** Phase 3 of the agent-stuck-and-reset
///    plan: every error that hits the SSE wire carries a short
///    `support_id` appended to its message as `(support_id=<id>)`,
///    and a structured tracing record (`warn!` / `error!`) is
///    emitted with the same id so user-reported support_ids join
///    cleanly to server logs. The `aura_os_harness::ErrorMsg` wire
///    type does not yet carry a first-class field — Phase 6 will
///    promote it.
///
/// Always returns `Some(_)` since every SSE-bound error must carry a
/// support_id. Returning a fresh `ErrorMsg` (rather than mutating in
/// place) keeps the caller's match expression cheap to read.
pub(super) fn remap_harness_error_to_sse(err: &ErrorMsg) -> ErrorMsg {
    let (code, message) = if is_turn_in_progress(err) {
        (
            "agent_busy".to_string(),
            AGENT_BUSY_CONCURRENT_TURN_MESSAGE.to_string(),
        )
    } else {
        (err.code.clone(), err.message.clone())
    };
    let mut new_err = ErrorMsg {
        code: code.clone(),
        message,
        recoverable: err.recoverable,
        // `support_id` is a first-class field, but many emit sites
        // still leave it `None`. Inherit whatever the upstream sender
        // already stamped (the harness's agent-loop terminal error
        // path pre-populates this) and let `stamp_support_id` mint a
        // fresh id only when neither side has set one.
        support_id: err.support_id.clone(),
    };
    let _ = stamp_support_id(&mut new_err, &code);
    new_err
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
    } else if let Some((field, context)) =
        aura_os_harness::HarnessError::session_identity_missing(err)
    {
        // Tier 2: the harness rejected our runtime_request payload
        // because one of the required `X-Aura-*` identity fields is
        // missing. Funnel into the same 422 shape Tier 1 emits so
        // server / harness drift stays observable as one error code
        // regardless of which side caught it.
        ApiError::session_identity_missing(field, context)
    } else if let Some((status, _body)) = aura_os_harness::HarnessError::upstream_status(err) {
        // The harness answered `POST /v1/run` with a non-2xx status.
        // A 404 means the route is missing (stale/incompatible harness
        // build or a misrouted base URL); other statuses mean the
        // harness rejected the run. Map both to a clear 502 so
        // non-chat callers (runtime test, spec gen) get the same
        // actionable wording instead of a generic 500.
        map_harness_upstream_status(status)
    } else {
        fallback(err)
    }
}

/// Shared 502 wording for a harness `POST /v1/run` non-2xx open
/// failure. A 404 is special-cased because it almost always means the
/// harness is unreachable or running a build that predates the
/// `/v1/run` route (or the base URL points at the wrong service);
/// every other status is surfaced verbatim so operators can see what
/// the harness actually returned.
fn map_harness_upstream_status(status: u16) -> (StatusCode, Json<ApiError>) {
    if status == 404 {
        ApiError::bad_gateway(
            "agent runtime endpoint not found (404): the harness is unreachable or \
             running an incompatible version. Verify the harness deployment and the \
             LOCAL_HARNESS_URL / SWARM_BASE_URL configuration.",
        )
    } else {
        ApiError::bad_gateway(format!("agent runtime returned status {status}"))
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

    if normalized.contains("local harness post /v1/run failed") {
        return ApiError::service_unavailable(format!(
            "local agent runtime is unavailable. Aura could not reach its managed harness; \
             restart Aura to retry recovery. Details: {message}"
        ));
    }

    if normalized.contains("harness error during init")
        || normalized.contains("connection closed before session_ready")
    {
        return ApiError::bad_gateway(format!("local harness startup failed: {message}"));
    }

    // The harness HTTP server answered the `POST /v1/run` open with a
    // non-2xx status (the `HarnessError::UpstreamStatus` Display).
    // A 404 means a server is listening at the harness base URL but
    // has no `/v1/run` route — almost always a stale/incompatible
    // harness build (predating the `/v1/run` migration) or a
    // misrouted `LOCAL_HARNESS_URL`/`SWARM_BASE_URL`. Surface a clear
    // 502 instead of letting it fall through to a generic 500.
    if normalized.contains("returned status") && normalized.contains("/v1/run") {
        if normalized.contains("status 404") {
            return ApiError::bad_gateway(
                "agent runtime endpoint not found (404): the harness is unreachable or \
                 running an incompatible version. Verify the harness deployment and the \
                 LOCAL_HARNESS_URL / SWARM_BASE_URL configuration.",
            );
        }
        return ApiError::bad_gateway(format!("agent runtime rejected the session: {message}"));
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
            support_id: None,
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
        let mapped = remap_harness_error_to_sse(&original);
        assert_eq!(mapped.code, "agent_busy");
        assert!(
            mapped
                .message
                .starts_with(AGENT_BUSY_CONCURRENT_TURN_MESSAGE),
            "remapped message must keep the canonical wording prefix, got: {}",
            mapped.message
        );
        assert!(
            mapped.message.contains("(support_id="),
            "remapped message must carry a support_id suffix, got: {}",
            mapped.message
        );
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
        ));
        assert_eq!(mapped.code, "agent_busy");
        assert!(
            mapped
                .message
                .starts_with(AGENT_BUSY_CONCURRENT_TURN_MESSAGE),
            "legacy-message remap must still produce the canonical wording, got: {}",
            mapped.message
        );
        assert!(
            mapped.message.contains("(support_id="),
            "legacy-message remap must still stamp a support_id, got: {}",
            mapped.message
        );
    }

    /// Phase 3: every SSE-bound `ErrorMsg` carries a support_id, even
    /// the unrelated upstream errors that previously passed through
    /// untouched. The original `code` and human-readable message are
    /// preserved (only suffixed with `(support_id=…)`), so existing
    /// classifier branches in the client still match.
    #[test]
    fn remap_harness_error_to_sse_stamps_unrelated_errors_with_support_id() {
        let original = err("something_else", "boom");
        let mapped = remap_harness_error_to_sse(&original);
        assert_eq!(
            mapped.code, "something_else",
            "non-busy errors must keep their upstream code"
        );
        assert!(
            mapped.message.starts_with("boom"),
            "non-busy errors must keep their upstream message text, got: {}",
            mapped.message
        );
        assert!(
            mapped.message.contains("(support_id="),
            "every SSE-bound error must carry a support_id suffix, got: {}",
            mapped.message
        );
    }

    /// Phase 3: the stamped support_id must be 12 lowercase hex chars
    /// — short enough to be user-friendly for "paste this id into
    /// feedback" but with enough entropy to disambiguate concurrent
    /// failures in support bundles.
    #[test]
    fn fresh_support_id_is_12_lowercase_hex_chars() {
        let id = fresh_support_id();
        assert_eq!(id.len(), 12, "support_id must be 12 chars, got: {id}");
        assert!(
            id.chars()
                .all(|c| c.is_ascii_hexdigit() && !c.is_uppercase()),
            "support_id must be lowercase hex only, got: {id}"
        );
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
    fn map_harness_error_to_api_session_identity_remaps_to_422() {
        let err = anyhow::Error::new(aura_os_harness::HarnessError::SessionIdentityMissing {
            field: "aura_org_id",
            context: "runtime_request",
        })
        .context("local harness rejected runtime_request: identity preflight");
        let (status, Json(body)) = map_harness_error_to_api(&err, 96, |_| {
            unreachable!("session_identity_missing must NOT hit the fallback");
        });
        assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
        assert_eq!(body.code, "missing_aura_org_id");
        let data = body.data.expect("structured data must be populated");
        assert_eq!(data["code"], "session_identity_missing");
        assert_eq!(data["field"], "aura_org_id");
        assert_eq!(data["context"], "runtime_request");
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
}
