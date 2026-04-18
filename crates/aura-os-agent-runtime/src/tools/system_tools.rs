use async_trait::async_trait;
use serde_json::json;

use aura_os_core::ToolDomain;

use super::helpers::{network_get, network_post, require_network, require_str};
use super::{SuperAgentContext, SuperAgentTool, ToolResult};
use crate::SuperAgentError;

// ---------------------------------------------------------------------------
// 1. BrowseFilesTool
// ---------------------------------------------------------------------------

pub struct BrowseFilesTool;

#[async_trait]
impl SuperAgentTool for BrowseFilesTool {
    fn name(&self) -> &str {
        "browse_files"
    }
    fn description(&self) -> &str {
        "List files and directories at a given path"
    }
    fn domain(&self) -> ToolDomain {
        ToolDomain::System
    }

    fn parameters_schema(&self) -> serde_json::Value {
        json!({
            "type": "object",
            "properties": {
                "path": { "type": "string", "description": "Directory path to browse" }
            },
            "required": ["path"]
        })
    }

    async fn execute(
        &self,
        input: serde_json::Value,
        ctx: &SuperAgentContext,
    ) -> Result<ToolResult, SuperAgentError> {
        let network = require_network(ctx)?;
        let path = require_str(&input, "path")?;
        let body = json!({ "path": path });
        network_post(network, "/api/list-directory", &ctx.jwt, &body).await
    }
}

// ---------------------------------------------------------------------------
// 2. ReadFileTool
// ---------------------------------------------------------------------------

pub struct ReadFileTool;

#[async_trait]
impl SuperAgentTool for ReadFileTool {
    fn name(&self) -> &str {
        "read_file"
    }
    fn description(&self) -> &str {
        "Read the contents of a file"
    }
    fn domain(&self) -> ToolDomain {
        ToolDomain::System
    }

    fn parameters_schema(&self) -> serde_json::Value {
        json!({
            "type": "object",
            "properties": {
                "path": { "type": "string", "description": "File path to read" }
            },
            "required": ["path"]
        })
    }

    async fn execute(
        &self,
        input: serde_json::Value,
        ctx: &SuperAgentContext,
    ) -> Result<ToolResult, SuperAgentError> {
        let network = require_network(ctx)?;
        let path = require_str(&input, "path")?;
        let body = json!({ "path": path });
        network_post(network, "/api/read-file", &ctx.jwt, &body).await
    }
}

// ---------------------------------------------------------------------------
// 3. GetEnvironmentInfoTool
// ---------------------------------------------------------------------------

pub struct GetEnvironmentInfoTool;

#[async_trait]
impl SuperAgentTool for GetEnvironmentInfoTool {
    fn name(&self) -> &str {
        "get_environment_info"
    }
    fn description(&self) -> &str {
        "Get system environment information (server version, uptime, etc.)"
    }
    fn domain(&self) -> ToolDomain {
        ToolDomain::System
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
        network_get(network, "/api/system/info", &ctx.jwt).await
    }
}

// ---------------------------------------------------------------------------
// 4. GetRemoteAgentStateTool
// ---------------------------------------------------------------------------

pub struct GetRemoteAgentStateTool;

#[async_trait]
impl SuperAgentTool for GetRemoteAgentStateTool {
    fn name(&self) -> &str {
        "get_remote_agent_state"
    }
    fn description(&self) -> &str {
        "Get the state of a remote agent's VM (running, stopped, etc.)"
    }
    fn domain(&self) -> ToolDomain {
        ToolDomain::System
    }

    fn parameters_schema(&self) -> serde_json::Value {
        json!({
            "type": "object",
            "properties": {
                "agent_id": { "type": "string", "description": "Agent ID" }
            },
            "required": ["agent_id"]
        })
    }

    async fn execute(
        &self,
        input: serde_json::Value,
        ctx: &SuperAgentContext,
    ) -> Result<ToolResult, SuperAgentError> {
        let network = require_network(ctx)?;
        let agent_id = require_str(&input, "agent_id")?;
        network_get(
            network,
            &format!("/api/agents/{agent_id}/remote_agent/state"),
            &ctx.jwt,
        )
        .await
    }
}
