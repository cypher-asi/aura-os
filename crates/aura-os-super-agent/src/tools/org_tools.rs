use async_trait::async_trait;
use serde_json::json;

use aura_os_core::ToolDomain;

use super::helpers::{
    network_delete, network_get, network_post, network_put, require_network, require_str,
};
use super::{SuperAgentContext, SuperAgentTool, ToolResult};
use crate::SuperAgentError;

// ---------------------------------------------------------------------------
// 1. ListOrgsTool
// ---------------------------------------------------------------------------

pub struct ListOrgsTool;

#[async_trait]
impl SuperAgentTool for ListOrgsTool {
    fn name(&self) -> &str {
        "list_orgs"
    }
    fn description(&self) -> &str {
        "List all organizations the user belongs to"
    }
    fn domain(&self) -> ToolDomain {
        ToolDomain::Org
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
        ctx: &SuperAgentContext,
    ) -> Result<ToolResult, SuperAgentError> {
        let network = require_network(ctx)?;
        network_get(network, "/api/orgs", &ctx.jwt).await
    }
}

// ---------------------------------------------------------------------------
// 2. CreateOrgTool
// ---------------------------------------------------------------------------

pub struct CreateOrgTool;

#[async_trait]
impl SuperAgentTool for CreateOrgTool {
    fn name(&self) -> &str {
        "create_org"
    }
    fn description(&self) -> &str {
        "Create a new organization"
    }
    fn domain(&self) -> ToolDomain {
        ToolDomain::Org
    }

    fn parameters_schema(&self) -> serde_json::Value {
        json!({
            "type": "object",
            "properties": {
                "name": { "type": "string", "description": "Organization name" },
                "description": { "type": "string", "description": "Organization description" }
            },
            "required": ["name"]
        })
    }

    async fn execute(
        &self,
        input: serde_json::Value,
        ctx: &SuperAgentContext,
    ) -> Result<ToolResult, SuperAgentError> {
        let network = require_network(ctx)?;
        let mut body = json!({ "name": input["name"].as_str().unwrap_or_default() });
        if let Some(desc) = input["description"].as_str() {
            body["description"] = json!(desc);
        }
        network_post(network, "/api/orgs", &ctx.jwt, &body).await
    }
}

// ---------------------------------------------------------------------------
// 3. GetOrgTool
// ---------------------------------------------------------------------------

pub struct GetOrgTool;

#[async_trait]
impl SuperAgentTool for GetOrgTool {
    fn name(&self) -> &str {
        "get_org"
    }
    fn description(&self) -> &str {
        "Get details of a specific organization"
    }
    fn domain(&self) -> ToolDomain {
        ToolDomain::Org
    }

    fn parameters_schema(&self) -> serde_json::Value {
        json!({
            "type": "object",
            "properties": {
                "org_id": { "type": "string", "description": "Organization ID" }
            },
            "required": ["org_id"]
        })
    }

    async fn execute(
        &self,
        input: serde_json::Value,
        ctx: &SuperAgentContext,
    ) -> Result<ToolResult, SuperAgentError> {
        let network = require_network(ctx)?;
        let org_id = require_str(&input, "org_id")?;
        network_get(network, &format!("/api/orgs/{org_id}"), &ctx.jwt).await
    }
}

// ---------------------------------------------------------------------------
// 4. UpdateOrgTool
// ---------------------------------------------------------------------------

pub struct UpdateOrgTool;

#[async_trait]
impl SuperAgentTool for UpdateOrgTool {
    fn name(&self) -> &str {
        "update_org"
    }
    fn description(&self) -> &str {
        "Update organization settings"
    }
    fn domain(&self) -> ToolDomain {
        ToolDomain::Org
    }

    fn parameters_schema(&self) -> serde_json::Value {
        json!({
            "type": "object",
            "properties": {
                "org_id": { "type": "string", "description": "Organization ID" },
                "name": { "type": "string", "description": "New name" },
                "description": { "type": "string", "description": "New description" }
            },
            "required": ["org_id"]
        })
    }

    async fn execute(
        &self,
        input: serde_json::Value,
        ctx: &SuperAgentContext,
    ) -> Result<ToolResult, SuperAgentError> {
        let network = require_network(ctx)?;
        let org_id = require_str(&input, "org_id")?;
        let mut body = json!({});
        if let Some(name) = input["name"].as_str() {
            body["name"] = json!(name);
        }
        if let Some(desc) = input["description"].as_str() {
            body["description"] = json!(desc);
        }
        network_put(network, &format!("/api/orgs/{org_id}"), &ctx.jwt, &body).await
    }
}

// ---------------------------------------------------------------------------
// 5. ListMembersTool
// ---------------------------------------------------------------------------

pub struct ListMembersTool;

#[async_trait]
impl SuperAgentTool for ListMembersTool {
    fn name(&self) -> &str {
        "list_members"
    }
    fn description(&self) -> &str {
        "List all members of an organization"
    }
    fn domain(&self) -> ToolDomain {
        ToolDomain::Org
    }

    fn parameters_schema(&self) -> serde_json::Value {
        json!({
            "type": "object",
            "properties": {
                "org_id": { "type": "string", "description": "Organization ID" }
            },
            "required": ["org_id"]
        })
    }

    async fn execute(
        &self,
        input: serde_json::Value,
        ctx: &SuperAgentContext,
    ) -> Result<ToolResult, SuperAgentError> {
        let network = require_network(ctx)?;
        let org_id = require_str(&input, "org_id")?;
        network_get(network, &format!("/api/orgs/{org_id}/members"), &ctx.jwt).await
    }
}

// ---------------------------------------------------------------------------
// 6. UpdateMemberRoleTool
// ---------------------------------------------------------------------------

pub struct UpdateMemberRoleTool;

#[async_trait]
impl SuperAgentTool for UpdateMemberRoleTool {
    fn name(&self) -> &str {
        "update_member_role"
    }
    fn description(&self) -> &str {
        "Update a member's role in the organization"
    }
    fn domain(&self) -> ToolDomain {
        ToolDomain::Org
    }

    fn parameters_schema(&self) -> serde_json::Value {
        json!({
            "type": "object",
            "properties": {
                "org_id": { "type": "string", "description": "Organization ID" },
                "user_id": { "type": "string", "description": "User ID of the member" },
                "role": { "type": "string", "description": "New role (e.g. admin, member)" }
            },
            "required": ["org_id", "user_id", "role"]
        })
    }

    async fn execute(
        &self,
        input: serde_json::Value,
        ctx: &SuperAgentContext,
    ) -> Result<ToolResult, SuperAgentError> {
        let network = require_network(ctx)?;
        let org_id = require_str(&input, "org_id")?;
        let user_id = require_str(&input, "user_id")?;
        let role = require_str(&input, "role")?;
        let body = json!({ "role": role });
        network_put(
            network,
            &format!("/api/orgs/{org_id}/members/{user_id}"),
            &ctx.jwt,
            &body,
        )
        .await
    }
}

// ---------------------------------------------------------------------------
// 7. RemoveMemberTool
// ---------------------------------------------------------------------------

pub struct RemoveMemberTool;

#[async_trait]
impl SuperAgentTool for RemoveMemberTool {
    fn name(&self) -> &str {
        "remove_member"
    }
    fn description(&self) -> &str {
        "Remove a member from the organization"
    }
    fn domain(&self) -> ToolDomain {
        ToolDomain::Org
    }

    fn parameters_schema(&self) -> serde_json::Value {
        json!({
            "type": "object",
            "properties": {
                "org_id": { "type": "string", "description": "Organization ID" },
                "user_id": { "type": "string", "description": "User ID of the member to remove" }
            },
            "required": ["org_id", "user_id"]
        })
    }

    async fn execute(
        &self,
        input: serde_json::Value,
        ctx: &SuperAgentContext,
    ) -> Result<ToolResult, SuperAgentError> {
        let network = require_network(ctx)?;
        let org_id = require_str(&input, "org_id")?;
        let user_id = require_str(&input, "user_id")?;
        network_delete(
            network,
            &format!("/api/orgs/{org_id}/members/{user_id}"),
            &ctx.jwt,
        )
        .await
    }
}

// ---------------------------------------------------------------------------
// 8. ManageInvitesTool
// ---------------------------------------------------------------------------

pub struct ManageInvitesTool;

#[async_trait]
impl SuperAgentTool for ManageInvitesTool {
    fn name(&self) -> &str {
        "manage_invites"
    }
    fn description(&self) -> &str {
        "Manage organization invites: list, create, or revoke. Note: email-targeted invites are not yet supported; create generates a generic invite link."
    }
    fn domain(&self) -> ToolDomain {
        ToolDomain::Org
    }

    fn parameters_schema(&self) -> serde_json::Value {
        json!({
            "type": "object",
            "properties": {
                "org_id": { "type": "string", "description": "Organization ID" },
                "action": {
                    "type": "string",
                    "enum": ["list", "create", "revoke"],
                    "description": "Action to perform"
                },
                "email": { "type": "string", "description": "Email for create/revoke" },
                "invite_id": { "type": "string", "description": "Invite ID for revoke" },
                "role": { "type": "string", "description": "Role for invite (default: member)" }
            },
            "required": ["org_id", "action"]
        })
    }

    async fn execute(
        &self,
        input: serde_json::Value,
        ctx: &SuperAgentContext,
    ) -> Result<ToolResult, SuperAgentError> {
        let network = require_network(ctx)?;
        let org_id = require_str(&input, "org_id")?;
        let action = require_str(&input, "action")?;
        let path = format!("/api/orgs/{org_id}/invites");

        match action {
            "list" => network_get(network, &path, &ctx.jwt).await,
            "create" => {
                let mut body = json!({});
                if let Some(email) = input["email"].as_str() {
                    body["email"] = json!(email);
                }
                if let Some(role) = input["role"].as_str() {
                    body["role"] = json!(role);
                }
                network_post(network, &path, &ctx.jwt, &body).await
            }
            "revoke" => {
                if let Some(invite_id) = input["invite_id"].as_str() {
                    network_delete(network, &format!("{path}/{invite_id}"), &ctx.jwt).await
                } else {
                    Ok(ToolResult {
                        content: json!({ "error": "invite_id is required for revoke action" }),
                        is_error: true,
                    })
                }
            }
            _ => Ok(ToolResult {
                content: json!({ "error": format!("Unknown action: {action}. Use list, create, or revoke.") }),
                is_error: true,
            }),
        }
    }
}
