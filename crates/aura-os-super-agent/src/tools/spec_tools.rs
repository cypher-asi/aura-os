use async_trait::async_trait;
use serde_json::json;

use aura_os_core::ToolDomain;

use super::helpers::{network_delete, network_get, network_post, network_put, require_network, require_str};
use super::{SuperAgentContext, SuperAgentTool, ToolResult};
use crate::SuperAgentError;

// ---------------------------------------------------------------------------
// 1. ListSpecsTool
// ---------------------------------------------------------------------------

pub struct ListSpecsTool;

#[async_trait]
impl SuperAgentTool for ListSpecsTool {
    fn name(&self) -> &str { "list_specs" }
    fn description(&self) -> &str { "List all specifications for a project" }
    fn domain(&self) -> ToolDomain { ToolDomain::Spec }

    fn parameters_schema(&self) -> serde_json::Value {
        json!({
            "type": "object",
            "properties": {
                "project_id": { "type": "string", "description": "Project ID" }
            },
            "required": ["project_id"]
        })
    }

    async fn execute(&self, input: serde_json::Value, ctx: &SuperAgentContext) -> Result<ToolResult, SuperAgentError> {
        let network = require_network(ctx)?;
        let project_id = require_str(&input, "project_id")?;
        network_get(network, &format!("/api/projects/{project_id}/specs"), &ctx.jwt).await
    }
}

// ---------------------------------------------------------------------------
// 2. GetSpecTool
// ---------------------------------------------------------------------------

pub struct GetSpecTool;

#[async_trait]
impl SuperAgentTool for GetSpecTool {
    fn name(&self) -> &str { "get_spec" }
    fn description(&self) -> &str { "Get details of a specific specification" }
    fn domain(&self) -> ToolDomain { ToolDomain::Spec }

    fn parameters_schema(&self) -> serde_json::Value {
        json!({
            "type": "object",
            "properties": {
                "project_id": { "type": "string", "description": "Project ID" },
                "spec_id": { "type": "string", "description": "Specification ID" }
            },
            "required": ["project_id", "spec_id"]
        })
    }

    async fn execute(&self, input: serde_json::Value, ctx: &SuperAgentContext) -> Result<ToolResult, SuperAgentError> {
        let network = require_network(ctx)?;
        let project_id = require_str(&input, "project_id")?;
        let spec_id = require_str(&input, "spec_id")?;
        network_get(network, &format!("/api/projects/{project_id}/specs/{spec_id}"), &ctx.jwt).await
    }
}

// ---------------------------------------------------------------------------
// 3. CreateSpecTool
// ---------------------------------------------------------------------------

pub struct CreateSpecTool;

#[async_trait]
impl SuperAgentTool for CreateSpecTool {
    fn name(&self) -> &str { "create_spec" }
    fn description(&self) -> &str { "Create a new persisted specification in a project" }
    fn domain(&self) -> ToolDomain { ToolDomain::Spec }

    fn parameters_schema(&self) -> serde_json::Value {
        json!({
            "type": "object",
            "properties": {
                "project_id": { "type": "string", "description": "Project ID" },
                "title": { "type": "string", "description": "Specification title" },
                "markdown_contents": { "type": "string", "description": "Markdown body for the spec" },
                "order_index": { "type": "integer", "description": "Optional sort order for the spec" }
            },
            "required": ["project_id", "title"]
        })
    }

    async fn execute(&self, input: serde_json::Value, ctx: &SuperAgentContext) -> Result<ToolResult, SuperAgentError> {
        let network = require_network(ctx)?;
        let project_id = require_str(&input, "project_id")?;
        let title = require_str(&input, "title")?;
        let body = json!({
            "title": title,
            "markdown_contents": input.get("markdown_contents").and_then(|value| value.as_str()),
            "order_index": input.get("order_index").and_then(|value| value.as_i64()),
        });
        network_post(network, &format!("/api/projects/{project_id}/specs"), &ctx.jwt, &body).await
    }
}

// ---------------------------------------------------------------------------
// 4. UpdateSpecTool
// ---------------------------------------------------------------------------

pub struct UpdateSpecTool;

#[async_trait]
impl SuperAgentTool for UpdateSpecTool {
    fn name(&self) -> &str { "update_spec" }
    fn description(&self) -> &str { "Update an existing persisted specification" }
    fn domain(&self) -> ToolDomain { ToolDomain::Spec }

    fn parameters_schema(&self) -> serde_json::Value {
        json!({
            "type": "object",
            "properties": {
                "project_id": { "type": "string", "description": "Project ID" },
                "spec_id": { "type": "string", "description": "Specification ID" },
                "title": { "type": "string", "description": "Optional replacement title" },
                "markdown_contents": { "type": "string", "description": "Optional replacement markdown body" },
                "order_index": { "type": "integer", "description": "Optional replacement sort order" }
            },
            "required": ["project_id", "spec_id"]
        })
    }

    async fn execute(&self, input: serde_json::Value, ctx: &SuperAgentContext) -> Result<ToolResult, SuperAgentError> {
        let network = require_network(ctx)?;
        let project_id = require_str(&input, "project_id")?;
        let spec_id = require_str(&input, "spec_id")?;
        let body = json!({
            "title": input.get("title").and_then(|value| value.as_str()),
            "markdown_contents": input.get("markdown_contents").and_then(|value| value.as_str()),
            "order_index": input.get("order_index").and_then(|value| value.as_i64()),
        });
        network_put(network, &format!("/api/projects/{project_id}/specs/{spec_id}"), &ctx.jwt, &body).await
    }
}

// ---------------------------------------------------------------------------
// 5. DeleteSpecTool
// ---------------------------------------------------------------------------

pub struct DeleteSpecTool;

#[async_trait]
impl SuperAgentTool for DeleteSpecTool {
    fn name(&self) -> &str { "delete_spec" }
    fn description(&self) -> &str { "Delete a persisted specification from a project" }
    fn domain(&self) -> ToolDomain { ToolDomain::Spec }

    fn parameters_schema(&self) -> serde_json::Value {
        json!({
            "type": "object",
            "properties": {
                "project_id": { "type": "string", "description": "Project ID" },
                "spec_id": { "type": "string", "description": "Specification ID" }
            },
            "required": ["project_id", "spec_id"]
        })
    }

    async fn execute(&self, input: serde_json::Value, ctx: &SuperAgentContext) -> Result<ToolResult, SuperAgentError> {
        let network = require_network(ctx)?;
        let project_id = require_str(&input, "project_id")?;
        let spec_id = require_str(&input, "spec_id")?;
        network_delete(network, &format!("/api/projects/{project_id}/specs/{spec_id}"), &ctx.jwt).await
    }
}

// ---------------------------------------------------------------------------
// 6. GenerateSpecsTool
// ---------------------------------------------------------------------------

pub struct GenerateSpecsTool;

#[async_trait]
impl SuperAgentTool for GenerateSpecsTool {
    fn name(&self) -> &str { "generate_specs" }
    fn description(&self) -> &str { "Auto-generate specifications for a project from its codebase" }
    fn domain(&self) -> ToolDomain { ToolDomain::Spec }

    fn parameters_schema(&self) -> serde_json::Value {
        json!({
            "type": "object",
            "properties": {
                "project_id": { "type": "string", "description": "Project ID" }
            },
            "required": ["project_id"]
        })
    }

    async fn execute(&self, input: serde_json::Value, ctx: &SuperAgentContext) -> Result<ToolResult, SuperAgentError> {
        let network = require_network(ctx)?;
        let project_id = require_str(&input, "project_id")?;
        network_post(network, &format!("/api/projects/{project_id}/specs/generate"), &ctx.jwt, &json!({})).await
    }
}

// ---------------------------------------------------------------------------
// 7. GenerateSpecsSummaryTool
// ---------------------------------------------------------------------------

pub struct GenerateSpecsSummaryTool;

#[async_trait]
impl SuperAgentTool for GenerateSpecsSummaryTool {
    fn name(&self) -> &str { "generate_specs_summary" }
    fn description(&self) -> &str { "Generate a summary of all specifications for a project" }
    fn domain(&self) -> ToolDomain { ToolDomain::Spec }

    fn parameters_schema(&self) -> serde_json::Value {
        json!({
            "type": "object",
            "properties": {
                "project_id": { "type": "string", "description": "Project ID" }
            },
            "required": ["project_id"]
        })
    }

    async fn execute(&self, input: serde_json::Value, ctx: &SuperAgentContext) -> Result<ToolResult, SuperAgentError> {
        let network = require_network(ctx)?;
        let project_id = require_str(&input, "project_id")?;
        network_post(network, &format!("/api/projects/{project_id}/specs/summary"), &ctx.jwt, &json!({})).await
    }
}
