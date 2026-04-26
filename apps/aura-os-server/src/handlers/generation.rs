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

const SSE_NO_BUFFERING_HEADERS: [(&str, HeaderValue); 1] =
    [("X-Accel-Buffering", HeaderValue::from_static("no"))];

fn router_url(state: &AppState) -> String {
    state.router_url.clone()
}

/// Re-emit an upstream SSE frame from aura-router into our own SSE stream,
/// translating the router event types into the `generation_*` namespace that
/// the frontend understands.
fn translate_router_event(event_type: &str, data: &str, mode: &str) -> Event {
    match event_type {
        "start" => Event::default()
            .event("generation_start")
            .json_data(json!({ "mode": mode, "ts": data }))
            .unwrap_or_else(|_| Event::default().data("{}")),
        "progress" => {
            let parsed: serde_json::Value = serde_json::from_str(data).unwrap_or(json!({}));
            Event::default()
                .event("generation_progress")
                .json_data(json!({
                    "percent": parsed.get("percent").and_then(|v| v.as_f64()).unwrap_or(0.0),
                    "message": parsed.get("message").and_then(|v| v.as_str()).unwrap_or(""),
                }))
                .unwrap_or_else(|_| Event::default().data("{}"))
        }
        "partial-image" => {
            let parsed: serde_json::Value = serde_json::from_str(data).unwrap_or(json!({}));
            Event::default()
                .event("generation_partial_image")
                .json_data(json!({
                    "data": parsed.get("data").and_then(|v| v.as_str()).unwrap_or(""),
                }))
                .unwrap_or_else(|_| Event::default().data("{}"))
        }
        "completed" => {
            let mut parsed: serde_json::Value = serde_json::from_str(data).unwrap_or(json!({}));
            if let Some(obj) = parsed.as_object_mut() {
                obj.insert("mode".to_string(), json!(mode));
            }
            Event::default()
                .event("generation_completed")
                .json_data(&parsed)
                .unwrap_or_else(|_| Event::default().data("{}"))
        }
        "submitted" => {
            let parsed: serde_json::Value = serde_json::from_str(data).unwrap_or(json!({}));
            Event::default()
                .event("generation_progress")
                .json_data(json!({
                    "percent": 5,
                    "message": format!(
                        "Task submitted: {}",
                        parsed.get("taskId").and_then(|v| v.as_str()).unwrap_or("")
                    ),
                }))
                .unwrap_or_else(|_| Event::default().data("{}"))
        }
        "error" => {
            let parsed: serde_json::Value = serde_json::from_str(data).unwrap_or(json!({}));
            Event::default()
                .event("generation_error")
                .json_data(json!({
                    "code": parsed
                        .get("code")
                        .and_then(|v| v.as_str())
                        .unwrap_or("GENERATION_FAILED"),
                    "message": parsed
                        .get("message")
                        .and_then(|v| v.as_str())
                        .unwrap_or("Generation failed"),
                }))
                .unwrap_or_else(|_| Event::default().data("{}"))
        }
        _ => {
            let parsed: serde_json::Value = serde_json::from_str(data).unwrap_or(json!(data));
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

                    // When the upstream sends `data: {"type":"..."}` without
                    // a separate `event:` line, extract the type from the JSON.
                    if event_type.is_empty() && !data.is_empty() {
                        if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&data) {
                            if let Some(t) = parsed.get("type").and_then(|v| v.as_str()) {
                                event_type = t.to_string();
                            }
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
                            .json_data(json!({
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
                                let evt = translate_router_event(&event_type, &data, mode_static);
                                return Some((Ok(evt), (stream, buffer, false)));
                            }
                        }

                        let done_evt = Event::default()
                            .event("done")
                            .json_data(json!({}))
                            .unwrap_or_else(|_| Event::default().data("{}"));
                        return Some((
                            Ok::<_, Infallible>(done_evt),
                            (stream, String::new(), true),
                        ));
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
    if let Some(project_id) = &body.project_id {
        payload["projectId"] = json!(project_id);
    }
    if let Some(is_iteration) = body.is_iteration {
        payload["isIteration"] = json!(is_iteration);
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
    if let Some(project_id) = &body.project_id {
        payload["projectId"] = json!(project_id);
    }
    if let Some(parent_id) = &body.parent_id {
        payload["parentId"] = json!(parent_id);
    }

    proxy_sse_stream(&url, &jwt, payload, "3d").await
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
    super::billing::require_credits(state, jwt).await?;

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

async fn run_generate_image_to_completion(
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
        obj.entry("prompt")
            .or_insert_with(|| json!(prompt));
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
mod tests {
    use super::*;

    fn sse_frame(event: &str, data: &serde_json::Value) -> String {
        format!("event: {event}\ndata: {}\n\n", data)
    }

    async fn start_mock_router(
        body: String,
        status: u16,
    ) -> (String, tokio::task::JoinHandle<()>) {
        use std::convert::Infallible;
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        use tokio::net::TcpListener;

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
            let response = format!(
                "HTTP/1.1 {status} OK\r\nContent-Type: text/event-stream\r\nConnection: close\r\n\r\n{body}"
            );
            let _ = socket.write_all(response.as_bytes()).await;
            let _ = socket.shutdown().await;
            let _: Result<(), Infallible> = Ok(());
        });

        (url, handle)
    }

    #[tokio::test]
    async fn run_generate_image_to_completion_returns_completed_payload() {
        let body = sse_frame(
            "progress",
            &json!({ "percent": 25, "message": "rendering" }),
        ) + &sse_frame(
            "completed",
            &json!({
                "imageUrl": "https://cdn.example.com/img.png",
                "originalUrl": "https://cdn.example.com/img-orig.png",
                "artifactId": "art-1",
            }),
        );

        let (base_url, handle) = start_mock_router(body, 200).await;
        let url = format!("{base_url}/v1/generate-image/stream");

        let result = run_generate_image_to_completion(
            &url,
            "jwt",
            json!({ "prompt": "a cat", "model": "gpt-image-2" }),
            "a cat",
            "gpt-image-2",
        )
        .await
        .expect("should complete");

        assert_eq!(result["imageUrl"], "https://cdn.example.com/img.png");
        assert_eq!(result["originalUrl"], "https://cdn.example.com/img-orig.png");
        assert_eq!(result["artifactId"], "art-1");
        assert_eq!(result["model"], "gpt-image-2");
        assert_eq!(result["prompt"], "a cat");
        assert_eq!(result["meta"]["model"], "gpt-image-2");
        assert_eq!(result["meta"]["prompt"], "a cat");

        handle.abort();
    }

    #[tokio::test]
    async fn run_generate_image_to_completion_propagates_error_event() {
        let body = sse_frame(
            "error",
            &json!({ "code": "GENERATION_FAILED", "message": "model unavailable" }),
        );

        let (base_url, handle) = start_mock_router(body, 200).await;
        let url = format!("{base_url}/v1/generate-image/stream");

        let err = run_generate_image_to_completion(
            &url,
            "jwt",
            json!({ "prompt": "x", "model": "gpt-image-2" }),
            "x",
            "gpt-image-2",
        )
        .await
        .expect_err("should error");

        let payload = serde_json::to_value(&err.1 .0).unwrap();
        assert_eq!(payload["code"], "bad_gateway");
        assert!(payload["error"].as_str().unwrap().contains("model unavailable"));

        handle.abort();
    }

    #[tokio::test]
    async fn run_generate_image_to_completion_errors_when_no_completed_event() {
        let body = sse_frame("progress", &json!({ "percent": 50 }));

        let (base_url, handle) = start_mock_router(body, 200).await;
        let url = format!("{base_url}/v1/generate-image/stream");

        let err = run_generate_image_to_completion(
            &url,
            "jwt",
            json!({ "prompt": "x", "model": "gpt-image-2" }),
            "x",
            "gpt-image-2",
        )
        .await
        .expect_err("should error without completed event");

        let payload = serde_json::to_value(&err.1 .0).unwrap();
        assert_eq!(payload["code"], "bad_gateway");

        handle.abort();
    }
}
