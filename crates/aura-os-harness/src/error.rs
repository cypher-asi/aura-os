//! Typed errors emitted by harness session-open paths.
//!
//! Both [`crate::LocalHarness::open_session`] and
//! [`crate::SwarmHarness::open_session`] return `anyhow::Result` so
//! their callers can stay generic over the underlying transport
//! failure mode. When a failure mode is operationally meaningful
//! to the server (today: the upstream WS-slot semaphore is
//! exhausted), we wrap a typed [`HarnessError`] inside the
//! `anyhow::Error` so callers can recover the structured variant via
//! `err.downcast_ref::<HarnessError>()` without scraping flattened
//! error strings.
//!
//! See `crates/aura-os-harness/src/automaton_client.rs` lines 33-34
//! for the operational background: aura-node caps concurrent WS
//! sessions per harness process at 128 by default. Phase 6 of the
//! robust-concurrent-agent-infra plan makes that cap configurable
//! end-to-end via `AURA_HARNESS_WS_SLOTS` and surfaces exhaustion as
//! a clean 503 instead of a raw upstream rejection string.

/// Operationally meaningful failure modes that
/// [`crate::HarnessLink::open_session`] can produce.
///
/// Any other failure (DNS, TLS, malformed JSON body, etc.) stays as
/// a plain `anyhow::Error` because the server's reaction to it is
/// the same generic `bad_gateway` / `service_unavailable` mapping
/// already implemented in
/// `apps/aura-os-server/src/handlers/agents/chat/errors.rs::map_harness_session_startup_error`.
#[derive(Debug, thiserror::Error)]
pub enum HarnessError {
    /// Upstream harness rejected the new session because all WS
    /// slots in its semaphore are in use. Detected by:
    ///
    /// * [`crate::SwarmHarness::open_session`] when the
    ///   `POST /v1/agents/:id/sessions` HTTP response is `503` and the
    ///   body either has `code: "capacity_exhausted"` or is opaque.
    /// * [`crate::LocalHarness::open_session`] when
    ///   `tokio_tungstenite::connect_async` returns
    ///   `tungstenite::Error::Http` with a `503` status, OR when the
    ///   WS server closes the upgrade with a `1013 Try Again Later`
    ///   close code before sending any frames.
    ///
    /// The server side maps this to
    /// `ApiError::harness_capacity_exhausted` using its own configured
    /// cap (`AppState::harness_ws_slots`, sourced from
    /// `AURA_HARNESS_WS_SLOTS`). The variant intentionally does not
    /// carry the cap because the harness lib does not know it — the
    /// server owns that env var and may even configure it differently
    /// from the actual upstream value.
    #[error(
        "upstream harness rejected new session: WS slot capacity exhausted (HTTP 503 / WS 1013)"
    )]
    CapacityExhausted,
}

impl HarnessError {
    /// Returns `true` when the given `anyhow::Error` carries a
    /// [`HarnessError::CapacityExhausted`] cause anywhere in its
    /// chain. Use this from callers that already have an
    /// `anyhow::Error` in hand (e.g. inside
    /// `SessionBridgeError::Open`).
    #[must_use]
    pub fn is_capacity_exhausted(err: &anyhow::Error) -> bool {
        err.chain()
            .any(|cause| matches!(cause.downcast_ref::<HarnessError>(), Some(Self::CapacityExhausted)))
    }
}
