use axum::extract::State;
use axum::Json;
use futures_util::StreamExt;
use reqwest::StatusCode as ReqwestStatus;
use tracing::info;

use crate::error::{ApiError, ApiResult};
use crate::handlers::billing;
use crate::state::{AppState, AuthJwt, AuthSession};

use super::harness_stream::{
    open_generation_stream, resolve_generation_identity, GenerationPersistArgs,
};
use super::persist::{
    persist_user_prompt, resolve_persist_ctx, GenerationPersistMeta, GenerationPersistTargets,
};
use super::router_proxy::router_url;
use super::sse::SseResponse;

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GenerateVideoRequest {
    pub prompt: String,
    pub model: Option<String>,
    pub aspect_ratio: Option<String>,
    pub duration_seconds: Option<u8>,
    pub resolution: Option<String>,
    pub generate_audio: Option<bool>,
    /// Source images for image-to-video. Each entry is a fully-resolved
    /// URL or a `data:<mime>;base64,...` string, mirroring
    /// [`crate::dto::GenerateImageRequest::images`].
    pub images: Option<Vec<String>>,
    #[serde(rename = "projectId")]
    pub project_id: Option<String>,
    pub agent_id: Option<String>,
    pub agent_instance_id: Option<String>,
    /// See [`crate::dto::GenerateImageRequest::new_session`]. Accepts
    /// `new_session` (snake_case) on the wire because the chat-input "+"
    /// affordance forwards the flag with that exact key — keep the
    /// rename here so the camelCase struct default doesn't turn it into
    /// `newSession`.
    #[serde(default, rename = "new_session")]
    pub new_session: Option<bool>,
    /// See [`crate::dto::GenerateImageRequest::session_id`]. Same
    /// snake_case rename rationale as `new_session`.
    #[serde(default, rename = "session_id")]
    pub session_id: Option<String>,
}

pub(crate) async fn generate_video_stream(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    AuthSession(auth_session): AuthSession,
    Json(body): Json<GenerateVideoRequest>,
) -> ApiResult<SseResponse> {
    billing::require_credits(&state, &jwt).await?;
    info!(model = ?body.model, "Video generation stream requested");

    let identity =
        resolve_generation_identity(&state, &auth_session, &jwt, body.project_id.as_deref())
            .await?;

    // Video-mode generation lives outside the regular chat stream, so
    // we resolve the chat-session persistence context separately and
    // (best-effort) write a `user_message` row up front. The companion
    // assistant turn is persisted when the harness stream emits its
    // terminal completion event. If no chat scope was threaded through
    // (legacy clients, AURA Video app), `persist` stays `None` and
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
            size: None,
            tool_name: "generate_video",
        },
    });

    open_generation_stream(
        state,
        jwt,
        aura_protocol::GenerationRequest {
            mode: "video".to_string(),
            prompt: Some(body.prompt),
            model: body.model,
            size: None,
            quality: None,
            image_url: None,
            images: body.images,
            project_id: body.project_id,
            parent_id: None,
            is_iteration: None,
            aspect_ratio: body.aspect_ratio,
            duration_seconds: body.duration_seconds,
            resolution: body.resolution,
            generate_audio: body.generate_audio,
        },
        identity,
        persist_args,
    )
    .await
}

/// Default model used by the chat-agent `generate_video` tool when the
/// caller omits the `model` argument. Kept in sync with
/// `interface/src/constants/models.ts::VIDEO_MODELS[0]`.
const DEFAULT_GENERATE_VIDEO_TOOL_MODEL: &str = "veo-3.1-fast-generate-preview";

/// Non-streaming entry point for the chat-agent `generate_video` tool.
///
/// The HTTP `/api/generate/video/stream` route streams progress frames
/// so the UI can show a render countdown; tool calls instead need a
/// single JSON response. This consumes the upstream router SSE,
/// ignores progress frames, and returns the final `completed` payload
/// (or the upstream error) as a JSON value the harness can hand back
/// to the LLM as a tool result.
pub(crate) async fn generate_video_tool(
    state: &AppState,
    jwt: &str,
    args: &serde_json::Value,
) -> ApiResult<serde_json::Value> {
    billing::require_credits(state, jwt).await?;

    let prompt = args
        .get("prompt")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .ok_or_else(|| ApiError::bad_request("`prompt` is required"))?;
    let model = args
        .get("model")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or(DEFAULT_GENERATE_VIDEO_TOOL_MODEL);
    let aspect_ratio = args
        .get("aspect_ratio")
        .or_else(|| args.get("aspectRatio"))
        .and_then(|v| v.as_str());
    let duration_seconds = args
        .get("duration_seconds")
        .or_else(|| args.get("durationSeconds"))
        .and_then(serde_json::Value::as_u64);
    let resolution = args.get("resolution").and_then(|v| v.as_str());
    let generate_audio = args
        .get("generate_audio")
        .or_else(|| args.get("generateAudio"))
        .and_then(serde_json::Value::as_bool);
    let images = args
        .get("images")
        .and_then(|v| v.as_array())
        .map(|values| {
            values
                .iter()
                .filter_map(|value| value.as_str().map(str::to_string))
                .collect::<Vec<_>>()
        })
        .filter(|images| !images.is_empty());
    let project_id = args
        .get("project_id")
        .or_else(|| args.get("projectId"))
        .and_then(|v| v.as_str());

    info!(
        model = %model,
        aspect_ratio = ?aspect_ratio,
        duration_seconds = ?duration_seconds,
        resolution = ?resolution,
        "generate_video tool invocation"
    );

    let mut payload = serde_json::json!({
        "prompt": prompt,
        "model": model,
    });
    if let Some(aspect_ratio) = aspect_ratio {
        payload["aspectRatio"] = serde_json::json!(aspect_ratio);
    }
    if let Some(duration_seconds) = duration_seconds {
        payload["durationSeconds"] = serde_json::json!(duration_seconds);
    }
    if let Some(resolution) = resolution {
        payload["resolution"] = serde_json::json!(resolution);
    }
    if let Some(generate_audio) = generate_audio {
        payload["generateAudio"] = serde_json::json!(generate_audio);
    }
    if let Some(images) = images {
        payload["images"] = serde_json::json!(images);
    }
    if let Some(project_id) = project_id {
        payload["projectId"] = serde_json::json!(project_id);
    }

    let url = format!("{}/v1/generate-video/stream", router_url(state));
    run_generate_video_to_completion(&url, jwt, payload, prompt, model).await
}

async fn run_generate_video_to_completion(
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
        .map_err(|e| ApiError::bad_gateway(format!("upstream request failed: {e}")))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
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
                }
                "error" => {
                    last_error = Some(
                        parsed
                            .get("message")
                            .and_then(|v| v.as_str())
                            .unwrap_or("upstream video generation failed")
                            .to_string(),
                    );
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
    // video renderer (and downstream consumers) have everything they
    // need without a second round-trip.
    if let Some(obj) = completed.as_object_mut() {
        obj.entry("prompt")
            .or_insert_with(|| serde_json::json!(prompt));
        obj.entry("model")
            .or_insert_with(|| serde_json::json!(model));
    }

    Ok(completed)
}
