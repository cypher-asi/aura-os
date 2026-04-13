use std::collections::HashMap;

use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::Json;
use futures_util::future::join_all;
use serde::{Deserialize, Serialize};

use tracing::warn;

use aura_os_network::{NetworkClient, NetworkComment, NetworkFeedEvent, NetworkProfile};

use crate::error::{map_network_error, ApiResult};
use crate::state::{AppState, AuthJwt, AuthSession};

fn is_uuid(s: &str) -> bool {
    s.len() == 36 && s.chars().filter(|c| *c == '-').count() == 4
}

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
    pub comment_count: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub author_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub author_avatar: Option<String>,
}

impl FeedEventResponse {
    fn from_event(e: NetworkFeedEvent, profiles: &HashMap<String, NetworkProfile>) -> Self {
        let profile = profiles.get(&e.profile_id);
        Self {
            author_name: profile
                .and_then(|p| p.display_name.clone())
                .filter(|n| !is_uuid(n)),
            author_avatar: profile.and_then(|p| p.avatar_url.clone()),
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
            comment_count: e.comment_count,
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
    #[serde(skip_serializing_if = "Option::is_none")]
    pub author_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub author_avatar: Option<String>,
}

impl CommentResponse {
    fn from_comment(c: NetworkComment, profiles: &HashMap<String, NetworkProfile>) -> Self {
        let profile = profiles.get(&c.profile_id);
        Self {
            author_name: profile
                .and_then(|p| p.display_name.clone())
                .filter(|n| !is_uuid(n)),
            author_avatar: profile.and_then(|p| p.avatar_url.clone()),
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
    pub event_type: Option<String>,
    pub title: String,
    pub summary: Option<String>,
    pub metadata: Option<serde_json::Value>,
}

/// Batch-fetch profiles for a set of profile IDs (deduplicated, concurrent).
/// Uses a fallback chain: profile lookup → user profile lookup → user lookup,
/// because some feed events carry a userId rather than a profileId.
async fn resolve_profiles(
    client: &NetworkClient,
    profile_ids: impl IntoIterator<Item = &str>,
    jwt: &str,
) -> HashMap<String, NetworkProfile> {
    let unique: Vec<String> = {
        let mut seen = std::collections::HashSet::new();
        profile_ids
            .into_iter()
            .filter(|id| !id.is_empty() && seen.insert(id.to_string()))
            .map(String::from)
            .collect()
    };

    let futs = unique.into_iter().map(|id| {
        let client = client.clone();
        let jwt = jwt.to_owned();
        async move {
            if let Ok(p) = client.get_profile(&id, &jwt).await {
                return (id, Some(p));
            }
            if let Ok(p) = client.get_user_profile(&id, &jwt).await {
                return (id, Some(p));
            }
            if let Ok(user) = client.get_user(&id, &jwt).await {
                return (
                    id.clone(),
                    Some(NetworkProfile {
                        id: user.profile_id.unwrap_or(id),
                        display_name: user.display_name,
                        avatar_url: user.avatar_url,
                        bio: user.bio,
                        profile_type: Some("user".into()),
                        entity_id: None,
                        user_id: None,
                        agent_id: None,
                    }),
                );
            }
            warn!(profile_id = %id, "Could not resolve profile via any method");
            (id, None)
        }
    });

    join_all(futs)
        .await
        .into_iter()
        .filter_map(|(id, profile)| profile.map(|p| (id, p)))
        .collect()
}

pub(crate) async fn list_feed(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    Query(query): Query<FeedQuery>,
) -> ApiResult<Json<Vec<FeedEventResponse>>> {
    let client = state.require_network_client()?;
    let events = client
        .get_feed(query.filter.as_deref(), query.limit, query.offset, &jwt)
        .await
        .map_err(map_network_error)?;

    let profiles =
        resolve_profiles(client, events.iter().map(|e| e.profile_id.as_str()), &jwt).await;

    Ok(Json(
        events
            .into_iter()
            .map(|e| FeedEventResponse::from_event(e, &profiles))
            .collect(),
    ))
}

pub(crate) async fn create_post(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    AuthSession(session): AuthSession,
    Json(req): Json<CreatePostRequest>,
) -> ApiResult<(StatusCode, Json<FeedEventResponse>)> {
    let client = state.require_network_client()?;
    let profile_id_str = session.profile_id.map(|id| id.to_string());
    let post = client
        .create_post(&aura_os_network::client::CreatePostParams {
            title: &req.title,
            event_type: req.event_type.as_deref().unwrap_or("post"),
            summary: req.summary.as_deref(),
            post_type: req.post_type.as_deref(),
            metadata: req.metadata.clone(),
            profile_id: profile_id_str.as_deref(),
            project_id: None,
            agent_id: None,
            user_id: None,
            org_id: None,
            push_id: None,
            commit_ids: None,
            jwt: &jwt,
        })
        .await
        .map_err(map_network_error)?;

    let profiles = resolve_profiles(client, [post.profile_id.as_str()], &jwt).await;
    Ok((
        StatusCode::CREATED,
        Json(FeedEventResponse::from_event(post, &profiles)),
    ))
}

pub(crate) async fn get_post(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    Path(post_id): Path<String>,
) -> ApiResult<Json<FeedEventResponse>> {
    let client = state.require_network_client()?;
    let post = client
        .get_post(&post_id, &jwt)
        .await
        .map_err(map_network_error)?;

    let profiles = resolve_profiles(client, [post.profile_id.as_str()], &jwt).await;
    Ok(Json(FeedEventResponse::from_event(post, &profiles)))
}

pub(crate) async fn get_profile_posts(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    Path(profile_id): Path<String>,
) -> ApiResult<Json<Vec<FeedEventResponse>>> {
    let client = state.require_network_client()?;
    let posts = client
        .get_profile_posts(&profile_id, &jwt)
        .await
        .map_err(map_network_error)?;

    let profiles =
        resolve_profiles(client, posts.iter().map(|e| e.profile_id.as_str()), &jwt).await;

    Ok(Json(
        posts
            .into_iter()
            .map(|e| FeedEventResponse::from_event(e, &profiles))
            .collect(),
    ))
}

pub(crate) async fn list_comments(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    Path(post_id): Path<String>,
) -> ApiResult<Json<Vec<CommentResponse>>> {
    let client = state.require_network_client()?;
    let comments = client
        .list_comments(&post_id, &jwt)
        .await
        .map_err(map_network_error)?;

    let profiles =
        resolve_profiles(client, comments.iter().map(|c| c.profile_id.as_str()), &jwt).await;

    Ok(Json(
        comments
            .into_iter()
            .map(|c| CommentResponse::from_comment(c, &profiles))
            .collect(),
    ))
}

pub(crate) async fn add_comment(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    Path(post_id): Path<String>,
    Json(req): Json<AddCommentRequest>,
) -> ApiResult<(StatusCode, Json<CommentResponse>)> {
    let client = state.require_network_client()?;
    let comment = client
        .add_comment(&post_id, &req.content, &jwt)
        .await
        .map_err(map_network_error)?;

    let profiles = resolve_profiles(client, [comment.profile_id.as_str()], &jwt).await;
    Ok((
        StatusCode::CREATED,
        Json(CommentResponse::from_comment(comment, &profiles)),
    ))
}

pub(crate) async fn delete_comment(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    Path(comment_id): Path<String>,
) -> ApiResult<StatusCode> {
    let client = state.require_network_client()?;
    client
        .delete_comment(&comment_id, &jwt)
        .await
        .map_err(map_network_error)?;
    Ok(StatusCode::NO_CONTENT)
}
