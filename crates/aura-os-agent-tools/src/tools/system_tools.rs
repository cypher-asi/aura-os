use async_trait::async_trait;
use serde_json::json;

use aura_os_core::{Capability, ToolDomain};

use super::helpers::{network_get, network_post, require_network, require_str};
use super::{AgentToolContext, AgentTool, CapabilityRequirement, ToolResult};
use aura_os_agent_runtime::AgentRuntimeError;

// ---------------------------------------------------------------------------
// 1. BrowseFilesTool
// ---------------------------------------------------------------------------

pub struct BrowseFilesTool;

#[async_trait]
impl AgentTool for BrowseFilesTool {
    fn name(&self) -> &str {
        "browse_files"
    }
    fn description(&self) -> &str {
        "List files and directories at a given path"
    }
    fn domain(&self) -> ToolDomain {
        ToolDomain::System
    }
    fn required_capabilities(&self) -> &'static [CapabilityRequirement] {
        // TODO(tier-a): `browse_files` operates on the caller's host
        // FS via aura-network; no per-path capability model yet.
        &[]
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
        ctx: &AgentToolContext,
    ) -> Result<ToolResult, AgentRuntimeError> {
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
impl AgentTool for ReadFileTool {
    fn name(&self) -> &str {
        "read_file"
    }
    fn description(&self) -> &str {
        "Read the contents of a file"
    }
    fn domain(&self) -> ToolDomain {
        ToolDomain::System
    }
    fn required_capabilities(&self) -> &'static [CapabilityRequirement] {
        // TODO(tier-a): `read_file` is same as `browse_files` — no
        // per-path capability model yet.
        &[]
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
        ctx: &AgentToolContext,
    ) -> Result<ToolResult, AgentRuntimeError> {
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
impl AgentTool for GetEnvironmentInfoTool {
    fn name(&self) -> &str {
        "get_environment_info"
    }
    fn description(&self) -> &str {
        "Get system environment information (server version, uptime, etc.)"
    }
    fn domain(&self) -> ToolDomain {
        ToolDomain::System
    }
    fn required_capabilities(&self) -> &'static [CapabilityRequirement] {
        // TODO(tier-a): `get_environment_info` is public diagnostic
        // data; unrestricted.
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
        network_get(network, "/api/system/info", &ctx.jwt).await
    }
}

// ---------------------------------------------------------------------------
// 4. GetCurrentTimeTool
// ---------------------------------------------------------------------------

pub struct GetCurrentTimeTool;

#[async_trait]
impl AgentTool for GetCurrentTimeTool {
    fn name(&self) -> &str {
        "get_current_time"
    }
    fn required_capabilities(&self) -> &'static [CapabilityRequirement] {
        // Always-on ambient tool; zero capability requirement.
        &[]
    }
    fn description(&self) -> &str {
        "Return the current local date and time. Prefer this over \
         running `date` through a shell — the platform shells vary \
         (Windows cmd.exe's `date` is interactive and exits non-zero \
         without stdin, PowerShell's `date` is an alias for Get-Date, \
         POSIX `date` accepts different format flags). This tool gives \
         a stable, cross-platform answer without spawning a process."
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
        _ctx: &AgentToolContext,
    ) -> Result<ToolResult, AgentRuntimeError> {
        let local = chrono::Local::now();
        let utc = chrono::Utc::now();
        Ok(ToolResult {
            content: json!({
                "iso_local": local.to_rfc3339(),
                "iso_utc": utc.to_rfc3339(),
                "human": local.format("%A, %B %-d, %Y %H:%M:%S %:z").to_string(),
                "unix_ms": utc.timestamp_millis(),
            }),
            is_error: false,
        })
    }
}

// ---------------------------------------------------------------------------
// 5. GetRemoteAgentStateTool
// ---------------------------------------------------------------------------

pub struct GetRemoteAgentStateTool;

#[async_trait]
impl AgentTool for GetRemoteAgentStateTool {
    fn name(&self) -> &str {
        "get_remote_agent_state"
    }
    fn description(&self) -> &str {
        "Get the state of a remote agent's VM (running, stopped, etc.)"
    }
    fn domain(&self) -> ToolDomain {
        ToolDomain::System
    }
    fn required_capabilities(&self) -> &'static [CapabilityRequirement] {
        &[CapabilityRequirement::Exact(Capability::ReadAgent)]
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
        ctx: &AgentToolContext,
    ) -> Result<ToolResult, AgentRuntimeError> {
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
