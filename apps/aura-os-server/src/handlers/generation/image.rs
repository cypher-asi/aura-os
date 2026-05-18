use axum::extract::State;
use axum::response::sse::{Event, KeepAlive, Sse};
use axum::Json;
use futures_util::StreamExt;
use reqwest::StatusCode as ReqwestStatus;
use serde_json::{json, Value};
use std::convert::Infallible;
use std::time::Duration;
use tokio::sync::{broadcast, mpsc};
use tokio_stream::wrappers::ReceiverStream;
use tracing::{error, info};

use crate::dto::GenerateImageRequest;
use crate::error::{ApiError, ApiResult};
use crate::handlers::billing;
use crate::state::{AppState, AuthJwt, AuthSession};

use super::harness_stream::{
    normalize_generation_completed_payload, resolve_generation_identity, GenerationIdentity,
    GenerationPersistArgs,
};
use super::persist::{
    persist_user_prompt, resolve_persist_ctx, GenerationPersistMeta, GenerationPersistTargets,
};
use super::router_proxy::router_url;
use super::sse::{SseResponse, SseStream, SSE_NO_BUFFERING_HEADERS};
use crate::handlers::agents::chat::ChatPersistCtx;

/// Capacity of the per-stream channel feeding the SSE response. Sized
/// generously so the upstream-drain task never blocks on a slow client
/// drain — partial-image frames from `gpt-image-2` can land in tight
/// bursts.
const IMAGE_STREAM_CHANNEL_CAPACITY: usize = 64;

/// Interval between synthetic `generation_progress` heartbeat frames
/// emitted while the upstream router is silent. Sized comfortably
/// under the frontend's `STUCK_THRESHOLD_MS = 30s` watchdog
/// (`interface/src/hooks/stream/use-stream-health.ts`) so even a
/// dropped tick (network jitter, slow scheduler) won't let the
/// watchdog trip before the next heartbeat lands.
///
/// The watchdog reads `lastEventAt` on the Zustand store; every
/// `generation_progress` setter in
/// `interface/src/hooks/use-agent-chat-stream.ts` calls
/// `setProgressText`, which calls `markStreamProgress` under the
/// hood. So a heartbeat frame counts as wire activity for the
/// watchdog without any frontend change.
pub(crate) const GENERATION_HEARTBEAT_INTERVAL: Duration = Duration::from_secs(15);

pub(crate) async fn generate_image_stream(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    AuthSession(auth_session): AuthSession,
    Json(body): Json<GenerateImageRequest>,
) -> ApiResult<SseResponse> {
    billing::require_credits(&state, &jwt).await?;
    info!(model = ?body.model, "Image generation stream requested");

    let identity =
        resolve_generation_identity(&state, &auth_session, &jwt, body.project_id.as_deref())
            .await?;

    // Image-mode generation lives outside the regular chat stream, so
    // we resolve the chat-session persistence context separately and
    // (best-effort) write a `user_message` row up front. The companion
    // assistant turn is persisted when the router stream emits its
    // terminal completion event. If no chat scope was threaded through
    // (legacy clients, AURA 3D app), `persist` stays `None` and
    // generation streams without durable history.
    let persist_ctx = resolve_persist_ctx(
        &state,
        &GenerationPersistTargets {
            jwt: &jwt,
            agent_id: body.agent_id.as_deref(),
            project_id: body.project_id.as_deref(),
            agent_instance_id: body.agent_instance_id.as_deref(),
            force_new: body.new_session.unwrap_or(false),
            pinned_session_id: body.session_id.as_deref(),
        },
    )
    .await;
    if let Some(ctx) = persist_ctx.as_ref() {
        persist_user_prompt(&state, ctx, &body.prompt, body.images.as_deref()).await;
    }
    let persist_args = persist_ctx.map(|ctx| GenerationPersistArgs {
        ctx,
        meta: GenerationPersistMeta {
            prompt: body.prompt.clone(),
            model: body.model.clone(),
            size: body.size.clone(),
            tool_name: "generate_image",
        },
    });

    let router_payload = router_image_payload(&body);
    open_router_image_stream(state, jwt, identity, router_payload, persist_args).await
}

fn router_image_payload(body: &GenerateImageRequest) -> serde_json::Value {
    let mut payload = json!({
        "prompt": body.prompt,
    });
    if let Some(model) = body.model.as_deref() {
        payload["model"] = json!(model);
    }
    if let Some(size) = body.size.as_deref() {
        payload["size"] = json!(size);
    }
    if let Some(project_id) = body.project_id.as_deref() {
        payload["projectId"] = json!(project_id);
    }
    if let Some(images) = body.images.as_deref() {
        if !images.is_empty() {
            payload["images"] = json!(images);
        }
    }
    if let Some(is_iteration) = body.is_iteration {
        payload["isIteration"] = json!(is_iteration);
    }
    payload
}

/// Build the SSE response for an image-generation request.
///
/// Returns immediately with the SSE headers + a `ReceiverStream` fed
/// by a background task. The task's very first action is to emit a
/// synthetic `generation_start` event so the client sees a wire event
/// within milliseconds of the connection opening — before the
/// upstream router has even been contacted.
///
/// This is the fix for the "Agent paused for 7s — last activity was
/// 37s ago" stuck-stream pill: the frontend watchdog
/// (`STUCK_THRESHOLD_MS = 30s` in
/// `interface/src/hooks/stream/use-stream-health.ts`) bumps
/// `lastEventAt` on every SSE-driven setter. Long-rendering image
/// models like `gpt-image-2` previously left the SSE wire silent for
/// the entire upstream blocking POST (the handler awaited
/// `client.post(...).send().await` BEFORE constructing the SSE
/// response), so the watchdog fired even though the request was
/// healthy in flight. Now the watchdog clock resets the moment the
/// SSE EventSource opens, and subsequent
/// `generation_progress` / `generation_partial_image` frames from
/// the upstream keep it reset.
///
/// Upstream failures (transport errors, non-2xx status) are
/// translated to in-band `generation_error` SSE frames since the
/// HTTP 200 has already been committed to the wire by the time they
/// are observed.
async fn open_router_image_stream(
    state: AppState,
    jwt: String,
    identity: GenerationIdentity,
    body: serde_json::Value,
    persist: Option<GenerationPersistArgs>,
) -> ApiResult<SseResponse> {
    let generation_id = uuid::Uuid::new_v4().to_string();
    let agent_id = format!("generation-{}", uuid::Uuid::new_v4().as_simple());
    let url = format!("{}/v1/generate-image/stream", router_url(&state));
    info!(
        generation_id = %generation_id,
        "image generation stream opening router request"
    );

    let persist = persist.map(|persist| (persist.ctx, state.event_broadcast.clone(), persist.meta));

    let (tx, rx) = mpsc::channel::<Result<Event, Infallible>>(IMAGE_STREAM_CHANNEL_CAPACITY);
    tokio::spawn(run_image_upstream_task(
        tx,
        url,
        jwt,
        agent_id,
        identity,
        body,
        generation_id,
        persist,
    ));

    let stream: SseStream = Box::pin(ReceiverStream::new(rx));
    Ok((
        SSE_NO_BUFFERING_HEADERS,
        Sse::new(stream).keep_alive(KeepAlive::default()),
    ))
}

type RouterPersist = (
    ChatPersistCtx,
    broadcast::Sender<Value>,
    GenerationPersistMeta,
);

/// Background task that drives one image-generation SSE response:
/// emits the synthetic `generation_start`, opens the upstream
/// router request, and drains the upstream byte stream through the
/// shared frame translator into the response channel.
///
/// Every send is best-effort: if the client disconnects mid-stream
/// the receiver is dropped and the task exits cleanly.
#[allow(clippy::too_many_arguments)]
async fn run_image_upstream_task(
    tx: mpsc::Sender<Result<Event, Infallible>>,
    url: String,
    jwt: String,
    agent_id: String,
    identity: GenerationIdentity,
    body: serde_json::Value,
    generation_id: String,
    mut persist: Option<RouterPersist>,
) {
    if tx
        .send(Ok(build_generation_start_event("image")))
        .await
        .is_err()
    {
        return;
    }

    let client = reqwest::Client::new();
    let resp = match client
        .post(&url)
        .bearer_auth(&jwt)
        .header("X-Aura-Agent-Id", &agent_id)
        .header("X-Aura-Org-Id", &identity.aura_org_id)
        .header("X-Aura-Session-Id", &identity.aura_session_id)
        .header("X-Aura-User-Id", &identity.user_id)
        .json(&body)
        .send()
        .await
    {
        Ok(resp) => resp,
        Err(e) => {
            error!(
                generation_id = %generation_id,
                error = %e,
                "image generation router request failed"
            );
            let _ = tx
                .send(Ok(generation_error_event(
                    "UPSTREAM_REQUEST_FAILED",
                    format!("Image generation upstream request failed: {e}"),
                )))
                .await;
            return;
        }
    };

    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        error!(
            generation_id = %generation_id,
            %status,
            body = %text,
            "image generation router returned error"
        );
        let (code, message) = upstream_status_to_error_payload(status, &text);
        let _ = tx.send(Ok(generation_error_event(code, message))).await;
        return;
    }

    let mut byte_stream = resp.bytes_stream();
    let mut buffer = String::new();
    loop {
        while let Some(sep_pos) = buffer.find("\n\n") {
            let frame = buffer[..sep_pos].to_string();
            buffer = buffer[sep_pos + 2..].to_string();
            if frame.trim().is_empty() {
                continue;
            }
            if let Some((event, terminal, completed_payload)) =
                router_frame_to_generation_event(&frame)
            {
                if let Some(payload) = completed_payload.as_ref() {
                    if let Some((ctx, event_bus, meta)) = persist.take() {
                        super::persist::persist_completion(&ctx, &event_bus, &meta, payload).await;
                    }
                }
                if tx.send(Ok(event)).await.is_err() {
                    return;
                }
                if terminal {
                    return;
                }
            }
        }

        // Wait for the next chunk or the heartbeat tick — whichever
        // arrives first. Without the heartbeat, models like
        // `gpt-image-2` that emit nothing between the upstream
        // `generation_start` and the final `completed` frame leave
        // the SSE wire silent for the full render (>30s on cold
        // tenants), tripping the frontend's stuck-stream watchdog
        // even though the request is healthy.
        match tokio::time::timeout(GENERATION_HEARTBEAT_INTERVAL, byte_stream.next()).await {
            Err(_) => {
                if tx
                    .send(Ok(build_generation_progress_heartbeat_event("image")))
                    .await
                    .is_err()
                {
                    return;
                }
            }
            Ok(Some(Ok(chunk))) => {
                buffer.push_str(&String::from_utf8_lossy(&chunk));
            }
            Ok(Some(Err(e))) => {
                error!(
                    generation_id = %generation_id,
                    error = %e,
                    "image generation router stream failed"
                );
                let _ = tx
                    .send(Ok(generation_error_event(
                        "UPSTREAM_STREAM_ERROR",
                        format!("Image generation stream failed: {e}"),
                    )))
                    .await;
                return;
            }
            Ok(None) => {
                if !buffer.trim().is_empty() {
                    let frame = std::mem::take(&mut buffer);
                    if let Some((event, _terminal, completed_payload)) =
                        router_frame_to_generation_event(&frame)
                    {
                        if let Some(payload) = completed_payload.as_ref() {
                            if let Some((ctx, event_bus, meta)) = persist.take() {
                                super::persist::persist_completion(
                                    &ctx, &event_bus, &meta, payload,
                                )
                                .await;
                            }
                        }
                        let _ = tx.send(Ok(event)).await;
                        return;
                    }
                }
                error!(
                    generation_id = %generation_id,
                    "image generation router stream closed before a terminal event"
                );
                let _ = tx
                    .send(Ok(generation_error_event(
                        "UPSTREAM_STREAM_CLOSED",
                        "Image generation stream closed before completing.",
                    )))
                    .await;
                return;
            }
        }
    }
}

/// Build the synthetic `generation_start` SSE event emitted as the
/// first frame on every generation stream. Shared with video / 3D /
/// public-proxy callers via [`super::harness_stream`] and
/// [`crate::handlers::public`].
pub(super) fn build_generation_start_event(mode: &str) -> Event {
    Event::default()
        .event("generation_start")
        .json_data(json!({ "mode": mode }))
        .unwrap_or_else(|_| Event::default().data("{}"))
}

/// Build a synthetic `generation_progress` SSE heartbeat. Emitted
/// every [`GENERATION_HEARTBEAT_INTERVAL`] while the upstream router
/// is silent so the frontend's stuck-stream watchdog clock keeps
/// resetting. The `message` matches what
/// `interface/src/hooks/use-agent-chat-stream.ts` already sets via
/// `GenerationStart` for the same mode, so the user-visible
/// progress text doesn't flicker when a heartbeat overwrites it
/// between real progress frames.
pub(crate) fn build_generation_progress_heartbeat_event(mode: &str) -> Event {
    let message = match mode {
        "image" => "Generating image...",
        "video" => "Generating video...",
        "3d" => "Generating 3D model...",
        _ => "Generating...",
    };
    Event::default()
        .event("generation_progress")
        .json_data(json!({ "message": message }))
        .unwrap_or_else(|_| Event::default().data("{}"))
}

/// Map a non-2xx upstream status into the `(code, message)` pair
/// surfaced as an in-band `generation_error` SSE event. The
/// frontend's `handleStreamError` already understands the
/// "PAYMENT_REQUIRED" / "RATE_LIMITED" / "UNAUTHORIZED" prefixes
/// the auth'd path used to surface via HTTP status codes.
fn upstream_status_to_error_payload(
    status: ReqwestStatus,
    body: &str,
) -> (&'static str, String) {
    match status {
        ReqwestStatus::UNAUTHORIZED => (
            "UNAUTHORIZED",
            "Image generation rejected by router (unauthorized).".to_string(),
        ),
        ReqwestStatus::PAYMENT_REQUIRED => (
            "PAYMENT_REQUIRED",
            "Insufficient credits for image generation.".to_string(),
        ),
        ReqwestStatus::TOO_MANY_REQUESTS => (
            "RATE_LIMITED",
            "Image generation rate limited; try again in a moment.".to_string(),
        ),
        _ => (
            "UPSTREAM_ERROR",
            format!("Image generation upstream returned {status}: {body}"),
        ),
    }
}

fn router_frame_to_generation_event(frame: &str) -> Option<(Event, bool, Option<Value>)> {
    let (event_type, data) = parse_sse_frame(frame);
    if data.trim() == "[DONE]" {
        return Some((Event::default().event("done").data("{}"), true, None));
    }

    let parsed = if data.trim().is_empty() {
        Value::Object(Default::default())
    } else {
        serde_json::from_str::<Value>(&data).unwrap_or(Value::Null)
    };
    let tagged_type = parsed
        .get("type")
        .and_then(|value| value.as_str())
        .unwrap_or_default();
    let event_type = if event_type.is_empty() {
        tagged_type
    } else {
        event_type.as_str()
    };

    match event_type {
        "generation_start" | "start" | "started" => Some((
            Event::default()
                .event("generation_start")
                .json_data(json!({ "mode": "image" }))
                .unwrap_or_else(|_| Event::default().data("{}")),
            false,
            None,
        )),
        "generation_progress" | "progress" => Some((
            Event::default()
                .event("generation_progress")
                .json_data(&parsed)
                .unwrap_or_else(|_| Event::default().data("{}")),
            false,
            None,
        )),
        "generation_partial_image" | "partial_image" | "partial" => Some((
            Event::default()
                .event("generation_partial_image")
                .json_data(&parsed)
                .unwrap_or_else(|_| Event::default().data("{}")),
            false,
            None,
        )),
        "generation_completed" | "completed" | "complete" => {
            let payload = normalize_generation_completed_payload("image".to_string(), parsed);
            Some((
                Event::default()
                    .event("generation_completed")
                    .json_data(&payload)
                    .unwrap_or_else(|_| Event::default().data("{}")),
                true,
                Some(payload),
            ))
        }
        "generation_error" | "error" => Some((
            Event::default()
                .event("generation_error")
                .json_data(normalize_router_error_payload(parsed))
                .unwrap_or_else(|_| Event::default().data("{}")),
            true,
            None,
        )),
        "done" => Some((Event::default().event("done").data("{}"), true, None)),
        _ => None,
    }
}

fn parse_sse_frame(frame: &str) -> (String, String) {
    let mut event_type = String::new();
    let mut data_lines = Vec::new();
    for line in frame.lines() {
        if let Some(rest) = line.strip_prefix("event:") {
            event_type = rest.trim().to_string();
        } else if let Some(rest) = line.strip_prefix("data:") {
            data_lines.push(rest.trim_start().to_string());
        }
    }
    (event_type, data_lines.join("\n"))
}

fn normalize_router_error_payload(payload: Value) -> Value {
    let message = payload
        .get("message")
        .and_then(|value| value.as_str())
        .or_else(|| payload.get("error").and_then(|value| value.as_str()))
        .unwrap_or("Image generation failed upstream.");
    let code = payload
        .get("code")
        .and_then(|value| value.as_str())
        .unwrap_or("GENERATION_FAILED");
    json!({
        "code": code,
        "message": message,
    })
}

fn generation_error_event(code: &'static str, message: impl Into<String>) -> Event {
    Event::default()
        .event("generation_error")
        .json_data(json!({
            "code": code,
            "message": message.into(),
        }))
        .unwrap_or_else(|_| Event::default().data("{}"))
}

/// Default model used by the chat-agent `generate_image` tool when the
/// caller omits the `model` argument. Kept in sync with
/// `interface/src/constants/models.ts::IMAGE_MODELS[0]`.
const DEFAULT_GENERATE_IMAGE_TOOL_MODEL: &str = "gpt-image-2";

/// Non-streaming entry point for the chat-agent `generate_image` tool.
///
/// The HTTP `/api/generate/image/stream` route streams partial frames so
/// the UI can show progress; tool calls instead need a single JSON
/// response. This consumes the upstream router SSE, ignores progress and
/// partial-image frames, and returns the final `completed` payload (or
/// the upstream error) as a JSON value the harness can hand back to the
/// LLM as a tool result.
pub(crate) async fn generate_image_tool(
    state: &AppState,
    jwt: &str,
    args: &serde_json::Value,
) -> ApiResult<serde_json::Value> {
    billing::require_credits(state, jwt).await?;

    let prompt = args
        .get("prompt")
        .and_then(|v| v.as_str())
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .ok_or_else(|| ApiError::bad_request("`prompt` is required"))?;
    let model = args
        .get("model")
        .and_then(|v| v.as_str())
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .unwrap_or(DEFAULT_GENERATE_IMAGE_TOOL_MODEL);
    let size = args.get("size").and_then(|v| v.as_str());
    let project_id = args
        .get("project_id")
        .or_else(|| args.get("projectId"))
        .and_then(|v| v.as_str());

    info!(
        model = %model,
        size = ?size,
        "generate_image tool invocation"
    );

    let mut payload = json!({
        "prompt": prompt,
        "model": model,
    });
    if let Some(size) = size {
        payload["size"] = json!(size);
    }
    if let Some(project_id) = project_id {
        payload["projectId"] = json!(project_id);
    }

    let url = format!("{}/v1/generate-image/stream", router_url(state));
    run_generate_image_to_completion(&url, jwt, payload, prompt, model).await
}

pub(super) async fn run_generate_image_to_completion(
    url: &str,
    jwt: &str,
    body: serde_json::Value,
    prompt: &str,
    model: &str,
) -> ApiResult<serde_json::Value> {
    let client = reqwest::Client::new();
    let resp = client
        .post(url)
        .bearer_auth(jwt)
        .json(&body)
        .send()
        .await
        .map_err(|e| {
            error!(error = %e, "generate_image tool: upstream request failed");
            ApiError::bad_gateway(format!("upstream request failed: {e}"))
        })?;

    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        error!(%status, body = %text, "generate_image tool: upstream error");
        return match status {
            ReqwestStatus::UNAUTHORIZED => Err(ApiError::unauthorized("router rejected token")),
            ReqwestStatus::PAYMENT_REQUIRED => {
                Err(ApiError::payment_required("insufficient credits"))
            }
            ReqwestStatus::TOO_MANY_REQUESTS => Err(ApiError::service_unavailable("rate limited")),
            _ => Err(ApiError::bad_gateway(format!(
                "upstream returned {status}: {text}"
            ))),
        };
    }

    let mut byte_stream = resp.bytes_stream();
    let mut buffer = String::new();
    let mut completed: Option<serde_json::Value> = None;
    let mut last_error: Option<String> = None;

    'outer: loop {
        while let Some(sep_pos) = buffer.find("\n\n") {
            let frame = buffer[..sep_pos].to_string();
            buffer = buffer[sep_pos + 2..].to_string();
            if frame.trim().is_empty() {
                continue;
            }

            let mut event_type = String::new();
            let mut data = String::new();
            for line in frame.split('\n') {
                if let Some(rest) = line.strip_prefix("event: ") {
                    event_type = rest.trim().to_string();
                } else if let Some(rest) = line.strip_prefix("data: ") {
                    data = rest.trim().to_string();
                }
            }

            // When upstream emits `data: {"type":"..."}` without a separate
            // `event:` line, fall back to the JSON `type` field.
            if event_type.is_empty() && !data.is_empty() {
                if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&data) {
                    if let Some(t) = parsed.get("type").and_then(|v| v.as_str()) {
                        event_type = t.to_string();
                    }
                }
            }

            if data.is_empty() {
                continue;
            }
            let parsed: serde_json::Value =
                serde_json::from_str(&data).unwrap_or(serde_json::Value::Null);

            match event_type.as_str() {
                "completed" => {
                    completed = Some(parsed);
                    // Keep draining; some routers send a trailing `done`.
                }
                "error" => {
                    let message = parsed
                        .get("message")
                        .and_then(|v| v.as_str())
                        .unwrap_or("upstream image generation failed")
                        .to_string();
                    last_error = Some(message);
                    break 'outer;
                }
                _ => {}
            }
        }

        match byte_stream.next().await {
            Some(Ok(chunk)) => {
                buffer.push_str(&String::from_utf8_lossy(&chunk));
            }
            Some(Err(e)) => {
                return Err(ApiError::bad_gateway(format!("stream error: {e}")));
            }
            None => break,
        }
    }

    if let Some(message) = last_error {
        return Err(ApiError::bad_gateway(message));
    }

    let mut completed = completed.ok_or_else(|| {
        ApiError::bad_gateway("upstream did not emit a `completed` event before closing the stream")
    })?;

    // Decorate the result with the prompt and model so the chat client's
    // `ImageBlock` renderer (and downstream consumers) have everything
    // they need without a second round-trip.
    if let Some(obj) = completed.as_object_mut() {
        obj.entry("prompt").or_insert_with(|| json!(prompt));
        obj.entry("model").or_insert_with(|| json!(model));
        let mut meta = obj
            .get("meta")
            .and_then(|m| m.as_object().cloned())
            .unwrap_or_default();
        meta.entry("model".to_string())
            .or_insert_with(|| json!(model));
        meta.entry("prompt".to_string())
            .or_insert_with(|| json!(prompt));
        obj.insert("meta".to_string(), serde_json::Value::Object(meta));
    }

    Ok(completed)
}

#[cfg(test)]
mod streaming_tests {
    //! Tests for the deferred-upstream-open behaviour of
    //! [`run_image_upstream_task`]. The fix ensures the synthetic
    //! `generation_start` frame is emitted BEFORE the upstream POST
    //! resolves so the frontend's 30s stuck-stream watchdog clock
    //! resets the moment the SSE EventSource opens. These tests
    //! exercise that contract by driving the task directly against a
    //! controllable mock router.
    use super::*;
    use std::time::Duration;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::TcpListener;

    fn mk_identity() -> GenerationIdentity {
        GenerationIdentity {
            aura_org_id: "org-test".to_string(),
            aura_session_id: "session-test".to_string(),
            user_id: "user-test".to_string(),
        }
    }

    /// Extract the SSE event name from an [`Event`] by parsing its
    /// Debug representation. axum's `Event` Debug impl emits
    /// `Event { buffer: b"event: <name>\ndata: ...", ... }`, so we
    /// pull the event name out of the buffer field. Brittle if axum
    /// changes the Debug layout, but stable as of axum 0.8.
    fn event_kind(event: &Event) -> String {
        let dbg = format!("{event:?}");
        // Look for the pattern `event: ` inside the buffer literal —
        // the `\n` separator after the name terminates it on the wire.
        let marker = "event: ";
        let mut search = dbg.as_str();
        while let Some(idx) = search.find(marker) {
            search = &search[idx + marker.len()..];
            // Skip Debug-struct field hits ("event: <Some(...)>" or
            // "event: None") — those don't start with an alpha char
            // matching an SSE event name, but the buffer-literal hit
            // does. Buffer-literal hits run until the literal `\n`
            // escape, encoded as `\\n` in the debug string.
            if let Some(end) = search.find("\\n") {
                let candidate = &search[..end];
                if !candidate.is_empty() && candidate.chars().all(|c| c.is_ascii_alphanumeric() || c == '_') {
                    return candidate.to_string();
                }
            }
        }
        dbg
    }

    /// Spin up a TCP listener that:
    /// 1. Optionally delays before sending any HTTP response (simulates
    ///    a slow upstream router that hasn't begun streaming yet).
    /// 2. Then responds with the given HTTP status + body.
    async fn start_mock_upstream(
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

    /// The synthetic `generation_start` event lands on the response
    /// channel BEFORE the upstream router has emitted anything. This
    /// is the core fix: a slow upstream open can no longer leave the
    /// SSE wire silent for >30s and trip the stuck-stream watchdog.
    #[tokio::test]
    async fn first_emitted_frame_is_generation_start_before_upstream_responds() {
        let (base_url, handle) = start_mock_upstream(String::new(), 200, 5_000).await;
        let url = format!("{base_url}/v1/generate-image/stream");

        let (tx, mut rx) = mpsc::channel::<Result<Event, Infallible>>(8);
        tokio::spawn(run_image_upstream_task(
            tx,
            url,
            "jwt".to_string(),
            "agent-test".to_string(),
            mk_identity(),
            json!({ "prompt": "a cat" }),
            "gen-test".to_string(),
            None,
        ));

        // The first frame must arrive promptly — well before the
        // 5s upstream delay. We give a generous 500ms ceiling so
        // CI noise doesn't false-positive.
        let first = tokio::time::timeout(Duration::from_millis(500), rx.recv())
            .await
            .expect("first frame should land before upstream responds")
            .expect("channel should not be closed");
        let event = first.expect("infallible result");
        assert_eq!(event_kind(&event), "generation_start");

        handle.abort();
    }

    /// Upstream 402 (`PAYMENT_REQUIRED`) is now surfaced as an
    /// in-band `generation_error` frame instead of a synchronous
    /// 4xx HTTP response, because the SSE 200 has already been
    /// committed by the time the upstream status is observed.
    #[tokio::test]
    async fn upstream_4xx_becomes_in_band_generation_error_after_generation_start() {
        let (base_url, handle) =
            start_mock_upstream("insufficient credits".to_string(), 402, 0).await;
        let url = format!("{base_url}/v1/generate-image/stream");

        let (tx, mut rx) = mpsc::channel::<Result<Event, Infallible>>(8);
        tokio::spawn(run_image_upstream_task(
            tx,
            url,
            "jwt".to_string(),
            "agent-test".to_string(),
            mk_identity(),
            json!({ "prompt": "a cat" }),
            "gen-test".to_string(),
            None,
        ));

        let first = rx.recv().await.expect("first frame").expect("infallible");
        assert_eq!(event_kind(&first), "generation_start");

        let second = tokio::time::timeout(Duration::from_secs(2), rx.recv())
            .await
            .expect("second frame should land")
            .expect("channel should not be closed");
        let second = second.expect("infallible");
        assert_eq!(event_kind(&second), "generation_error");

        handle.abort();
    }

    /// The synthetic `generation_progress` heartbeat fires while
    /// the upstream router is silent. Without it the wire stays
    /// quiet for the full upstream render and the frontend's
    /// `STUCK_THRESHOLD_MS = 30s` watchdog still trips even though
    /// the synthetic `generation_start` correctly resets it at
    /// t=0. We use `tokio::time::pause` so we can advance virtual
    /// time past the 15s heartbeat interval without sleeping in
    /// the test.
    #[tokio::test(start_paused = true)]
    async fn heartbeat_fires_when_upstream_stays_silent() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let url = format!("http://{addr}/v1/generate-image/stream");

        // Mock server that accepts the connection, sends the SSE
        // response headers so reqwest's `send().await` resolves, and
        // then holds the body open forever — exactly the
        // `gpt-image-2`-style upstream that triggered the original
        // "Agent paused" pill.
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
        tokio::spawn(run_image_upstream_task(
            tx,
            url,
            "jwt".to_string(),
            "agent-test".to_string(),
            mk_identity(),
            json!({ "prompt": "a cat" }),
            "gen-test".to_string(),
            None,
        ));

        // Receive the initial generation_start frame. This happens
        // before any time-based await so it lands without needing a
        // virtual-time advance.
        let first = rx.recv().await.expect("first").expect("infallible");
        assert_eq!(event_kind(&first), "generation_start");

        // Drain any progress frames that land before the task is
        // sitting on its `timeout(...)` for the first byte chunk.
        // In practice on Tokio's single-threaded paused runtime
        // there are none, but yielding to the scheduler is enough
        // to let the task reach the `timeout` await before we
        // advance virtual time.
        tokio::task::yield_now().await;

        // Advance past the heartbeat interval. The drain loop's
        // `timeout(GENERATION_HEARTBEAT_INTERVAL, byte_stream.next())`
        // expires and the task emits a heartbeat. We push slightly
        // over the interval so a single advance reliably crosses
        // the deadline.
        tokio::time::advance(GENERATION_HEARTBEAT_INTERVAL + Duration::from_secs(1)).await;

        let heartbeat = rx.recv().await.expect("heartbeat").expect("infallible");
        assert_eq!(event_kind(&heartbeat), "generation_progress");

        mock_handle.abort();
    }

    /// Happy path: upstream emits a `completed` frame; the response
    /// channel sees `generation_start` then `generation_completed`.
    #[tokio::test]
    async fn happy_path_emits_generation_start_then_completed() {
        let body = format!(
            "event: completed\ndata: {}\n\n",
            json!({
                "imageUrl": "https://cdn.example.com/cat.png",
                "originalUrl": "https://cdn.example.com/cat-orig.png",
                "artifactId": "art-cat",
            }),
        );
        let (base_url, handle) = start_mock_upstream(body, 200, 0).await;
        let url = format!("{base_url}/v1/generate-image/stream");

        let (tx, mut rx) = mpsc::channel::<Result<Event, Infallible>>(8);
        tokio::spawn(run_image_upstream_task(
            tx,
            url,
            "jwt".to_string(),
            "agent-test".to_string(),
            mk_identity(),
            json!({ "prompt": "a cat" }),
            "gen-test".to_string(),
            None,
        ));

        let first = rx.recv().await.expect("first frame").expect("infallible");
        assert_eq!(event_kind(&first), "generation_start");

        let second = tokio::time::timeout(Duration::from_secs(2), rx.recv())
            .await
            .expect("completed frame should land")
            .expect("channel open")
            .expect("infallible");
        assert_eq!(event_kind(&second), "generation_completed");

        handle.abort();
    }
}
