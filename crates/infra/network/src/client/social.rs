use crate::error::NetworkError;
use crate::types::*;

use super::NetworkClient;

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

    pub async fn unfollow_profile(
        &self,
        profile_id: &str,
        jwt: &str,
    ) -> Result<(), NetworkError> {
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
        let mut params = Vec::new();
        if let Some(f) = filter {
            params.push(format!("filter={}", f));
        }
        if let Some(l) = limit {
            params.push(format!("limit={}", l));
        }
        if let Some(o) = offset {
            params.push(format!("offset={}", o));
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
        title: &str,
        summary: Option<&str>,
        post_type: Option<&str>,
        metadata: Option<serde_json::Value>,
        jwt: &str,
    ) -> Result<NetworkFeedEvent, NetworkError> {
        let mut body = serde_json::json!({ "title": title });
        if let Some(s) = summary {
            body["summary"] = serde_json::Value::String(s.to_string());
        }
        if let Some(pt) = post_type {
            body["postType"] = serde_json::Value::String(pt.to_string());
        }
        if let Some(m) = metadata {
            body["metadata"] = m;
        }
        self.post_authed(
            &format!("{}/api/posts", self.base_url),
            jwt,
            &body,
        )
        .await
    }

    pub async fn get_post(
        &self,
        post_id: &str,
        jwt: &str,
    ) -> Result<NetworkFeedEvent, NetworkError> {
        self.get_authed(
            &format!("{}/api/posts/{}", self.base_url, post_id),
            jwt,
        )
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
            &format!(
                "{}/api/posts/{}/comments",
                self.base_url, post_id
            ),
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
            &format!(
                "{}/api/posts/{}/comments",
                self.base_url, post_id
            ),
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
}
