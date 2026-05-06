use axum::extract::State;
use axum::Json;
use futures_util::StreamExt;
use reqwest::StatusCode as ReqwestStatus;
use serde_json::json;
use tracing::{error, info};

use crate::dto::GenerateImageRequest;
use crate::error::{ApiError, ApiResult};
use crate::handlers::billing;
use crate::state::{AppState, AuthJwt, AuthSession};

use super::harness_stream::{
    open_generation_stream, resolve_generation_identity, GenerationPersistArgs,
};
use super::persist::{persist_user_prompt, resolve_persist_ctx, GenerationPersistMeta};
use super::router_proxy::router_url;
use super::sse::SseResponse;

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
    // assistant turn is persisted by the sibling task spawned inside
    // `open_generation_stream`. If no chat scope was threaded through
    // (legacy clients, AURA 3D app), `persist` stays `None` and
    // generation behaves exactly like before.
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

    open_generation_stream(
        state,
        jwt,
        aura_protocol::GenerationRequest {
            mode: "image".to_string(),
            prompt: Some(body.prompt),
            model: body.model,
            size: body.size,
            image_url: None,
            images: body.images,
            project_id: body.project_id,
            parent_id: None,
            is_iteration: body.is_iteration,
        },
        identity,
        persist_args,
    )
    .await
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
