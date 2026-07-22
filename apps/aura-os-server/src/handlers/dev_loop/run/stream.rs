//! Step 4 of the run pipeline: connect the harness event stream
//! and route the upstream WS-slot capacity 503 onto the structured
//! `harness_capacity_exhausted` envelope.
//!
//! Both [`super::request::RunMode`] variants use the same retry
//! count (2) and the same capacity-mapping rationale - the only
//! observable difference is the human-readable error label that
//! gets folded into the `bad_gateway` fallback envelope, which we
//! pin per-mode here to match the pre-refactor wording.

use aura_os_harness::{connect_with_retries, AutomatonEventStream, WsReaderHandle};

use super::super::limits::HARNESS_CONNECT_RETRIES;

use crate::error::{ApiError, ApiResult};
use crate::handlers::agents::chat::errors::map_harness_error_to_api;

use super::super::types::StartedAutomaton;
use super::context::RunContext;
use super::request::{RunMode, RunRequest};

pub(super) async fn connect_automaton_stream(
    req: &RunRequest,
    prep: &RunContext,
    started: &StartedAutomaton,
) -> ApiResult<(AutomatonEventStream, WsReaderHandle)> {
    connect_with_retries(
        prep.start.client.as_ref(),
        &started.automaton_id,
        started.event_stream_url.as_deref(),
        prep.start.harness_auth_token.as_deref(),
        HARNESS_CONNECT_RETRIES,
    )
    .await
    .map_err(|e| {
        // The /automaton/start HTTP call may have succeeded only for
        // the upstream WS upgrade to be rejected with the 503 / 1013
        // capacity signal (see `aura_os_harness::HarnessError`).
        // Route through the shared mapper so it surfaces as the
        // structured 503 `harness_capacity_exhausted` envelope
        // instead of a generic `bad_gateway`.
        map_harness_error_to_api(&e, req.state.harness_ws_slots, |err| {
            let label = match req.mode {
                RunMode::Automation => "connecting automaton stream",
                RunMode::SingleTask { .. } => "connecting task automaton stream",
            };
            ApiError::bad_gateway(format!("{label}: {err}"))
        })
    })
}
