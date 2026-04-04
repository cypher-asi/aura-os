use std::convert::Infallible;
use std::pin::Pin;

use axum::extract::State;
use axum::http::HeaderValue;
use axum::response::sse::{Event, KeepAlive, Sse};
use axum::Json;
use futures_util::StreamExt;
use reqwest::StatusCode as ReqwestStatus;
use serde_json::json;
use tracing::{error, info};

use crate::dto::{Generate3dRequest, GenerateImageRequest};
use crate::error::{ApiError, ApiResult};
use crate::state::{AppState, AuthJwt};

type SseStream = Pin<Box<dyn futures_core::Stream<Item = Result<Event, Infallible>> + Send>>;
type SseResponse = ([(&'static str, HeaderValue); 1], Sse<SseStream>);

const SSE_NO_BUFFERING_HEADERS: [(&str, HeaderValue); 1] = [(
    "X-Accel-Buffering",
    HeaderValue::from_static("no"),
)];

fn router_url(state: &AppState) -> String {
    state.super_agent_service.router_url.clone()
}

/// Re-emit an upstream SSE frame from aura-router into our own SSE stream,
/// translating the router event types into the `generation_*` namespace that
/// the frontend understands.
fn translate_router_event(event_type: &str, data: &str, mode: &str) -> Event {
    match event_type {
        "start" => Event::default()
            .event("generation_start")
            .json_data(&json!({ "mode": mode, "ts": data }))
            .unwrap_or_else(|_| Event::default().data("{}")),
        "progress" => {
            let parsed: serde_json::Value =
                serde_json::from_str(data).unwrap_or(json!({}));
            Event::default()
                .event("generation_progress")
                .json_data(&json!({
                    "percent": parsed.get("percent").and_then(|v| v.as_f64()).unwrap_or(0.0),
                    "message": parsed.get("message").and_then(|v| v.as_str()).unwrap_or(""),
                }))
                .unwrap_or_else(|_| Event::default().data("{}"))
        }
        "partial-image" => {
            let parsed: serde_json::Value =
                serde_json::from_str(data).unwrap_or(json!({}));
            Event::default()
                .event("generation_partial_image")
                .json_data(&json!({
                    "data": parsed.get("data").and_then(|v| v.as_str()).unwrap_or(""),
                }))
                .unwrap_or_else(|_| Event::default().data("{}"))
        }
        "completed" => {
            let mut parsed: serde_json::Value =
                serde_json::from_str(data).unwrap_or(json!({}));
            if let Some(obj) = parsed.as_object_mut() {
                obj.insert("mode".to_string(), json!(mode));
            }
            Event::default()
                .event("generation_completed")
                .json_data(&parsed)
                .unwrap_or_else(|_| Event::default().data("{}"))
        }
        "submitted" => {
            let parsed: serde_json::Value =
                serde_json::from_str(data).unwrap_or(json!({}));
            Event::default()
                .event("generation_progress")
                .json_data(&json!({
                    "percent": 5,
                    "message": format!("Task submitted: {}", parsed.get("taskId").and_then(|v| v.as_str()).unwrap_or("")),
                }))
                .unwrap_or_else(|_| Event::default().data("{}"))
        }
        "error" => {
            let parsed: serde_json::Value =
                serde_json::from_str(data).unwrap_or(json!({}));
            Event::default()
                .event("generation_error")
                .json_data(&json!({
                    "code": parsed.get("code").and_then(|v| v.as_str()).unwrap_or("GENERATION_FAILED"),
                    "message": parsed.get("message").and_then(|v| v.as_str()).unwrap_or("Generation failed"),
                }))
                .unwrap_or_else(|_| Event::default().data("{}"))
        }
        _ => {
            let parsed: serde_json::Value =
                serde_json::from_str(data).unwrap_or(json!(data));
            Event::default()
                .event(event_type)
                .json_data(&parsed)
                .unwrap_or_else(|_| Event::default().data("{}"))
        }
    }
}

/// Stream SSE from aura-router back to the client, translating events.
async fn proxy_sse_stream(
    url: &str,
    jwt: &str,
    body: serde_json::Value,
    mode: &'static str,
) -> ApiResult<SseResponse> {
    let client = reqwest::Client::new();
    let resp = client
        .post(url)
        .bearer_auth(jwt)
        .json(&body)
        .send()
        .await
        .map_err(|e| {
            error!(error = %e, "generation proxy: upstream request failed");
            ApiError::bad_gateway(format!("upstream request failed: {e}"))
        })?;

    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        error!(%status, body = %text, "generation proxy: upstream error");
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

    let byte_stream = resp.bytes_stream();
    let mode_static: &'static str = mode;

    let sse_stream = futures_util::stream::unfold(
        (byte_stream, String::new(), false),
        move |(mut stream, mut buffer, done)| async move {
            if done {
                return None;
            }
            loop {
                if let Some(sep_pos) = buffer.find("\n\n") {
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

                    if !event_type.is_empty() && !data.is_empty() {
                        let evt = translate_router_event(&event_type, &data, mode_static);
                        return Some((Ok(evt), (stream, buffer, false)));
                    }
                    continue;
                }

                match stream.next().await {
                    Some(Ok(chunk)) => {
                        buffer.push_str(&String::from_utf8_lossy(&chunk));
                    }
                    Some(Err(e)) => {
                        let evt = Event::default()
                            .event("generation_error")
                            .json_data(&json!({
                                "code": "STREAM_ERROR",
                                "message": format!("Stream error: {e}"),
                            }))
                            .unwrap_or_else(|_| Event::default().data("{}"));
                        return Some((Ok(evt), (stream, buffer, true)));
                    }
                    None => {
                        if !buffer.trim().is_empty() {
                            let mut event_type = String::new();
                            let mut data = String::new();
                            for line in buffer.split('\n') {
                                if let Some(rest) = line.strip_prefix("event: ") {
                                    event_type = rest.trim().to_string();
                                } else if let Some(rest) = line.strip_prefix("data: ") {
                                    data = rest.trim().to_string();
                                }
                            }
                            buffer.clear();
                            if !event_type.is_empty() && !data.is_empty() {
                                let evt =
                                    translate_router_event(&event_type, &data, mode_static);
                                return Some((Ok(evt), (stream, buffer, false)));
                            }
                        }

                        let done_evt = Event::default()
                            .event("done")
                            .json_data(&json!({}))
                            .unwrap_or_else(|_| Event::default().data("{}"));
                        return Some((Ok::<_, Infallible>(done_evt), (stream, String::new(), true)));
                    }
                }
            }
        },
    );

    let boxed: SseStream = Box::pin(sse_stream);
    Ok((
        SSE_NO_BUFFERING_HEADERS,
        Sse::new(boxed).keep_alive(KeepAlive::default()),
    ))
}

pub(crate) async fn generate_image_stream(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    Json(body): Json<GenerateImageRequest>,
) -> ApiResult<SseResponse> {
    super::billing::require_credits(&state, &jwt).await?;
    info!(model = ?body.model, "Image generation stream requested");

    let url = format!("{}/v1/generate-image/stream", router_url(&state));

    let mut payload = json!({
        "prompt": body.prompt,
    });
    if let Some(model) = &body.model {
        payload["model"] = json!(model);
    }
    if let Some(size) = &body.size {
        payload["size"] = json!(size);
    }
    if let Some(images) = &body.images {
        payload["images"] = json!(images);
    }
    if let Some(pid) = &body.project_id {
        payload["projectId"] = json!(pid);
    }
    if let Some(iter) = body.is_iteration {
        payload["isIteration"] = json!(iter);
    }

    proxy_sse_stream(&url, &jwt, payload, "image").await
}

pub(crate) async fn generate_3d_stream(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    Json(body): Json<Generate3dRequest>,
) -> ApiResult<SseResponse> {
    super::billing::require_credits(&state, &jwt).await?;
    info!("3D generation stream requested");

    let url = format!("{}/v1/generate-3d/stream", router_url(&state));

    let mut payload = json!({
        "imageUrl": body.image_url,
    });
    if let Some(prompt) = &body.prompt {
        payload["prompt"] = json!(prompt);
    }
    if let Some(pid) = &body.project_id {
        payload["projectId"] = json!(pid);
    }

    proxy_sse_stream(&url, &jwt, payload, "3d").await
}
