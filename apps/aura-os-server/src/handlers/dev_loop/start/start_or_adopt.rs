//! Wrap `AutomatonClient::start` with the conflict / capacity / connect-error mapping the rest of the dev-loop expects, including the harness identity preflight that fails fast when an `X-Aura-*` header would be missing.

use axum::http::StatusCode;
use axum::Json;

use aura_os_harness::{AutomatonClient, AutomatonStartError, AutomatonStartParams};

use crate::error::ApiError;
use crate::handlers::agents::session_identity::{
    validate_automaton_identity, SessionIdentityRequirements,
};

use super::super::types::StartedAutomaton;

pub(crate) async fn start_or_adopt(
    client: &AutomatonClient,
    params: AutomatonStartParams,
    ws_slots_cap: usize,
) -> crate::error::ApiResult<StartedAutomaton> {
    // Tier 1 fail-fast: refuse to POST /automaton/start with a payload
    // missing one of the required X-Aura-* identity fields (org id,
    // session id, template agent id, user id, JWT). Without this, the
    // harness silently drops the missing header and the first LLM
    // call eventually surfaces as a Cloudflare 403 / generic 5xx with
    // no actionable signal. See `crate::handlers::agents::session_identity`.
    validate_automaton_identity(
        &params,
        SessionIdentityRequirements::DEV_LOOP,
        "dev_loop_automaton",
    )?;
    match client.start(params.clone()).await {
        Ok(result) => Ok(StartedAutomaton {
            automaton_id: result.automaton_id,
            event_stream_url: Some(result.event_stream_url),
            adopted: false,
        }),
        Err(AutomatonStartError::Conflict(Some(existing))) => {
            if !automaton_status_is_active(client, &existing).await {
                let _ = client.stop(&existing).await;
                let result = client
                    .start(params)
                    .await
                    .map_err(|e| map_start_error(client.base_url(), e, ws_slots_cap))?;
                return Ok(StartedAutomaton {
                    automaton_id: result.automaton_id,
                    event_stream_url: Some(result.event_stream_url),
                    adopted: false,
                });
            }
            Ok(StartedAutomaton {
                automaton_id: existing,
                event_stream_url: None,
                adopted: true,
            })
        }
        Err(error) => Err(map_start_error(client.base_url(), error, ws_slots_cap)),
    }
}

async fn automaton_status_is_active(client: &AutomatonClient, automaton_id: &str) -> bool {
    let Ok(status) = client.status(automaton_id).await else {
        return false;
    };
    status
        .get("running")
        .and_then(|v| v.as_bool())
        .unwrap_or_else(|| {
            status
                .get("state")
                .or_else(|| status.get("status"))
                .and_then(|v| v.as_str())
                .map(|s| matches!(s, "running" | "active" | "started" | "paused"))
                .unwrap_or(true)
        })
}

pub(crate) fn map_start_error(
    base_url: &str,
    error: AutomatonStartError,
    ws_slots_cap: usize,
) -> (StatusCode, Json<ApiError>) {
    match error {
        AutomatonStartError::Conflict(_) => ApiError::conflict("a dev loop is already running"),
        AutomatonStartError::Request {
            message,
            is_connect,
            is_timeout,
        } if is_connect || is_timeout => {
            crate::app_builder::ensure_local_harness_running();
            ApiError::service_unavailable(format!(
                "aura-harness at {base_url} is unavailable: {message}"
            ))
        }
        // Phase 6: detect upstream WS-slot exhaustion shape (HTTP 503,
        // optionally with a structured `code: "capacity_exhausted"`
        // body) and remap to the structured 503 instead of leaking the
        // raw upstream body via `bad_gateway`. Mirrors the
        // `is_capacity_exhausted_response` heuristic in
        // `crates/aura-os-harness/src/swarm_harness.rs` so chat / spec
        // / task / dev-loop paths agree on the wire-level taxonomy.
        AutomatonStartError::Response { status: 503, body }
            if response_body_is_capacity_exhausted(&body) =>
        {
            ApiError::harness_capacity_exhausted(ws_slots_cap)
        }
        AutomatonStartError::Response { status, body } => ApiError::bad_gateway(format!(
            "automaton start via {base_url} failed ({status}): {body}"
        )),
        other => ApiError::internal(format!("starting automaton: {other}")),
    }
}

/// Heuristic match for "upstream WS-slot semaphore exhausted" on a
/// 503 automaton-start response. Empty bodies and explicit
/// `code: "capacity_exhausted"` payloads both qualify; an explicit
/// non-`capacity_exhausted` `code` opts back into the generic
/// `bad_gateway` mapping. Kept in sync with
/// `crates/aura-os-harness/src/swarm_harness.rs::is_capacity_exhausted_response`.
fn response_body_is_capacity_exhausted(body: &str) -> bool {
    let trimmed = body.trim();
    if trimmed.is_empty() {
        return true;
    }
    let Ok(parsed) = serde_json::from_str::<serde_json::Value>(trimmed) else {
        return true;
    };
    let code = parsed.get("code").and_then(|v| v.as_str()).or_else(|| {
        parsed
            .get("error")
            .and_then(|err| err.get("code"))
            .and_then(|v| v.as_str())
    });
    match code {
        Some(c) if c.eq_ignore_ascii_case("capacity_exhausted") => true,
        Some(_) => false,
        None => true,
    }
}
