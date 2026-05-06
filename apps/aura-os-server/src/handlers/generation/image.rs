use axum::body::Bytes;
use axum::extract::State;
use axum::response::sse::{Event, KeepAlive, Sse};
use axum::Json;
use futures_core::Stream;
use futures_util::{stream, StreamExt};
use reqwest::StatusCode as ReqwestStatus;
use serde_json::{json, Value};
use std::pin::Pin;
use tokio::sync::broadcast;
use tracing::{error, info};

use crate::dto::GenerateImageRequest;
use crate::error::{ApiError, ApiResult};
use crate::handlers::billing;
use crate::state::{AppState, AuthJwt, AuthSession};

use super::harness_stream::{
    normalize_generation_completed_payload, resolve_generation_identity, GenerationIdentity,
    GenerationPersistArgs,
};
use super::persist::{persist_user_prompt, resolve_persist_ctx, GenerationPersistMeta};
use super::router_proxy::router_url;
use super::sse::{SseResponse, SseStream, SSE_NO_BUFFERING_HEADERS};
use crate::handlers::agents::chat::ChatPersistCtx;

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
        &jwt,
        body.agent_id.as_deref(),
        body.project_id.as_deref(),
        body.agent_instance_id.as_deref(),
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

    let client = reqwest::Client::new();
    let resp = client
        .post(&url)
        .bearer_auth(&jwt)
        .header("X-Aura-Agent-Id", agent_id)
        .header("X-Aura-Org-Id", identity.aura_org_id)
        .header("X-Aura-Session-Id", identity.aura_session_id)
        .header("X-Aura-User-Id", identity.user_id)
        .json(&body)
        .send()
        .await
        .map_err(|e| {
            error!(generation_id = %generation_id, error = %e, "image generation router request failed");
            ApiError::bad_gateway(format!("upstream request failed: {e}"))
        })?;

    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        error!(generation_id = %generation_id, %status, body = %text, "image generation router returned error");
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

    let persist = persist.map(|persist| (persist.ctx, state.event_broadcast.clone(), persist.meta));
    let stream = router_image_response_to_sse(resp.bytes_stream(), generation_id, persist);
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

struct RouterImageStreamState<S> {
    bytes: Pin<Box<S>>,
    buffer: String,
    done: bool,
    generation_id: String,
    persist: Option<RouterPersist>,
}

fn router_image_response_to_sse<S>(
    bytes: S,
    generation_id: String,
    persist: Option<RouterPersist>,
) -> SseStream
where
    S: Stream<Item = Result<Bytes, reqwest::Error>> + Send + 'static,
{
    Box::pin(stream::unfold(
        RouterImageStreamState {
            bytes: Box::pin(bytes),
            buffer: String::new(),
            done: false,
            generation_id,
            persist,
        },
        |mut state| async move {
            if state.done {
                return None;
            }

            loop {
                while let Some(sep_pos) = state.buffer.find("\n\n") {
                    let frame = state.buffer[..sep_pos].to_string();
                    state.buffer = state.buffer[sep_pos + 2..].to_string();
                    if frame.trim().is_empty() {
                        continue;
                    }
                    if let Some((event, terminal, completed_payload)) =
                        router_frame_to_generation_event(&frame)
                    {
                        if let Some(payload) = completed_payload.as_ref() {
                            if let Some((ctx, event_bus, meta)) = state.persist.take() {
                                super::persist::persist_completion(
                                    &ctx, &event_bus, &meta, payload,
                                )
                                .await;
                            }
                        }
                        state.done = terminal;
                        return Some((Ok(event), state));
                    }
                }

                match state.bytes.next().await {
                    Some(Ok(chunk)) => {
                        state.buffer.push_str(&String::from_utf8_lossy(&chunk));
                    }
                    Some(Err(e)) => {
                        error!(
                            generation_id = %state.generation_id,
                            error = %e,
                            "image generation router stream failed"
                        );
                        let event = generation_error_event(
                            "UPSTREAM_STREAM_ERROR",
                            format!("Image generation stream failed: {e}"),
                        );
                        state.done = true;
                        return Some((Ok(event), state));
                    }
                    None => {
                        if !state.buffer.trim().is_empty() {
                            let frame = std::mem::take(&mut state.buffer);
                            if let Some((event, terminal, completed_payload)) =
                                router_frame_to_generation_event(&frame)
                            {
                                if let Some(payload) = completed_payload.as_ref() {
                                    if let Some((ctx, event_bus, meta)) = state.persist.take() {
                                        super::persist::persist_completion(
                                            &ctx, &event_bus, &meta, payload,
                                        )
                                        .await;
                                    }
                                }
                                state.done = terminal;
                                return Some((Ok(event), state));
                            }
                        }
                        error!(
                            generation_id = %state.generation_id,
                            "image generation router stream closed before a terminal event"
                        );
                        let event = generation_error_event(
                            "UPSTREAM_STREAM_CLOSED",
                            "Image generation stream closed before completing.",
                        );
                        state.done = true;
                        return Some((Ok(event), state));
                    }
                }
            }
        },
    ))
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
