use axum::extract::State;
use axum::Json;
use futures_util::StreamExt;
use reqwest::StatusCode as ReqwestStatus;
use tracing::info;

use crate::dto::Generate3dRequest;
use crate::error::{ApiError, ApiResult};
use crate::handlers::billing;
use crate::state::{AppState, AuthJwt};

use super::harness_stream::open_generation_stream;
use super::router_proxy::router_url;
use super::sse::SseResponse;

pub(crate) async fn generate_3d_stream(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    Json(body): Json<Generate3dRequest>,
) -> ApiResult<SseResponse> {
    billing::require_credits(&state, &jwt).await?;
    info!("3D generation stream requested");

    open_generation_stream(
        state,
        jwt,
        aura_protocol::GenerationRequest {
            mode: "3d".to_string(),
            prompt: body.prompt,
            model: None,
            size: None,
            image_url: Some(body.image_url),
            images: None,
            project_id: body.project_id,
            parent_id: body.parent_id,
            is_iteration: None,
        },
    )
    .await
}

pub(crate) async fn generate_3d_tool(
    state: &AppState,
    jwt: &str,
    args: &serde_json::Value,
) -> ApiResult<serde_json::Value> {
    billing::require_credits(state, jwt).await?;

    let image_url = args
        .get("image_url")
        .or_else(|| args.get("imageUrl"))
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .ok_or_else(|| ApiError::bad_request("`image_url` is required"))?;
    let prompt = args
        .get("prompt")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty());
    let project_id = args
        .get("project_id")
        .or_else(|| args.get("projectId"))
        .and_then(|v| v.as_str());
    let parent_id = args
        .get("parent_id")
        .or_else(|| args.get("parentId"))
        .and_then(|v| v.as_str());

    info!("generate_3d_model tool invocation");

    let mut payload = serde_json::json!({
        "imageUrl": image_url,
    });
    if let Some(prompt) = prompt {
        payload["prompt"] = serde_json::json!(prompt);
    }
    if let Some(project_id) = project_id {
        payload["projectId"] = serde_json::json!(project_id);
    }
    if let Some(parent_id) = parent_id {
        payload["parentId"] = serde_json::json!(parent_id);
    }

    let url = format!("{}/v1/generate-3d/stream", router_url(state));
    run_generate_3d_to_completion(&url, jwt, payload).await
}

async fn run_generate_3d_to_completion(
    url: &str,
    jwt: &str,
    body: serde_json::Value,
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
                            .unwrap_or("upstream 3D generation failed")
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

    completed.ok_or_else(|| {
        ApiError::bad_gateway("upstream did not emit a `completed` event before closing the stream")
    })
}
