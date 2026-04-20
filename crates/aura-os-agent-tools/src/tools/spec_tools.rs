use async_trait::async_trait;
use serde_json::json;

use aura_os_core::ToolDomain;

use super::helpers::{
    local_delete, local_post, local_put, network_delete, network_get, network_post, network_put,
    require_network, require_str,
};
use super::{AgentToolContext, AgentTool, CapabilityRequirement, Surface, ToolResult};
use aura_os_agent_runtime::AgentRuntimeError;

// ---------------------------------------------------------------------------
// 1. ListSpecsTool
// ---------------------------------------------------------------------------

pub struct ListSpecsTool;

#[async_trait]
impl AgentTool for ListSpecsTool {
    fn name(&self) -> &str {
        "list_specs"
    }
    fn description(&self) -> &str {
        "List all specifications for a project"
    }
    fn domain(&self) -> ToolDomain {
        ToolDomain::Spec
    }
    fn surface(&self) -> Surface {
        Surface::OnDemand
    }
    fn required_capabilities(&self) -> &'static [CapabilityRequirement] {
        &[CapabilityRequirement::ReadProjectFromArg("project_id")]
    }

    fn parameters_schema(&self) -> serde_json::Value {
        json!({
            "type": "object",
            "properties": {
                "project_id": { "type": "string", "description": "Project ID" }
            },
            "required": ["project_id"]
        })
    }

    async fn execute(
        &self,
        input: serde_json::Value,
        ctx: &AgentToolContext,
    ) -> Result<ToolResult, AgentRuntimeError> {
        let network = require_network(ctx)?;
        let project_id = require_str(&input, "project_id")?;
        network_get(
            network,
            &format!("/api/projects/{project_id}/specs"),
            &ctx.jwt,
        )
        .await
    }
}

// ---------------------------------------------------------------------------
// 2. GetSpecTool
// ---------------------------------------------------------------------------

pub struct GetSpecTool;

#[async_trait]
impl AgentTool for GetSpecTool {
    fn name(&self) -> &str {
        "get_spec"
    }
    fn description(&self) -> &str {
        "Get details of a specific specification"
    }
    fn domain(&self) -> ToolDomain {
        ToolDomain::Spec
    }
    fn surface(&self) -> Surface {
        Surface::OnDemand
    }
    fn required_capabilities(&self) -> &'static [CapabilityRequirement] {
        &[CapabilityRequirement::ReadProjectFromArg("project_id")]
    }

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

    async fn execute(
        &self,
        input: serde_json::Value,
        ctx: &AgentToolContext,
    ) -> Result<ToolResult, AgentRuntimeError> {
        let network = require_network(ctx)?;
        let project_id = require_str(&input, "project_id")?;
        let spec_id = require_str(&input, "spec_id")?;
        network_get(
            network,
            &format!("/api/projects/{project_id}/specs/{spec_id}"),
            &ctx.jwt,
        )
        .await
    }
}

// ---------------------------------------------------------------------------
// 3. CreateSpecTool
// ---------------------------------------------------------------------------

pub struct CreateSpecTool;

#[async_trait]
impl AgentTool for CreateSpecTool {
    fn name(&self) -> &str {
        "create_spec"
    }
    fn description(&self) -> &str {
        "Create a new persisted specification in a project. Use this only after you have already shown the user the actual markdown draft as visible assistant text; pass that same finalized markdown in `markdown_contents`."
    }
    fn domain(&self) -> ToolDomain {
        ToolDomain::Spec
    }
    fn surface(&self) -> Surface {
        Surface::OnDemand
    }
    fn required_capabilities(&self) -> &'static [CapabilityRequirement] {
        &[CapabilityRequirement::WriteProjectFromArg("project_id")]
    }

    fn is_streaming(&self) -> bool {
        true
    }

    fn parameters_schema(&self) -> serde_json::Value {
        json!({
            "type": "object",
            "properties": {
                "project_id": { "type": "string", "description": "Project ID" },
                "title": { "type": "string", "description": "Specification title" },
                "markdown_contents": { "type": "string", "description": "Markdown body for the spec. This should match the visible draft markdown you streamed to the user immediately before calling create_spec." },
                "order_index": { "type": "integer", "description": "Optional sort order for the spec" }
            },
            "required": ["project_id", "title"]
        })
    }

    async fn execute(
        &self,
        input: serde_json::Value,
        ctx: &AgentToolContext,
    ) -> Result<ToolResult, AgentRuntimeError> {
        let project_id = require_str(&input, "project_id")?;
        let title = require_str(&input, "title")?;
        let body = json!({
            "title": title,
            "markdown_contents": input.get("markdown_contents").and_then(|value| value.as_str()),
            "order_index": input.get("order_index").and_then(|value| value.as_i64()),
        });
        let path = format!("/api/projects/{project_id}/specs");

        // Route through the local aura-os-server when configured so the
        // server can mirror the spec to `<workspace_root>/spec/<slug>.md`.
        if let Some(base) = ctx.local_server_base_url.as_deref() {
            return local_post(base, &ctx.local_http_client, &path, &ctx.jwt, &body).await;
        }

        let network = require_network(ctx)?;
        network_post(network, &path, &ctx.jwt, &body).await
    }
}

// ---------------------------------------------------------------------------
// 4. UpdateSpecTool
// ---------------------------------------------------------------------------

pub struct UpdateSpecTool;

#[async_trait]
impl AgentTool for UpdateSpecTool {
    fn name(&self) -> &str {
        "update_spec"
    }
    fn description(&self) -> &str {
        "Update an existing persisted specification. Use this only after you have already shown the user the updated markdown draft as visible assistant text; pass that same finalized markdown in `markdown_contents`."
    }
    fn domain(&self) -> ToolDomain {
        ToolDomain::Spec
    }
    fn surface(&self) -> Surface {
        Surface::OnDemand
    }
    fn required_capabilities(&self) -> &'static [CapabilityRequirement] {
        &[CapabilityRequirement::WriteProjectFromArg("project_id")]
    }

    fn is_streaming(&self) -> bool {
        true
    }

    fn parameters_schema(&self) -> serde_json::Value {
        json!({
            "type": "object",
            "properties": {
                "project_id": { "type": "string", "description": "Project ID" },
                "spec_id": { "type": "string", "description": "Specification ID" },
                "title": { "type": "string", "description": "Optional replacement title" },
                "markdown_contents": { "type": "string", "description": "Optional replacement markdown body. This should match the visible updated draft markdown you streamed to the user immediately before calling update_spec." },
                "order_index": { "type": "integer", "description": "Optional replacement sort order" }
            },
            "required": ["project_id", "spec_id"]
        })
    }

    async fn execute(
        &self,
        input: serde_json::Value,
        ctx: &AgentToolContext,
    ) -> Result<ToolResult, AgentRuntimeError> {
        let project_id = require_str(&input, "project_id")?;
        let spec_id = require_str(&input, "spec_id")?;
        let body = json!({
            "title": input.get("title").and_then(|value| value.as_str()),
            "markdown_contents": input.get("markdown_contents").and_then(|value| value.as_str()),
            "order_index": input.get("order_index").and_then(|value| value.as_i64()),
        });
        let path = format!("/api/projects/{project_id}/specs/{spec_id}");

        if let Some(base) = ctx.local_server_base_url.as_deref() {
            return local_put(base, &ctx.local_http_client, &path, &ctx.jwt, &body).await;
        }

        let network = require_network(ctx)?;
        network_put(network, &path, &ctx.jwt, &body).await
    }
}

// ---------------------------------------------------------------------------
// 5. DeleteSpecTool
// ---------------------------------------------------------------------------

pub struct DeleteSpecTool;

#[async_trait]
impl AgentTool for DeleteSpecTool {
    fn name(&self) -> &str {
        "delete_spec"
    }
    fn description(&self) -> &str {
        "Delete a persisted specification from a project"
    }
    fn domain(&self) -> ToolDomain {
        ToolDomain::Spec
    }
    fn surface(&self) -> Surface {
        Surface::OnDemand
    }
    fn required_capabilities(&self) -> &'static [CapabilityRequirement] {
        &[CapabilityRequirement::WriteProjectFromArg("project_id")]
    }

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

    async fn execute(
        &self,
        input: serde_json::Value,
        ctx: &AgentToolContext,
    ) -> Result<ToolResult, AgentRuntimeError> {
        let project_id = require_str(&input, "project_id")?;
        let spec_id = require_str(&input, "spec_id")?;
        let path = format!("/api/projects/{project_id}/specs/{spec_id}");

        if let Some(base) = ctx.local_server_base_url.as_deref() {
            return local_delete(base, &ctx.local_http_client, &path, &ctx.jwt).await;
        }

        let network = require_network(ctx)?;
        network_delete(network, &path, &ctx.jwt).await
    }
}

// ---------------------------------------------------------------------------
// 6. GenerateSpecsTool
// ---------------------------------------------------------------------------

pub struct GenerateSpecsTool;

#[async_trait]
impl AgentTool for GenerateSpecsTool {
    fn name(&self) -> &str {
        "generate_specs"
    }
    fn description(&self) -> &str {
        "Auto-generate specifications for a project from its codebase"
    }
    fn domain(&self) -> ToolDomain {
        ToolDomain::Spec
    }
    fn surface(&self) -> Surface {
        Surface::OnDemand
    }
    fn required_capabilities(&self) -> &'static [CapabilityRequirement] {
        &[CapabilityRequirement::WriteProjectFromArg("project_id")]
    }

    fn parameters_schema(&self) -> serde_json::Value {
        json!({
            "type": "object",
            "properties": {
                "project_id": { "type": "string", "description": "Project ID" }
            },
            "required": ["project_id"]
        })
    }

    async fn execute(
        &self,
        input: serde_json::Value,
        ctx: &AgentToolContext,
    ) -> Result<ToolResult, AgentRuntimeError> {
        let network = require_network(ctx)?;
        let project_id = require_str(&input, "project_id")?;
        network_post(
            network,
            &format!("/api/projects/{project_id}/specs/generate"),
            &ctx.jwt,
            &json!({}),
        )
        .await
    }
}

// ---------------------------------------------------------------------------
// 7. GenerateSpecsSummaryTool
// ---------------------------------------------------------------------------

pub struct GenerateSpecsSummaryTool;

#[async_trait]
impl AgentTool for GenerateSpecsSummaryTool {
    fn name(&self) -> &str {
        "generate_specs_summary"
    }
    fn description(&self) -> &str {
        "Generate a summary of all specifications for a project"
    }
    fn domain(&self) -> ToolDomain {
        ToolDomain::Spec
    }
    fn surface(&self) -> Surface {
        Surface::OnDemand
    }
    fn required_capabilities(&self) -> &'static [CapabilityRequirement] {
        &[CapabilityRequirement::WriteProjectFromArg("project_id")]
    }

    fn parameters_schema(&self) -> serde_json::Value {
        json!({
            "type": "object",
            "properties": {
                "project_id": { "type": "string", "description": "Project ID" }
            },
            "required": ["project_id"]
        })
    }

    async fn execute(
        &self,
        input: serde_json::Value,
        ctx: &AgentToolContext,
    ) -> Result<ToolResult, AgentRuntimeError> {
        let network = require_network(ctx)?;
        let project_id = require_str(&input, "project_id")?;
        network_post(
            network,
            &format!("/api/projects/{project_id}/specs/summary"),
            &ctx.jwt,
            &json!({}),
        )
        .await
    }
}
