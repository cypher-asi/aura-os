//! Shared upstream-proxy plumbing for the public-mode generation
//! endpoints (image / video / model3d).
//!
//! The three handlers (`handlers/public/{image,video,model3d}.rs`)
//! all funnel through this single core so the rate-limit-gate +
//! upstream-call + SSE-shape concerns live in one place. Each
//! handler stays a thin orchestrator that:
//!
//! 1. Validates its own request body (DTO defines only the fields a
//!    public caller may send — everything else is hardcoded
//!    server-side per the plan's cost-control mandate).
//! 2. Reserves a turn slot via [`super::enforce_public_turn`].
//! 3. Calls [`proxy_public_generation_stream`] with the fixed
//!    upstream payload and modality.
//!
//! The upstream router (`aura-router /v1/generate-*/stream`)
//! returns SSE frames that the auth'd siblings already normalize
//! into the canonical event names the chat-ui renders
//! (`generation_start`, `generation_progress`,
//! `generation_partial_image`, `generation_completed`,
//! `generation_error`). The same normalization is reproduced here
//! so the frontend's existing media-rendering code works unchanged
//! for public users — we cannot reach into
//! `handlers/generation/`'s `pub(super)` helpers from this module
//! (and Phase 3 must not modify the auth'd generation files), so
//! the helpers are duplicated.
//!
//! Module layout (split from a previously single 599-line file to
//! satisfy the rules-rust 500-line cap):
//!
//! - [`request`] — header helpers + [`PublicGenerationCall`] +
//!   the upstream POST shape ([`PUBLIC_GENERATION_OPEN_TIMEOUT`],
//!   [`map_upstream_status_failure`]).
//! - [`relay`] — SSE relay state machine: drains the upstream byte
//!   stream, translates router frames onto the canonical
//!   `generation_*` events, and appends the trailing `limit` frame.
//! - [`completed`] — alias-promotion for `generation_completed`
//!   payloads + the error-frame normaliser.

mod completed;
mod relay;
mod request;

pub(crate) use request::{
    bearer_token_from_headers, caller_ip_from_headers, PublicGenerationCall, PublicGenerationSse,
};

use std::convert::Infallible;

use axum::response::sse::{Event, KeepAlive, Sse};
use futures_util::StreamExt;
use serde_json::json;
use tokio::sync::mpsc;
use tokio::time::timeout;
use tokio_stream::wrappers::ReceiverStream;
use tracing::{error, info, warn};

use crate::error::ApiResult;
use crate::handlers::generation::{
    build_generation_progress_heartbeat_event, GENERATION_HEARTBEAT_INTERVAL,
};
use crate::state::AppState;

use super::demo_agent::SYSTEM_DEMO_USER_ID;
use super::gate::{emit_limit_frame, record_completion, TurnGuard};
use super::types::PublicModality;

use relay::build_public_generation_sse;
use request::PUBLIC_GENERATION_OPEN_TIMEOUT;

/// Capacity of the per-stream channel feeding the public-mode SSE
/// response. Matches the auth'd image-generation channel so partial
/// frames don't backpressure the upstream-drain task.
const PUBLIC_GENERATION_CHANNEL_CAPACITY: usize = 64;

/// Authenticate + open the upstream proxy stream and wrap the
/// resulting byte stream as an SSE response.
///
/// Returns immediately with the SSE headers + a `ReceiverStream` fed
/// by a background task. The task's very first action is to emit a
/// synthetic `generation_start` event so the client sees a wire event
/// within milliseconds of the connection opening — before the
/// upstream router has even been contacted. This prevents the
/// frontend's 30s stuck-stream watchdog from firing the "Agent
/// paused" pill for long-rendering models like `gpt-image-2`.
///
/// On stream completion the canonical `{ kind: "limit", ... }` frame
/// is appended so the frontend mounts the upgrade modal
/// deterministically — matching the phase-2 chat handler's
/// contract. Upstream-open failures (timeout, transport error,
/// non-2xx status) are surfaced as in-band `generation_error` frames
/// since the HTTP 200 has already been committed when they are
/// observed.
pub(crate) async fn proxy_public_generation_stream(
    state: &AppState,
    bearer_token: &str,
    call: PublicGenerationCall,
    guard: TurnGuard,
) -> ApiResult<Sse<PublicGenerationSse>> {
    let generation_id = uuid::Uuid::new_v4().to_string();
    let modality = call.modality;
    let url = format!("{}{}", state.router_url, call.upstream_path);
    let bearer_token = bearer_token.to_string();
    info!(
        generation_id = %generation_id,
        modality = modality.as_str(),
        guest_id = %guard.guest_id,
        turn_count = guard.turn_count(),
        "public_generation: opening upstream proxy"
    );

    let (tx, rx) = mpsc::channel::<Result<Event, Infallible>>(PUBLIC_GENERATION_CHANNEL_CAPACITY);
    tokio::spawn(run_public_generation_task(
        tx,
        bearer_token,
        url,
        call.payload,
        modality,
        generation_id,
        guard,
    ));

    let boxed: PublicGenerationSse = Box::pin(ReceiverStream::new(rx));
    Ok(Sse::new(boxed).keep_alive(KeepAlive::default()))
}

/// Background task that drives one public-mode generation SSE
/// response: emits the synthetic `generation_start`, opens the
/// upstream proxy, drains the upstream byte stream through the
/// shared relay translator, and appends the canonical `limit` frame
/// + records the turn completion when the upstream terminates.
#[allow(clippy::too_many_arguments)]
async fn run_public_generation_task(
    tx: mpsc::Sender<Result<Event, Infallible>>,
    bearer_token: String,
    url: String,
    payload: serde_json::Value,
    modality: PublicModality,
    generation_id: String,
    guard: TurnGuard,
) {
    // Phase 1: synthetic `generation_start` so the watchdog clock
    // resets the moment the SSE EventSource opens, regardless of how
    // long the upstream takes to respond.
    if tx
        .send(Ok(build_generation_start_event(modality)))
        .await
        .is_err()
    {
        // Receiver dropped (client disconnected) — also drop the
        // turn-completion record so the rate limiter slot is freed.
        record_completion(guard);
        return;
    }

    // Phase 2: open the upstream proxy.
    let client = reqwest::Client::new();
    let response_result = timeout(
        PUBLIC_GENERATION_OPEN_TIMEOUT,
        client
            .post(&url)
            .bearer_auth(&bearer_token)
            .header("X-Aura-Agent-Id", format!("public-{}", &generation_id))
            .header("X-Aura-User-Id", SYSTEM_DEMO_USER_ID)
            .header("X-Aura-Session-Id", &generation_id)
            .json(&payload)
            .send(),
    )
    .await;

    let response = match response_result {
        Err(_) => {
            warn!(
                generation_id = %generation_id,
                modality = modality.as_str(),
                "public_generation: upstream open timed out"
            );
            emit_setup_failure_and_terminate(
                &tx,
                guard,
                "UPSTREAM_OPEN_TIMEOUT",
                "public generation is taking too long to start",
            )
            .await;
            return;
        }
        Ok(Err(err)) => {
            error!(
                generation_id = %generation_id,
                modality = modality.as_str(),
                error = %err,
                "public_generation: upstream request failed"
            );
            emit_setup_failure_and_terminate(
                &tx,
                guard,
                "UPSTREAM_REQUEST_FAILED",
                format!("upstream request failed: {err}"),
            )
            .await;
            return;
        }
        Ok(Ok(resp)) => resp,
    };

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        error!(
            %status,
            body = %body,
            generation_id = %generation_id,
            modality = modality.as_str(),
            "public_generation: upstream returned error status"
        );
        let (code, message) = upstream_status_to_setup_error(status, &body);
        emit_setup_failure_and_terminate(&tx, guard, code, message).await;
        return;
    }

    // Phase 3: drain the upstream byte stream through the shared
    // relay translator, forwarding each canonical event to the
    // channel. The relay also appends the trailing `limit` frame and
    // calls `record_completion(guard)` once the upstream terminates.
    // We interleave a synthetic `generation_progress` heartbeat every
    // [`GENERATION_HEARTBEAT_INTERVAL`] so the frontend's
    // `STUCK_THRESHOLD_MS = 30s` watchdog clock keeps resetting on
    // long-running renders whose upstream proxy emits nothing
    // between the initial start and the final completed frame.
    let bytes = response.bytes_stream();
    let inner = build_public_generation_sse(bytes, generation_id, guard, modality);
    let mut inner = std::pin::pin!(inner);
    loop {
        match tokio::time::timeout(GENERATION_HEARTBEAT_INTERVAL, inner.next()).await {
            Err(_) => {
                if tx
                    .send(Ok(build_generation_progress_heartbeat_event(
                        modality.as_str(),
                    )))
                    .await
                    .is_err()
                {
                    return;
                }
            }
            Ok(Some(item)) => {
                if tx.send(item).await.is_err() {
                    return;
                }
            }
            Ok(None) => return,
        }
    }
}

/// Emit one in-band setup-failure `generation_error` frame followed
/// by the canonical `limit` frame, then release the [`TurnGuard`].
/// Mirrors the wire shape callers got when these failures surfaced
/// as HTTP 4xx/5xx before the deferred-upstream-open refactor.
async fn emit_setup_failure_and_terminate(
    tx: &mpsc::Sender<Result<Event, Infallible>>,
    guard: TurnGuard,
    code: &'static str,
    message: impl Into<String>,
) {
    let turn_count = guard.turn_count();
    let error_event = Event::default()
        .event("generation_error")
        .json_data(json!({
            "code": code,
            "message": message.into(),
        }))
        .unwrap_or_else(|_| Event::default().data("{}"));
    if tx.send(Ok(error_event)).await.is_err() {
        record_completion(guard);
        return;
    }

    let limit_frame = emit_limit_frame(turn_count);
    let limit_event = Event::default()
        .event("limit")
        .json_data(&limit_frame)
        .unwrap_or_else(|_| {
            Event::default().event("limit").data(format!(
                "{{\"kind\":\"limit\",\"turn_count\":{turn_count}}}"
            ))
        });
    let _ = tx.send(Ok(limit_event)).await;
    record_completion(guard);
}

/// Build the synthetic `generation_start` SSE event emitted as the
/// first frame on every public-mode generation stream.
fn build_generation_start_event(modality: PublicModality) -> Event {
    Event::default()
        .event("generation_start")
        .json_data(json!({ "mode": modality.as_str() }))
        .unwrap_or_else(|_| Event::default().data("{}"))
}

/// Map a non-2xx upstream status into the `(code, message)` pair
/// surfaced as an in-band `generation_error` SSE event. The frontend
/// already understands the `PAYMENT_REQUIRED` / `RATE_LIMITED` /
/// `UNAUTHORIZED` prefixes via `handleStreamError`.
fn upstream_status_to_setup_error(
    status: reqwest::StatusCode,
    body: &str,
) -> (&'static str, String) {
    match status {
        reqwest::StatusCode::UNAUTHORIZED => (
            "UNAUTHORIZED",
            "Public generation rejected by router (unauthorized).".to_string(),
        ),
        reqwest::StatusCode::PAYMENT_REQUIRED => (
            "PAYMENT_REQUIRED",
            "Insufficient credits for public generation.".to_string(),
        ),
        reqwest::StatusCode::TOO_MANY_REQUESTS => (
            "RATE_LIMITED",
            "Public generation rate limited; try again in a moment.".to_string(),
        ),
        _ => (
            "UPSTREAM_ERROR",
            format!("Public generation upstream returned {status}: {body}"),
        ),
    }
}

#[cfg(test)]
mod streaming_tests {
    //! Tests for the deferred-upstream-open behaviour of
    //! [`run_public_generation_task`]. Mirror of the auth'd
    //! `streaming_tests` in
    //! `apps/aura-os-server/src/handlers/generation/image.rs`. The
    //! contract: the synthetic `generation_start` SSE frame lands on
    //! the response channel BEFORE the upstream router has emitted
    //! anything, so the frontend's 30s stuck-stream watchdog clock
    //! resets the moment the SSE EventSource opens.
    use super::super::gate::TurnGuard;
    use super::super::types::{GuestId, PublicModality, PublicTurnCount};
    use super::*;
    use std::time::Duration;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::TcpListener;

    fn mk_guard(modality: PublicModality) -> TurnGuard {
        TurnGuard {
            guest_id: GuestId("g-test".to_string()),
            turn_count: PublicTurnCount(1),
            modality,
        }
    }

    /// Probe the SSE event name from axum's [`Event`] via its Debug
    /// representation. See the matching helper in
    /// `apps/aura-os-server/src/handlers/generation/image.rs` for the
    /// full rationale; the format is stable as of axum 0.8 and
    /// captures the `event: <name>\n` line embedded in the buffer
    /// field.
    fn event_kind(event: &Event) -> String {
        let dbg = format!("{event:?}");
        let marker = "event: ";
        let mut search = dbg.as_str();
        while let Some(idx) = search.find(marker) {
            search = &search[idx + marker.len()..];
            if let Some(end) = search.find("\\n") {
                let candidate = &search[..end];
                if !candidate.is_empty()
                    && candidate
                        .chars()
                        .all(|c| c.is_ascii_alphanumeric() || c == '_')
                {
                    return candidate.to_string();
                }
            }
        }
        dbg
    }

    /// Spin up a TCP listener that delays before responding, so the
    /// test can assert the synthetic `generation_start` frame lands
    /// well before the upstream produces anything.
    async fn start_slow_mock_upstream(
        body: String,
        status: u16,
        pre_response_delay_ms: u64,
    ) -> (String, tokio::task::JoinHandle<()>) {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let url = format!("http://{addr}");
        let handle = tokio::spawn(async move {
            let (mut socket, _) = match listener.accept().await {
                Ok(pair) => pair,
                Err(_) => return,
            };
            let mut req_buf = vec![0u8; 4096];
            let _ = socket.read(&mut req_buf).await;
            if pre_response_delay_ms > 0 {
                tokio::time::sleep(Duration::from_millis(pre_response_delay_ms)).await;
            }
            let response = format!(
                "HTTP/1.1 {status} OK\r\nContent-Type: text/event-stream\r\nConnection: close\r\n\r\n{body}"
            );
            let _ = socket.write_all(response.as_bytes()).await;
            let _ = socket.shutdown().await;
        });
        (url, handle)
    }

    #[tokio::test]
    async fn first_emitted_frame_is_generation_start_before_upstream_responds() {
        let (base_url, handle) = start_slow_mock_upstream(String::new(), 200, 5_000).await;
        let url = format!("{base_url}/v1/generate-image/stream");

        let (tx, mut rx) = mpsc::channel::<Result<Event, Infallible>>(8);
        tokio::spawn(run_public_generation_task(
            tx,
            "guest-jwt".to_string(),
            url,
            json!({ "prompt": "a cat" }),
            PublicModality::Image,
            "gen-test".to_string(),
            mk_guard(PublicModality::Image),
        ));

        let first = tokio::time::timeout(Duration::from_millis(500), rx.recv())
            .await
            .expect("first frame should land before upstream responds")
            .expect("channel open")
            .expect("infallible");
        assert_eq!(event_kind(&first), "generation_start");

        handle.abort();
    }

    /// Heartbeat fires for the public proxy too. Mirror of the
    /// auth'd `heartbeat_fires_when_upstream_stays_silent` test in
    /// `apps/aura-os-server/src/handlers/generation/image.rs`.
    #[tokio::test(start_paused = true)]
    async fn heartbeat_fires_when_upstream_stays_silent() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let url = format!("http://{addr}/v1/generate-image/stream");

        let mock_handle = tokio::spawn(async move {
            let (mut socket, _) = listener.accept().await.unwrap();
            let mut buf = vec![0u8; 4096];
            let _ = socket.read(&mut buf).await;
            let response = "HTTP/1.1 200 OK\r\n\
                            Content-Type: text/event-stream\r\n\
                            Transfer-Encoding: chunked\r\n\
                            \r\n";
            let _ = socket.write_all(response.as_bytes()).await;
            let _ = socket.flush().await;
            std::future::pending::<()>().await;
        });

        let (tx, mut rx) = mpsc::channel::<Result<Event, Infallible>>(8);
        tokio::spawn(run_public_generation_task(
            tx,
            "guest-jwt".to_string(),
            url,
            json!({ "prompt": "a cat" }),
            PublicModality::Image,
            "gen-test".to_string(),
            mk_guard(PublicModality::Image),
        ));

        let first = rx.recv().await.expect("first").expect("infallible");
        assert_eq!(event_kind(&first), "generation_start");

        tokio::task::yield_now().await;
        tokio::time::advance(GENERATION_HEARTBEAT_INTERVAL + Duration::from_secs(1)).await;

        let heartbeat = rx.recv().await.expect("heartbeat").expect("infallible");
        assert_eq!(event_kind(&heartbeat), "generation_progress");

        mock_handle.abort();
    }

    #[tokio::test]
    async fn upstream_4xx_surfaces_in_band_error_then_limit_frame() {
        let (base_url, handle) =
            start_slow_mock_upstream("insufficient credits".to_string(), 402, 0).await;
        let url = format!("{base_url}/v1/generate-image/stream");

        let (tx, mut rx) = mpsc::channel::<Result<Event, Infallible>>(8);
        tokio::spawn(run_public_generation_task(
            tx,
            "guest-jwt".to_string(),
            url,
            json!({ "prompt": "a cat" }),
            PublicModality::Image,
            "gen-test".to_string(),
            mk_guard(PublicModality::Image),
        ));

        let first = rx.recv().await.expect("first frame").expect("infallible");
        assert_eq!(event_kind(&first), "generation_start");

        let second = tokio::time::timeout(Duration::from_secs(2), rx.recv())
            .await
            .expect("second frame should land")
            .expect("channel open")
            .expect("infallible");
        assert_eq!(event_kind(&second), "generation_error");

        // The setup-failure path emits the canonical `limit` frame so
        // the frontend's upgrade-modal trigger keeps the same wire
        // shape as the happy path.
        let third = tokio::time::timeout(Duration::from_secs(2), rx.recv())
            .await
            .expect("limit frame should land")
            .expect("channel open")
            .expect("infallible");
        assert_eq!(event_kind(&third), "limit");

        handle.abort();
    }
}
