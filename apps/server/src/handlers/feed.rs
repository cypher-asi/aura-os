use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::Json;
use serde::{Deserialize, Serialize};

use aura_network::{NetworkComment, NetworkFeedEvent};

use crate::error::{map_network_error, ApiResult};
use crate::state::AppState;

#[derive(Debug, Deserialize)]
pub struct FeedQuery {
    pub filter: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct FeedEventResponse {
    pub id: String,
    pub profile_id: String,
    pub event_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub metadata: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub created_at: Option<String>,
}

impl From<NetworkFeedEvent> for FeedEventResponse {
    fn from(e: NetworkFeedEvent) -> Self {
        Self {
            id: e.id,
            profile_id: e.profile_id,
            event_type: e.event_type,
            metadata: e.metadata,
            created_at: e.created_at,
        }
    }
}

#[derive(Debug, Serialize)]
pub struct CommentResponse {
    pub id: String,
    pub activity_event_id: String,
    pub profile_id: String,
    pub content: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub created_at: Option<String>,
}

impl From<NetworkComment> for CommentResponse {
    fn from(c: NetworkComment) -> Self {
        Self {
            id: c.id,
            activity_event_id: c.activity_event_id,
            profile_id: c.profile_id,
            content: c.content,
            created_at: c.created_at,
        }
    }
}

#[derive(Debug, Deserialize)]
pub struct AddCommentRequest {
    pub content: String,
}

pub async fn list_feed(
    State(state): State<AppState>,
    Query(query): Query<FeedQuery>,
) -> ApiResult<Json<Vec<FeedEventResponse>>> {
    let client = state.require_network_client()?;
    let jwt = state.get_jwt()?;
    let events = client
        .get_feed(query.filter.as_deref(), &jwt)
        .await
        .map_err(map_network_error)?;
    Ok(Json(events.into_iter().map(FeedEventResponse::from).collect()))
}

pub async fn list_comments(
    State(state): State<AppState>,
    Path(event_id): Path<String>,
) -> ApiResult<Json<Vec<CommentResponse>>> {
    let client = state.require_network_client()?;
    let jwt = state.get_jwt()?;
    let comments = client
        .list_comments(&event_id, &jwt)
        .await
        .map_err(map_network_error)?;
    Ok(Json(comments.into_iter().map(CommentResponse::from).collect()))
}

pub async fn add_comment(
    State(state): State<AppState>,
    Path(event_id): Path<String>,
    Json(req): Json<AddCommentRequest>,
) -> ApiResult<(StatusCode, Json<CommentResponse>)> {
    let client = state.require_network_client()?;
    let jwt = state.get_jwt()?;
    let comment = client
        .add_comment(&event_id, &req.content, &jwt)
        .await
        .map_err(map_network_error)?;
    Ok((StatusCode::CREATED, Json(CommentResponse::from(comment))))
}

pub async fn delete_comment(
    State(state): State<AppState>,
    Path(comment_id): Path<String>,
) -> ApiResult<StatusCode> {
    let client = state.require_network_client()?;
    let jwt = state.get_jwt()?;
    client
        .delete_comment(&comment_id, &jwt)
        .await
        .map_err(map_network_error)?;
    Ok(StatusCode::NO_CONTENT)
}
