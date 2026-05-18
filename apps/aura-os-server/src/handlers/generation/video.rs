use axum::extract::State;
use axum::Json;
use tracing::info;

use crate::error::ApiResult;
use crate::handlers::billing;
use crate::state::{AppState, AuthJwt, AuthSession};

use super::harness_stream::{
    open_generation_stream, resolve_generation_identity, GenerationPersistArgs,
};
use super::persist::{
    persist_user_prompt, resolve_persist_ctx, GenerationPersistMeta, GenerationPersistTargets,
};
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
        persist_user_prompt(&state, ctx, &body.prompt, None).await;
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
            image_url: None,
            images: None,
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
