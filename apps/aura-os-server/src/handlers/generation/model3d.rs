use axum::extract::State;
use axum::Json;
use serde_json::json;
use tracing::info;

use crate::dto::Generate3dRequest;
use crate::error::ApiResult;
use crate::handlers::billing;
use crate::state::{AppState, AuthJwt};

use super::router_proxy::{proxy_sse_stream, router_url};
use super::sse::SseResponse;

pub(crate) async fn generate_3d_stream(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    Json(body): Json<Generate3dRequest>,
) -> ApiResult<SseResponse> {
    billing::require_credits(&state, &jwt).await?;
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
