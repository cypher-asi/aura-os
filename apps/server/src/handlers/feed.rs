use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::Json;
use serde::{Deserialize, Serialize};

use aura_os_network::{NetworkComment, NetworkFeedEvent};

use crate::error::{map_network_error, ApiResult};
use crate::state::AppState;

#[derive(Debug, Deserialize)]
pub(crate) struct FeedQuery {
    pub filter: Option<String>,
    pub limit: Option<u32>,
    pub offset: Option<u32>,
}

#[derive(Debug, Serialize)]
pub(crate) struct FeedEventResponse {
    pub id: String,
    pub profile_id: String,
    pub event_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub post_type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub summary: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub metadata: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub org_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub project_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub agent_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub user_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub push_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub commit_ids: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub created_at: Option<String>,
}

impl From<NetworkFeedEvent> for FeedEventResponse {
    fn from(e: NetworkFeedEvent) -> Self {
        Self {
            id: e.id,
            profile_id: e.profile_id,
            event_type: e.event_type,
            post_type: e.post_type,
            title: e.title,
            summary: e.summary,
            metadata: e.metadata,
            org_id: e.org_id,
            project_id: e.project_id,
            agent_id: e.agent_id,
            user_id: e.user_id,
            push_id: e.push_id,
            commit_ids: e.commit_ids,
            created_at: e.created_at,
        }
    }
}

#[derive(Debug, Serialize)]
pub(crate) struct CommentResponse {
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
pub(crate) struct AddCommentRequest {
    pub content: String,
}

#[derive(Debug, Deserialize)]
pub(crate) struct CreatePostRequest {
    pub post_type: Option<String>,
    pub title: String,
    pub summary: Option<String>,
    pub metadata: Option<serde_json::Value>,
}

pub(crate) async fn list_feed(
    State(state): State<AppState>,
    Query(query): Query<FeedQuery>,
) -> ApiResult<Json<Vec<FeedEventResponse>>> {
    let client = state.require_network_client()?;
    let jwt = state.get_jwt()?;
    let events = client
        .get_feed(query.filter.as_deref(), query.limit, query.offset, &jwt)
        .await
        .map_err(map_network_error)?;
    Ok(Json(
        events.into_iter().map(FeedEventResponse::from).collect(),
    ))
}

pub(crate) async fn create_post(
    State(state): State<AppState>,
    Json(req): Json<CreatePostRequest>,
) -> ApiResult<(StatusCode, Json<FeedEventResponse>)> {
    let client = state.require_network_client()?;
    let jwt = state.get_jwt()?;
    let post = client
        .create_post(&aura_os_network::client::CreatePostParams {
            title: &req.title,
            summary: req.summary.as_deref(),
            post_type: req.post_type.as_deref(),
            metadata: req.metadata.clone(),
            jwt: &jwt,
        })
        .await
        .map_err(map_network_error)?;
    Ok((StatusCode::CREATED, Json(FeedEventResponse::from(post))))
}

pub(crate) async fn get_post(
    State(state): State<AppState>,
    Path(post_id): Path<String>,
) -> ApiResult<Json<FeedEventResponse>> {
    let client = state.require_network_client()?;
    let jwt = state.get_jwt()?;
    let post = client
        .get_post(&post_id, &jwt)
        .await
        .map_err(map_network_error)?;
    Ok(Json(FeedEventResponse::from(post)))
}

pub(crate) async fn get_profile_posts(
    State(state): State<AppState>,
    Path(profile_id): Path<String>,
) -> ApiResult<Json<Vec<FeedEventResponse>>> {
    let client = state.require_network_client()?;
    let jwt = state.get_jwt()?;
    let posts = client
        .get_profile_posts(&profile_id, &jwt)
        .await
        .map_err(map_network_error)?;
    Ok(Json(
        posts.into_iter().map(FeedEventResponse::from).collect(),
    ))
}

pub(crate) async fn list_comments(
    State(state): State<AppState>,
    Path(post_id): Path<String>,
) -> ApiResult<Json<Vec<CommentResponse>>> {
    let client = state.require_network_client()?;
    let jwt = state.get_jwt()?;
    let comments = client
        .list_comments(&post_id, &jwt)
        .await
        .map_err(map_network_error)?;
    Ok(Json(
        comments.into_iter().map(CommentResponse::from).collect(),
    ))
}

pub(crate) async fn add_comment(
    State(state): State<AppState>,
    Path(post_id): Path<String>,
    Json(req): Json<AddCommentRequest>,
) -> ApiResult<(StatusCode, Json<CommentResponse>)> {
    let client = state.require_network_client()?;
    let jwt = state.get_jwt()?;
    let comment = client
        .add_comment(&post_id, &req.content, &jwt)
        .await
        .map_err(map_network_error)?;
    Ok((StatusCode::CREATED, Json(CommentResponse::from(comment))))
}

pub(crate) async fn delete_comment(
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
