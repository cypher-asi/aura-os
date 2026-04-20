use async_trait::async_trait;
use serde_json::json;

use aura_os_core::{Capability, ToolDomain};

use super::helpers::{network_delete, network_get, network_post, require_network, require_str};
use super::{AgentToolContext, AgentTool, CapabilityRequirement, Surface, ToolResult};
use aura_os_agent_runtime::AgentRuntimeError;

// ---------------------------------------------------------------------------
// 1. ListFeedTool
// ---------------------------------------------------------------------------

pub struct ListFeedTool;

#[async_trait]
impl AgentTool for ListFeedTool {
    fn name(&self) -> &str {
        "list_feed"
    }
    fn description(&self) -> &str {
        "List the activity feed with optional filter"
    }
    fn domain(&self) -> ToolDomain {
        ToolDomain::Social
    }
    fn surface(&self) -> Surface {
        Surface::OnDemand
    }
    fn required_capabilities(&self) -> &'static [CapabilityRequirement] {
        // TODO(tier-a): `list_feed` is a read-only social surface; no
        // capability enforced. Downstream `/api/feed` still scopes by
        // the caller's JWT.
        &[]
    }

    fn parameters_schema(&self) -> serde_json::Value {
        json!({
            "type": "object",
            "properties": {
                "filter": {
                    "type": "string",
                    "enum": ["my-agents", "org", "following", "everything"],
                    "description": "Feed filter (defaults to everything)"
                }
            },
            "required": []
        })
    }

    async fn execute(
        &self,
        input: serde_json::Value,
        ctx: &AgentToolContext,
    ) -> Result<ToolResult, AgentRuntimeError> {
        let network = require_network(ctx)?;
        let filter = input["filter"].as_str().unwrap_or("everything");
        network_get(network, &format!("/api/feed?filter={filter}"), &ctx.jwt).await
    }
}

// ---------------------------------------------------------------------------
// 2. CreatePostTool
// ---------------------------------------------------------------------------

pub struct CreatePostTool;

#[async_trait]
impl AgentTool for CreatePostTool {
    fn name(&self) -> &str {
        "create_post"
    }
    fn description(&self) -> &str {
        "Create a new social post"
    }
    fn domain(&self) -> ToolDomain {
        ToolDomain::Social
    }
    fn surface(&self) -> Surface {
        Surface::OnDemand
    }
    fn required_capabilities(&self) -> &'static [CapabilityRequirement] {
        &[CapabilityRequirement::Exact(Capability::PostToFeed)]
    }

    fn parameters_schema(&self) -> serde_json::Value {
        json!({
            "type": "object",
            "properties": {
                "title": { "type": "string", "description": "Post title / content" },
                "summary": { "type": "string", "description": "Optional summary" }
            },
            "required": ["title"]
        })
    }

    async fn execute(
        &self,
        input: serde_json::Value,
        ctx: &AgentToolContext,
    ) -> Result<ToolResult, AgentRuntimeError> {
        let network = require_network(ctx)?;
        let title = require_str(&input, "title")?;
        let mut body = json!({ "title": title });
        if let Some(summary) = input["summary"].as_str() {
            body["summary"] = json!(summary);
        }
        network_post(network, "/api/posts", &ctx.jwt, &body).await
    }
}

// ---------------------------------------------------------------------------
// 3. GetPostTool
// ---------------------------------------------------------------------------

pub struct GetPostTool;

#[async_trait]
impl AgentTool for GetPostTool {
    fn name(&self) -> &str {
        "get_post"
    }
    fn description(&self) -> &str {
        "Get a specific post and its comments"
    }
    fn domain(&self) -> ToolDomain {
        ToolDomain::Social
    }
    fn surface(&self) -> Surface {
        Surface::OnDemand
    }
    fn required_capabilities(&self) -> &'static [CapabilityRequirement] {
        // TODO(tier-a): `get_post` is read-only; no capability yet.
        &[]
    }

    fn parameters_schema(&self) -> serde_json::Value {
        json!({
            "type": "object",
            "properties": {
                "post_id": { "type": "string", "description": "Post ID" }
            },
            "required": ["post_id"]
        })
    }

    async fn execute(
        &self,
        input: serde_json::Value,
        ctx: &AgentToolContext,
    ) -> Result<ToolResult, AgentRuntimeError> {
        let network = require_network(ctx)?;
        let post_id = require_str(&input, "post_id")?;
        network_get(network, &format!("/api/posts/{post_id}"), &ctx.jwt).await
    }
}

// ---------------------------------------------------------------------------
// 4. AddCommentTool
// ---------------------------------------------------------------------------

pub struct AddCommentTool;

#[async_trait]
impl AgentTool for AddCommentTool {
    fn name(&self) -> &str {
        "add_comment"
    }
    fn description(&self) -> &str {
        "Add a comment to a post"
    }
    fn domain(&self) -> ToolDomain {
        ToolDomain::Social
    }
    fn surface(&self) -> Surface {
        Surface::OnDemand
    }
    fn required_capabilities(&self) -> &'static [CapabilityRequirement] {
        &[CapabilityRequirement::Exact(Capability::PostToFeed)]
    }

    fn parameters_schema(&self) -> serde_json::Value {
        json!({
            "type": "object",
            "properties": {
                "post_id": { "type": "string", "description": "Post ID" },
                "content": { "type": "string", "description": "Comment content" }
            },
            "required": ["post_id", "content"]
        })
    }

    async fn execute(
        &self,
        input: serde_json::Value,
        ctx: &AgentToolContext,
    ) -> Result<ToolResult, AgentRuntimeError> {
        let network = require_network(ctx)?;
        let post_id = require_str(&input, "post_id")?;
        let content = require_str(&input, "content")?;
        let body = json!({ "content": content });
        network_post(
            network,
            &format!("/api/posts/{post_id}/comments"),
            &ctx.jwt,
            &body,
        )
        .await
    }
}

// ---------------------------------------------------------------------------
// 5. DeleteCommentTool
// ---------------------------------------------------------------------------

pub struct DeleteCommentTool;

#[async_trait]
impl AgentTool for DeleteCommentTool {
    fn name(&self) -> &str {
        "delete_comment"
    }
    fn description(&self) -> &str {
        "Delete a comment"
    }
    fn domain(&self) -> ToolDomain {
        ToolDomain::Social
    }
    fn surface(&self) -> Surface {
        Surface::OnDemand
    }
    fn required_capabilities(&self) -> &'static [CapabilityRequirement] {
        &[CapabilityRequirement::Exact(Capability::PostToFeed)]
    }

    fn parameters_schema(&self) -> serde_json::Value {
        json!({
            "type": "object",
            "properties": {
                "comment_id": { "type": "string", "description": "Comment ID" }
            },
            "required": ["comment_id"]
        })
    }

    async fn execute(
        &self,
        input: serde_json::Value,
        ctx: &AgentToolContext,
    ) -> Result<ToolResult, AgentRuntimeError> {
        let network = require_network(ctx)?;
        let comment_id = require_str(&input, "comment_id")?;
        network_delete(network, &format!("/api/comments/{comment_id}"), &ctx.jwt).await
    }
}

// ---------------------------------------------------------------------------
// 6. FollowProfileTool
// ---------------------------------------------------------------------------

pub struct FollowProfileTool;

#[async_trait]
impl AgentTool for FollowProfileTool {
    fn name(&self) -> &str {
        "follow_profile"
    }
    fn description(&self) -> &str {
        "Follow another user or agent profile"
    }
    fn domain(&self) -> ToolDomain {
        ToolDomain::Social
    }
    fn surface(&self) -> Surface {
        Surface::OnDemand
    }
    fn required_capabilities(&self) -> &'static [CapabilityRequirement] {
        // TODO(tier-a): following a profile is a personal social
        // action; no capability defined.
        &[]
    }

    fn parameters_schema(&self) -> serde_json::Value {
        json!({
            "type": "object",
            "properties": {
                "target_profile_id": { "type": "string", "description": "Profile ID to follow" }
            },
            "required": ["target_profile_id"]
        })
    }

    async fn execute(
        &self,
        input: serde_json::Value,
        ctx: &AgentToolContext,
    ) -> Result<ToolResult, AgentRuntimeError> {
        let network = require_network(ctx)?;
        let target_profile_id = require_str(&input, "target_profile_id")?;
        let body = json!({ "target_profile_id": target_profile_id });
        network_post(network, "/api/follows", &ctx.jwt, &body).await
    }
}

// ---------------------------------------------------------------------------
// 7. UnfollowProfileTool
// ---------------------------------------------------------------------------

pub struct UnfollowProfileTool;

#[async_trait]
impl AgentTool for UnfollowProfileTool {
    fn name(&self) -> &str {
        "unfollow_profile"
    }
    fn description(&self) -> &str {
        "Unfollow a user or agent profile"
    }
    fn domain(&self) -> ToolDomain {
        ToolDomain::Social
    }
    fn surface(&self) -> Surface {
        Surface::OnDemand
    }
    fn required_capabilities(&self) -> &'static [CapabilityRequirement] {
        // TODO(tier-a): see `follow_profile`.
        &[]
    }

    fn parameters_schema(&self) -> serde_json::Value {
        json!({
            "type": "object",
            "properties": {
                "target_profile_id": { "type": "string", "description": "Profile ID to unfollow" }
            },
            "required": ["target_profile_id"]
        })
    }

    async fn execute(
        &self,
        input: serde_json::Value,
        ctx: &AgentToolContext,
    ) -> Result<ToolResult, AgentRuntimeError> {
        let network = require_network(ctx)?;
        let target_profile_id = require_str(&input, "target_profile_id")?;
        network_delete(
            network,
            &format!("/api/follows/{target_profile_id}"),
            &ctx.jwt,
        )
        .await
    }
}

// ---------------------------------------------------------------------------
// 8. ListFollowsTool
// ---------------------------------------------------------------------------

pub struct ListFollowsTool;

#[async_trait]
impl AgentTool for ListFollowsTool {
    fn name(&self) -> &str {
        "list_follows"
    }
    fn description(&self) -> &str {
        "List profiles the current user follows"
    }
    fn domain(&self) -> ToolDomain {
        ToolDomain::Social
    }
    fn surface(&self) -> Surface {
        Surface::OnDemand
    }
    fn required_capabilities(&self) -> &'static [CapabilityRequirement] {
        // TODO(tier-a): `list_follows` is a read-only own-profile peek
        // scoped by the caller's JWT; no capability required.
        &[]
    }

    fn parameters_schema(&self) -> serde_json::Value {
        json!({
            "type": "object",
            "properties": {},
            "required": []
        })
    }

    async fn execute(
        &self,
        _input: serde_json::Value,
        ctx: &AgentToolContext,
    ) -> Result<ToolResult, AgentRuntimeError> {
        let network = require_network(ctx)?;
        network_get(network, "/api/follows", &ctx.jwt).await
    }
}
