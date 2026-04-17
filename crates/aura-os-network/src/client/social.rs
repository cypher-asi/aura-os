use crate::error::NetworkError;
use crate::types::*;

use super::NetworkClient;

#[derive(Debug)]
pub struct CreatePostParams<'a> {
    pub title: &'a str,
    pub event_type: &'a str,
    pub summary: Option<&'a str>,
    pub post_type: Option<&'a str>,
    pub metadata: Option<serde_json::Value>,
    pub profile_id: Option<&'a str>,
    pub project_id: Option<&'a str>,
    pub agent_id: Option<&'a str>,
    pub user_id: Option<&'a str>,
    pub org_id: Option<&'a str>,
    pub push_id: Option<&'a str>,
    pub commit_ids: Option<&'a [String]>,
    pub jwt: &'a str,
}

impl NetworkClient {
    // -----------------------------------------------------------------------
    // Follows
    // -----------------------------------------------------------------------

    pub async fn follow_profile(
        &self,
        jwt: &str,
        req: &FollowRequest,
    ) -> Result<NetworkFollow, NetworkError> {
        self.post_authed(&format!("{}/api/follows", self.base_url), jwt, req)
            .await
    }

    pub async fn list_follows(&self, jwt: &str) -> Result<Vec<NetworkFollow>, NetworkError> {
        self.get_authed(&format!("{}/api/follows", self.base_url), jwt)
            .await
    }

    pub async fn unfollow_profile(&self, profile_id: &str, jwt: &str) -> Result<(), NetworkError> {
        self.delete_authed(
            &format!("{}/api/follows/{}", self.base_url, profile_id),
            jwt,
        )
        .await
    }

    // -----------------------------------------------------------------------
    // Feed
    // -----------------------------------------------------------------------

    pub async fn get_feed(
        &self,
        filter: Option<&str>,
        limit: Option<u32>,
        offset: Option<u32>,
        jwt: &str,
    ) -> Result<Vec<NetworkFeedEvent>, NetworkError> {
        self.get_feed_with_sort(filter, None, limit, offset, jwt)
            .await
    }

    /// Feed fetch with an optional `sort` parameter. Added in phase 3 so the
    /// Feedback app can forward `most_voted | least_voted | popular |
    /// trending` straight through to aura-network without re-sorting on the
    /// Aura OS server.
    pub async fn get_feed_with_sort(
        &self,
        filter: Option<&str>,
        sort: Option<&str>,
        limit: Option<u32>,
        offset: Option<u32>,
        jwt: &str,
    ) -> Result<Vec<NetworkFeedEvent>, NetworkError> {
        let mut params = Vec::new();
        if let Some(filter_val) = filter {
            params.push(format!("filter={filter_val}"));
        }
        if let Some(sort_val) = sort {
            params.push(format!("sort={sort_val}"));
        }
        if let Some(limit_val) = limit {
            params.push(format!("limit={limit_val}"));
        }
        if let Some(offset_val) = offset {
            params.push(format!("offset={offset_val}"));
        }
        let qs = if params.is_empty() {
            String::new()
        } else {
            format!("?{}", params.join("&"))
        };
        self.get_authed(&format!("{}/api/feed{}", self.base_url, qs), jwt)
            .await
    }

    // -----------------------------------------------------------------------
    // Posts
    // -----------------------------------------------------------------------

    pub async fn create_post(
        &self,
        params: &CreatePostParams<'_>,
    ) -> Result<NetworkFeedEvent, NetworkError> {
        let mut body = serde_json::json!({
            "title": params.title,
            "eventType": params.event_type,
        });
        if let Some(summary_val) = params.summary {
            body["summary"] = serde_json::Value::String(summary_val.to_string());
        }
        if let Some(pt) = params.post_type {
            body["postType"] = serde_json::Value::String(pt.to_string());
        }
        if let Some(ref meta) = params.metadata {
            body["metadata"] = meta.clone();
        }
        if let Some(pid) = params.profile_id {
            body["profileId"] = serde_json::Value::String(pid.to_string());
        }
        if let Some(pid) = params.project_id {
            body["projectId"] = serde_json::Value::String(pid.to_string());
        }
        if let Some(aid) = params.agent_id {
            body["agentId"] = serde_json::Value::String(aid.to_string());
        }
        if let Some(uid) = params.user_id {
            body["userId"] = serde_json::Value::String(uid.to_string());
        }
        if let Some(oid) = params.org_id {
            body["orgId"] = serde_json::Value::String(oid.to_string());
        }
        if let Some(pid) = params.push_id {
            body["pushId"] = serde_json::Value::String(pid.to_string());
        }
        if let Some(cids) = params.commit_ids {
            body["commitIds"] = serde_json::json!(cids);
        }
        self.post_authed(&format!("{}/api/posts", self.base_url), params.jwt, &body)
            .await
    }

    pub async fn get_post(
        &self,
        post_id: &str,
        jwt: &str,
    ) -> Result<NetworkFeedEvent, NetworkError> {
        self.get_authed(&format!("{}/api/posts/{}", self.base_url, post_id), jwt)
            .await
    }

    pub async fn get_profile_posts(
        &self,
        profile_id: &str,
        jwt: &str,
    ) -> Result<Vec<NetworkFeedEvent>, NetworkError> {
        self.get_authed(
            &format!("{}/api/profiles/{}/posts", self.base_url, profile_id),
            jwt,
        )
        .await
    }

    // -----------------------------------------------------------------------
    // Comments
    // -----------------------------------------------------------------------

    pub async fn list_comments(
        &self,
        post_id: &str,
        jwt: &str,
    ) -> Result<Vec<NetworkComment>, NetworkError> {
        self.get_authed(
            &format!("{}/api/posts/{}/comments", self.base_url, post_id),
            jwt,
        )
        .await
    }

    pub async fn add_comment(
        &self,
        post_id: &str,
        content: &str,
        jwt: &str,
    ) -> Result<NetworkComment, NetworkError> {
        self.post_authed(
            &format!("{}/api/posts/{}/comments", self.base_url, post_id),
            jwt,
            &serde_json::json!({ "content": content }),
        )
        .await
    }

    pub async fn delete_comment(&self, comment_id: &str, jwt: &str) -> Result<(), NetworkError> {
        self.delete_authed(
            &format!("{}/api/comments/{}", self.base_url, comment_id),
            jwt,
        )
        .await
    }

    // -----------------------------------------------------------------------
    // Votes
    // -----------------------------------------------------------------------

    pub async fn cast_vote(
        &self,
        post_id: &str,
        vote: &str,
        jwt: &str,
    ) -> Result<NetworkVoteSummary, NetworkError> {
        self.post_authed(
            &format!("{}/api/posts/{}/votes", self.base_url, post_id),
            jwt,
            &serde_json::json!({ "vote": vote }),
        )
        .await
    }

    pub async fn get_vote_summary(
        &self,
        post_id: &str,
        jwt: &str,
    ) -> Result<NetworkVoteSummary, NetworkError> {
        self.get_authed(
            &format!("{}/api/posts/{}/votes/summary", self.base_url, post_id),
            jwt,
        )
        .await
    }

    // -----------------------------------------------------------------------
    // Metadata patch (used for feedback status updates)
    // -----------------------------------------------------------------------

    pub async fn patch_post_metadata(
        &self,
        post_id: &str,
        metadata: &serde_json::Value,
        jwt: &str,
    ) -> Result<NetworkFeedEvent, NetworkError> {
        self.patch_authed(
            &format!("{}/api/posts/{}", self.base_url, post_id),
            jwt,
            &serde_json::json!({ "metadata": metadata }),
        )
        .await
    }
}
