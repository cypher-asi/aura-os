use std::collections::HashMap;

use aura_os_network::{NetworkComment, NetworkFeedEvent, NetworkProfile};
use serde::{Deserialize, Serialize};

use super::{is_uuid, metadata_string, DEFAULT_PRODUCT};

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
    pub product: String,
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
    pub product: String,
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
    pub(super) fn from_event(
        e: NetworkFeedEvent,
        profiles: &HashMap<String, NetworkProfile>,
    ) -> Self {
        let metadata = e.metadata.clone().unwrap_or(serde_json::Value::Null);
        let category = metadata_string(&metadata, "feedbackCategory")
            .or_else(|| metadata_string(&metadata, "feedback_category"))
            .unwrap_or("feedback")
            .to_string();
        let status = metadata_string(&metadata, "feedbackStatus")
            .or_else(|| metadata_string(&metadata, "feedback_status"))
            .unwrap_or("not_started")
            .to_string();
        // Default legacy items (created before product tagging landed) to
        // the shell's default product so they remain visible.
        let product = metadata_string(&metadata, "feedbackProduct")
            .or_else(|| metadata_string(&metadata, "feedback_product"))
            .unwrap_or(DEFAULT_PRODUCT)
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
            product,
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
    pub(super) fn from_comment(
        c: NetworkComment,
        profiles: &HashMap<String, NetworkProfile>,
    ) -> Self {
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

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct FeedbackVoteResponse {
    pub upvotes: i64,
    pub downvotes: i64,
    pub vote_score: i64,
    pub viewer_vote: String,
}
