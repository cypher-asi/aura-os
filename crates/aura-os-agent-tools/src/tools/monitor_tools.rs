use async_trait::async_trait;
use serde_json::json;

use aura_os_core::{Capability, ToolDomain};

use super::helpers::{network_get, require_network, require_str, tool_err};
use super::{AgentToolContext, AgentTool, CapabilityRequirement, ToolResult};
use aura_os_agent_runtime::AgentRuntimeError;

// ---------------------------------------------------------------------------
// 1. GetFleetStatusTool
// ---------------------------------------------------------------------------

pub struct GetFleetStatusTool;

#[async_trait]
impl AgentTool for GetFleetStatusTool {
    fn name(&self) -> &str {
        "get_fleet_status"
    }
    fn description(&self) -> &str {
        "Get an overview of all agents and their current status"
    }
    fn domain(&self) -> ToolDomain {
        ToolDomain::Monitoring
    }
    fn required_capabilities(&self) -> &'static [CapabilityRequirement] {
        &[CapabilityRequirement::Exact(Capability::ReadAgent)]
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
        let network = ctx
            .network_client
            .as_ref()
            .ok_or_else(|| AgentRuntimeError::Internal("network client not available".into()))?;

        let agents = network
            .list_agents(&ctx.jwt)
            .await
            .map_err(|e| tool_err("get_fleet_status", e))?;

        let summary: Vec<serde_json::Value> = agents
            .iter()
            .map(|a| {
                json!({
                    "id": a.id,
                    "name": a.name,
                    "role": a.role,
                })
            })
            .collect();

        Ok(ToolResult {
            content: json!({
                "total_agents": agents.len(),
                "agents": summary
            }),
            is_error: false,
        })
    }
}

// ---------------------------------------------------------------------------
// 2. GetProgressReportTool
// ---------------------------------------------------------------------------

pub struct GetProgressReportTool;

#[async_trait]
impl AgentTool for GetProgressReportTool {
    fn name(&self) -> &str {
        "get_progress_report"
    }
    fn description(&self) -> &str {
        "Get a progress summary across all projects and tasks"
    }
    fn domain(&self) -> ToolDomain {
        ToolDomain::Monitoring
    }
    fn required_capabilities(&self) -> &'static [CapabilityRequirement] {
        // TODO(tier-a): `get_progress_report` aggregates across every
        // project in the caller's org; no per-project scope check is
        // practical here. Require `ReadAgent` as the coarsest monitor
        // capability until a dedicated `ReadOrgMonitoring` is defined.
        &[CapabilityRequirement::Exact(Capability::ReadAgent)]
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
        let network = ctx
            .network_client
            .as_ref()
            .ok_or_else(|| AgentRuntimeError::Internal("network client not available".into()))?;

        let projects = network
            .list_projects_by_org(&ctx.org_id, &ctx.jwt)
            .await
            .map_err(|e| tool_err("get_progress_report", e))?;

        let project_summaries: Vec<serde_json::Value> = projects
            .iter()
            .map(|p| {
                json!({
                    "id": p.id,
                    "name": p.name,
                    "description": p.description,
                })
            })
            .collect();

        Ok(ToolResult {
            content: json!({
                "total_projects": projects.len(),
                "projects": project_summaries
            }),
            is_error: false,
        })
    }
}

// ---------------------------------------------------------------------------
// 3. GetProjectCostTool
// ---------------------------------------------------------------------------

pub struct GetProjectCostTool;

#[async_trait]
impl AgentTool for GetProjectCostTool {
    fn name(&self) -> &str {
        "get_project_cost"
    }
    fn description(&self) -> &str {
        "Get token usage and cost information for a project"
    }
    fn domain(&self) -> ToolDomain {
        ToolDomain::Monitoring
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
        _ctx: &AgentToolContext,
    ) -> Result<ToolResult, AgentRuntimeError> {
        let project_id = input["project_id"]
            .as_str()
            .ok_or_else(|| AgentRuntimeError::ToolError("project_id is required".into()))?;

        Ok(ToolResult {
            content: json!({
                "project_id": project_id,
                "message": "Per-project cost tracking is not yet available. Use get_credit_balance for organization-level credit info."
            }),
            is_error: false,
        })
    }
}

// ---------------------------------------------------------------------------
// 4. GetLeaderboardTool
// ---------------------------------------------------------------------------

pub struct GetLeaderboardTool;

#[async_trait]
impl AgentTool for GetLeaderboardTool {
    fn name(&self) -> &str {
        "get_leaderboard"
    }
    fn description(&self) -> &str {
        "Get the agent/user leaderboard rankings"
    }
    fn domain(&self) -> ToolDomain {
        ToolDomain::Monitoring
    }
    fn required_capabilities(&self) -> &'static [CapabilityRequirement] {
        // TODO(tier-a): `get_leaderboard` is public-ish marketplace
        // data; no capability defined. Leave unrestricted.
        &[]
    }

    fn parameters_schema(&self) -> serde_json::Value {
        json!({
            "type": "object",
            "properties": {
                "period": { "type": "string", "description": "Time period (e.g. daily, weekly, all-time)" }
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
        let path = if let Some(period) = input["period"].as_str() {
            format!("/api/leaderboard?period={period}")
        } else {
            "/api/leaderboard".to_string()
        };
        network_get(network, &path, &ctx.jwt).await
    }
}

// ---------------------------------------------------------------------------
// 5. GetUsageStatsTool
// ---------------------------------------------------------------------------

pub struct GetUsageStatsTool;

#[async_trait]
impl AgentTool for GetUsageStatsTool {
    fn name(&self) -> &str {
        "get_usage_stats"
    }
    fn description(&self) -> &str {
        "Get usage statistics for the current user and optionally an organization"
    }
    fn domain(&self) -> ToolDomain {
        ToolDomain::Monitoring
    }
    fn required_capabilities(&self) -> &'static [CapabilityRequirement] {
        // TODO(tier-a): `get_usage_stats` is user/org scoped; the
        // downstream aura-network endpoint enforces ownership. No
        // cross-agent capability exists for user metrics yet.
        &[]
    }

    fn parameters_schema(&self) -> serde_json::Value {
        json!({
            "type": "object",
            "properties": {
                "org_id": { "type": "string", "description": "Organization ID for org-level usage (optional)" }
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
        let user_usage = network_get(network, "/api/users/me/usage", &ctx.jwt).await?;

        if let Some(org_id) = input["org_id"].as_str() {
            let org_usage =
                network_get(network, &format!("/api/orgs/{org_id}/usage"), &ctx.jwt).await?;
            Ok(ToolResult {
                content: json!({
                    "user_usage": user_usage.content,
                    "org_usage": org_usage.content,
                }),
                is_error: false,
            })
        } else {
            Ok(user_usage)
        }
    }
}

// ---------------------------------------------------------------------------
// 6. ListSessionsTool
// ---------------------------------------------------------------------------

pub struct ListSessionsTool;

#[async_trait]
impl AgentTool for ListSessionsTool {
    fn name(&self) -> &str {
        "list_sessions"
    }
    fn description(&self) -> &str {
        "List sessions for an agent instance in a project"
    }
    fn domain(&self) -> ToolDomain {
        ToolDomain::Monitoring
    }
    fn required_capabilities(&self) -> &'static [CapabilityRequirement] {
        &[CapabilityRequirement::ReadProjectFromArg("project_id")]
    }

    fn parameters_schema(&self) -> serde_json::Value {
        json!({
            "type": "object",
            "properties": {
                "project_id": { "type": "string", "description": "Project ID" },
                "agent_instance_id": { "type": "string", "description": "Agent instance ID" }
            },
            "required": ["project_id", "agent_instance_id"]
        })
    }

    async fn execute(
        &self,
        input: serde_json::Value,
        ctx: &AgentToolContext,
    ) -> Result<ToolResult, AgentRuntimeError> {
        let network = require_network(ctx)?;
        let project_id = require_str(&input, "project_id")?;
        let agent_instance_id = require_str(&input, "agent_instance_id")?;
        network_get(
            network,
            &format!("/api/projects/{project_id}/agents/{agent_instance_id}/sessions"),
            &ctx.jwt,
        )
        .await
    }
}

// ---------------------------------------------------------------------------
// 7. ListLogEntriesTool
// ---------------------------------------------------------------------------

pub struct ListLogEntriesTool;

#[async_trait]
impl AgentTool for ListLogEntriesTool {
    fn name(&self) -> &str {
        "list_log_entries"
    }
    fn description(&self) -> &str {
        "List recent log entries across the system"
    }
    fn domain(&self) -> ToolDomain {
        ToolDomain::Monitoring
    }
    fn required_capabilities(&self) -> &'static [CapabilityRequirement] {
        // TODO(tier-a): `list_log_entries` is admin-style global read.
        // Require `ReadAgent` as a coarse gate until a dedicated
        // monitoring capability exists.
        &[CapabilityRequirement::Exact(Capability::ReadAgent)]
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
        network_get(network, "/api/log-entries", &ctx.jwt).await
    }
}
