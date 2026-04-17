//! Aura OS server handlers for the Feedback app.
//!
//! Phase 2: thin proxy and adapter over the existing aura-network post/comment
//! surface. Feedback posts are modelled as `activity_events` with
//! `event_type="feedback"`, `post_type="post"`, and feedback-specific values in
//! the `metadata` JSON blob. Vote aggregates and status updates are still
//! stubbed — they land in phase 3 once aura-network exposes the corresponding
//! endpoints.

use std::collections::HashMap;

use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::Json;
use futures_util::future::join_all;
use serde::{Deserialize, Serialize};
use tracing::warn;

use aura_os_network::{NetworkClient, NetworkComment, NetworkFeedEvent, NetworkProfile};

use crate::error::{map_network_error, ApiError, ApiResult};
use crate::state::{AppState, AuthJwt, AuthSession};

const FEEDBACK_EVENT_TYPE: &str = "feedback";
const FEEDBACK_POST_TYPE: &str = "post";

/// Canonical category values accepted in feedback metadata.
const CATEGORIES: &[&str] = &["feature_request", "bug", "ui_ux", "feedback", "question"];

/// Canonical status values accepted in feedback metadata.
const STATUSES: &[&str] = &[
    "not_started",
    "in_review",
    "in_progress",
    "done",
    "deployed",
];

/// Accepted sort modes. Non-`latest` values degrade to `latest` in phase 2
/// because vote aggregates are not yet exposed by aura-network.
const SORTS: &[&str] = &["latest", "popular", "trending", "most_voted", "least_voted"];

fn is_uuid(s: &str) -> bool {
    s.len() == 36 && s.chars().filter(|c| *c == '-').count() == 4
}

fn validate_category(value: &str) -> Result<(), (StatusCode, Json<ApiError>)> {
    if CATEGORIES.contains(&value) {
        Ok(())
    } else {
        Err(ApiError::bad_request(format!(
            "unknown feedback category: {value}"
        )))
    }
}

fn validate_status(value: &str) -> Result<(), (StatusCode, Json<ApiError>)> {
    if STATUSES.contains(&value) {
        Ok(())
    } else {
        Err(ApiError::bad_request(format!(
            "unknown feedback status: {value}"
        )))
    }
}

fn validate_sort(value: &str) -> Result<&'static str, (StatusCode, Json<ApiError>)> {
    SORTS
        .iter()
        .copied()
        .find(|s| *s == value)
        .ok_or_else(|| ApiError::bad_request(format!("unknown feedback sort: {value}")))
}

fn metadata_string<'a>(metadata: &'a serde_json::Value, key: &str) -> Option<&'a str> {
    metadata.get(key).and_then(serde_json::Value::as_str)
}

#[derive(Debug, Deserialize)]
pub(crate) struct FeedbackListQuery {
    pub sort: Option<String>,
    pub limit: Option<u32>,
    pub offset: Option<u32>,
}

#[derive(Debug, Deserialize)]
pub(crate) struct CreateFeedbackRequest {
    pub title: Option<String>,
    pub body: String,
    pub category: String,
    pub status: String,
}

#[derive(Debug, Deserialize)]
pub(crate) struct UpdateStatusRequest {
    pub status: String,
}

#[derive(Debug, Deserialize)]
pub(crate) struct VoteRequest {
    pub vote: String,
}

#[derive(Debug, Deserialize)]
pub(crate) struct AddCommentRequest {
    pub content: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct FeedbackItemResponse {
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
    pub category: String,
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub created_at: Option<String>,
    pub comment_count: i64,
    pub upvotes: i64,
    pub downvotes: i64,
    pub vote_score: i64,
    pub viewer_vote: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub author_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub author_avatar: Option<String>,
}

impl FeedbackItemResponse {
    fn from_event(e: NetworkFeedEvent, profiles: &HashMap<String, NetworkProfile>) -> Self {
        let metadata = e.metadata.clone().unwrap_or(serde_json::Value::Null);
        let category = metadata_string(&metadata, "feedbackCategory")
            .or_else(|| metadata_string(&metadata, "feedback_category"))
            .unwrap_or("feedback")
            .to_string();
        let status = metadata_string(&metadata, "feedbackStatus")
            .or_else(|| metadata_string(&metadata, "feedback_status"))
            .unwrap_or("not_started")
            .to_string();
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
            category,
            status,
            created_at: e.created_at,
            comment_count: e.comment_count,
            upvotes: e.upvotes,
            downvotes: e.downvotes,
            vote_score: e.vote_score,
            viewer_vote: e.viewer_vote,
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct FeedbackCommentResponse {
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

impl FeedbackCommentResponse {
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

/// Batch-fetch profiles for a set of ids, falling back through profile → user
/// lookups (same behaviour as the feed handler; feedback reuses the aura-network
/// post/comment endpoints so the same author-resolution semantics apply).
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

pub(crate) async fn list_feedback(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    Query(query): Query<FeedbackListQuery>,
) -> ApiResult<Json<Vec<FeedbackItemResponse>>> {
    let client = state.require_network_client()?;

    let sort = match query.sort.as_deref() {
        Some(value) => validate_sort(value)?,
        None => "latest",
    };

    // Phase 3: aura-network now accepts `filter=feedback` + `sort=...` and
    // inlines vote aggregates per row, so we forward directly.
    let events = client
        .get_feed_with_sort(
            Some("feedback"),
            Some(sort),
            query.limit,
            query.offset,
            &jwt,
        )
        .await
        .map_err(map_network_error)?;

    let profiles =
        resolve_profiles(client, events.iter().map(|e| e.profile_id.as_str()), &jwt).await;

    Ok(Json(
        events
            .into_iter()
            .map(|e| FeedbackItemResponse::from_event(e, &profiles))
            .collect(),
    ))
}

fn build_feedback_metadata(category: &str, status: &str, body: &str) -> serde_json::Value {
    serde_json::json!({
        "feedbackCategory": category,
        "feedbackStatus": status,
        "body": body,
    })
}

pub(crate) async fn create_feedback(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    AuthSession(session): AuthSession,
    Json(req): Json<CreateFeedbackRequest>,
) -> ApiResult<(StatusCode, Json<FeedbackItemResponse>)> {
    if req.body.trim().is_empty() {
        return Err(ApiError::bad_request("feedback body is required"));
    }
    validate_category(&req.category)?;
    validate_status(&req.status)?;

    let client = state.require_network_client()?;
    let profile_id_str = session.profile_id.map(|id| id.to_string());
    let title = req
        .title
        .as_deref()
        .map(str::trim)
        .filter(|t| !t.is_empty())
        .map(str::to_owned)
        .unwrap_or_else(|| {
            let trimmed = req.body.trim();
            let head: String = trimmed.chars().take(80).collect();
            head
        });

    let metadata = build_feedback_metadata(&req.category, &req.status, req.body.trim());

    let post = client
        .create_post(&aura_os_network::client::CreatePostParams {
            title: &title,
            event_type: FEEDBACK_EVENT_TYPE,
            summary: Some(req.body.trim()),
            post_type: Some(FEEDBACK_POST_TYPE),
            metadata: Some(metadata),
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
        Json(FeedbackItemResponse::from_event(post, &profiles)),
    ))
}

pub(crate) async fn get_feedback(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    Path(post_id): Path<String>,
) -> ApiResult<Json<FeedbackItemResponse>> {
    let client = state.require_network_client()?;
    let post = client
        .get_post(&post_id, &jwt)
        .await
        .map_err(map_network_error)?;

    if post.event_type != FEEDBACK_EVENT_TYPE {
        return Err(ApiError::not_found("feedback item not found"));
    }

    let profiles = resolve_profiles(client, [post.profile_id.as_str()], &jwt).await;
    Ok(Json(FeedbackItemResponse::from_event(post, &profiles)))
}

pub(crate) async fn update_feedback_status(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    Path(post_id): Path<String>,
    Json(req): Json<UpdateStatusRequest>,
) -> ApiResult<Json<FeedbackItemResponse>> {
    validate_status(&req.status)?;

    let client = state.require_network_client()?;
    let patch = serde_json::json!({ "feedbackStatus": req.status });
    let post = client
        .patch_post_metadata(&post_id, &patch, &jwt)
        .await
        .map_err(map_network_error)?;

    if post.event_type != FEEDBACK_EVENT_TYPE {
        return Err(ApiError::not_found("feedback item not found"));
    }

    let profiles = resolve_profiles(client, [post.profile_id.as_str()], &jwt).await;
    Ok(Json(FeedbackItemResponse::from_event(post, &profiles)))
}

pub(crate) async fn list_feedback_comments(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    Path(post_id): Path<String>,
) -> ApiResult<Json<Vec<FeedbackCommentResponse>>> {
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
            .map(|c| FeedbackCommentResponse::from_comment(c, &profiles))
            .collect(),
    ))
}

pub(crate) async fn add_feedback_comment(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    Path(post_id): Path<String>,
    Json(req): Json<AddCommentRequest>,
) -> ApiResult<(StatusCode, Json<FeedbackCommentResponse>)> {
    if req.content.trim().is_empty() {
        return Err(ApiError::bad_request("comment content is required"));
    }

    let client = state.require_network_client()?;
    let comment = client
        .add_comment(&post_id, &req.content, &jwt)
        .await
        .map_err(map_network_error)?;

    let profiles = resolve_profiles(client, [comment.profile_id.as_str()], &jwt).await;
    Ok((
        StatusCode::CREATED,
        Json(FeedbackCommentResponse::from_comment(comment, &profiles)),
    ))
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct FeedbackVoteResponse {
    pub upvotes: i64,
    pub downvotes: i64,
    pub vote_score: i64,
    pub viewer_vote: String,
}

pub(crate) async fn cast_feedback_vote(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    Path(post_id): Path<String>,
    Json(req): Json<VoteRequest>,
) -> ApiResult<Json<FeedbackVoteResponse>> {
    if !matches!(req.vote.as_str(), "up" | "down" | "none") {
        return Err(ApiError::bad_request(format!(
            "unknown vote value: {}",
            req.vote
        )));
    }

    let client = state.require_network_client()?;
    let summary = client
        .cast_vote(&post_id, &req.vote, &jwt)
        .await
        .map_err(map_network_error)?;

    Ok(Json(FeedbackVoteResponse {
        upvotes: summary.upvotes,
        downvotes: summary.downvotes,
        vote_score: summary.score,
        viewer_vote: summary.viewer_vote,
    }))
}
