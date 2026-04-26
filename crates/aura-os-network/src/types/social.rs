use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NetworkFollow {
    #[serde(default)]
    pub id: Option<String>,
    pub follower_profile_id: String,
    pub target_profile_id: String,
    #[serde(default)]
    pub created_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FollowRequest {
    pub target_profile_id: String,
}

// ---------------------------------------------------------------------------
// Feed types
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NetworkFeedEvent {
    pub id: String,
    #[serde(alias = "profile_id")]
    pub profile_id: String,
    #[serde(default, alias = "org_id")]
    pub org_id: Option<String>,
    #[serde(default, alias = "project_id")]
    pub project_id: Option<String>,
    #[serde(alias = "event_type")]
    pub event_type: String,
    #[serde(default, alias = "post_type")]
    pub post_type: Option<String>,
    #[serde(default)]
    pub title: Option<String>,
    #[serde(default)]
    pub summary: Option<String>,
    #[serde(default)]
    pub metadata: Option<serde_json::Value>,
    #[serde(default, alias = "agent_id")]
    pub agent_id: Option<String>,
    #[serde(default, alias = "user_id")]
    pub user_id: Option<String>,
    #[serde(default, alias = "push_id")]
    pub push_id: Option<String>,
    #[serde(default, alias = "commit_ids")]
    pub commit_ids: Option<Vec<String>>,
    #[serde(default, alias = "created_at")]
    pub created_at: Option<String>,
    #[serde(default, alias = "comment_count")]
    pub comment_count: i64,
    // Vote aggregates. Optional + #[serde(default)] so older aura-network
    // versions (that don't include them) still deserialize cleanly.
    #[serde(default)]
    pub upvotes: i64,
    #[serde(default)]
    pub downvotes: i64,
    #[serde(default, alias = "vote_score")]
    pub vote_score: i64,
    #[serde(default = "default_viewer_vote", alias = "viewer_vote")]
    pub viewer_vote: String,
}

fn default_viewer_vote() -> String {
    "none".to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NetworkVoteSummary {
    #[serde(default)]
    pub upvotes: i64,
    #[serde(default)]
    pub downvotes: i64,
    #[serde(default)]
    pub score: i64,
    #[serde(default = "default_viewer_vote", alias = "viewer_vote")]
    pub viewer_vote: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NetworkComment {
    pub id: String,
    #[serde(alias = "activity_event_id")]
    pub activity_event_id: String,
    #[serde(alias = "profile_id")]
    pub profile_id: String,
    pub content: String,
    #[serde(default, alias = "created_at")]
    pub created_at: Option<String>,
}
