use async_trait::async_trait;
use serde_json::json;
use std::collections::HashMap;
use std::sync::{LazyLock, Mutex};
use std::time::{Duration, Instant};

use aura_os_core::{AgentId, ToolDomain};

use super::helpers::{
    network_delete, network_get, network_post, network_put, require_network, require_str, tool_err,
};
use super::{AgentToolContext, AgentTool, ToolResult};
use crate::AgentRuntimeError;

/// How long a cached `list_agents` payload stays fresh.
///
/// This sits on the *hot path* for CEO-preset chats — the user's first
/// question in a new session ("who are my agents?" / "what's going on
/// with agent X?") routes through `ListAgentsTool` before the LLM can
/// frame its answer. Back-to-back turns inside the same conversation
/// typically re-request the same data; caching for a few seconds makes
/// the second and subsequent turns nearly free without noticeably
/// delaying how soon fresh creates/deletes become visible.
const AGENT_LIST_CACHE_TTL: Duration = Duration::from_secs(5);

struct CachedPayload {
    expires_at: Instant,
    value: serde_json::Value,
}

type AgentToolCache = Mutex<HashMap<String, CachedPayload>>;

static LIST_AGENTS_CACHE: LazyLock<AgentToolCache> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

static GET_AGENT_CACHE: LazyLock<AgentToolCache> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

fn cache_get(cache: &AgentToolCache, key: &str) -> Option<serde_json::Value> {
    let now = Instant::now();
    let mut guard = cache.lock().ok()?;
    match guard.get(key) {
        Some(entry) if entry.expires_at > now => Some(entry.value.clone()),
        _ => {
            guard.remove(key);
            None
        }
    }
}

fn cache_put(cache: &AgentToolCache, key: String, value: serde_json::Value, ttl: Duration) {
    let expires_at = Instant::now() + ttl;
    if let Ok(mut guard) = cache.lock() {
        guard.insert(key, CachedPayload { expires_at, value });
    }
}

/// Invalidate the cached `list_agents` / `get_agent` payloads.
///
/// Called from any tool that mutates the agent catalog so subsequent
/// reads pull fresh data rather than serving a stale snapshot.
pub(crate) fn invalidate_agent_caches() {
    if let Ok(mut guard) = LIST_AGENTS_CACHE.lock() {
        guard.clear();
    }
    if let Ok(mut guard) = GET_AGENT_CACHE.lock() {
        guard.clear();
    }
}

// ---------------------------------------------------------------------------
// 1. ListAgentsTool
// ---------------------------------------------------------------------------

pub struct ListAgentsTool;

#[async_trait]
impl AgentTool for ListAgentsTool {
    fn name(&self) -> &str {
        "list_agents"
    }
    fn description(&self) -> &str {
        "List all agents in the organization"
    }
    fn domain(&self) -> ToolDomain {
        ToolDomain::Agent
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
        if let Some(network) = ctx.network_client.as_deref() {
            let cache_key = format!("{}:{}", ctx.org_id, ctx.jwt);
            if let Some(cached) = cache_get(&LIST_AGENTS_CACHE, &cache_key) {
                return Ok(ToolResult {
                    content: cached,
                    is_error: false,
                });
            }
            let agents = network
                .list_agents(&ctx.jwt)
                .await
                .map_err(|e| tool_err("list_agents", e))?;
            let value = serde_json::to_value(&agents).unwrap_or_default();
            cache_put(
                &LIST_AGENTS_CACHE,
                cache_key,
                value.clone(),
                AGENT_LIST_CACHE_TTL,
            );
            return Ok(ToolResult {
                content: value,
                is_error: false,
            });
        }

        let agents = ctx
            .agent_service
            .list_agents()
            .map_err(|e| tool_err("list_agents", e))?;
        Ok(ToolResult {
            content: serde_json::to_value(&agents).unwrap_or_default(),
            is_error: false,
        })
    }
}

// ---------------------------------------------------------------------------
// 2. GetAgentTool
// ---------------------------------------------------------------------------

pub struct GetAgentTool;

#[async_trait]
impl AgentTool for GetAgentTool {
    fn name(&self) -> &str {
        "get_agent"
    }
    fn description(&self) -> &str {
        "Get details of a specific agent"
    }
    fn domain(&self) -> ToolDomain {
        ToolDomain::Agent
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
        let agent_id_str = input["agent_id"]
            .as_str()
            .ok_or_else(|| AgentRuntimeError::ToolError("agent_id is required".into()))?;

        if let Some(network) = ctx.network_client.as_deref() {
            let cache_key = format!("{}:{}:{}", ctx.org_id, agent_id_str, ctx.jwt);
            if let Some(cached) = cache_get(&GET_AGENT_CACHE, &cache_key) {
                return Ok(ToolResult {
                    content: cached,
                    is_error: false,
                });
            }
            let agent = network
                .get_agent(agent_id_str, &ctx.jwt)
                .await
                .map_err(|e| tool_err("get_agent", e))?;
            let value = serde_json::to_value(&agent).unwrap_or_default();
            cache_put(
                &GET_AGENT_CACHE,
                cache_key,
                value.clone(),
                AGENT_LIST_CACHE_TTL,
            );
            return Ok(ToolResult {
                content: value,
                is_error: false,
            });
        }

        let aid: AgentId = agent_id_str
            .parse()
            .map_err(|_| AgentRuntimeError::ToolError("invalid agent_id".into()))?;
        let agent = ctx
            .agent_service
            .get_agent_local(&aid)
            .map_err(|e| tool_err("get_agent", e))?;
        Ok(ToolResult {
            content: serde_json::to_value(&agent).unwrap_or_default(),
            is_error: false,
        })
    }
}

// ---------------------------------------------------------------------------
// 3. AssignAgentToProjectTool
// ---------------------------------------------------------------------------

pub struct AssignAgentToProjectTool;

#[async_trait]
impl AgentTool for AssignAgentToProjectTool {
    fn name(&self) -> &str {
        "assign_agent_to_project"
    }
    fn description(&self) -> &str {
        "Create an agent instance in a project from an agent template"
    }
    fn domain(&self) -> ToolDomain {
        ToolDomain::Agent
    }

    fn parameters_schema(&self) -> serde_json::Value {
        json!({
            "type": "object",
            "properties": {
                "project_id": { "type": "string", "description": "Target project ID" },
                "agent_id": { "type": "string", "description": "Agent template ID to assign" }
            },
            "required": ["project_id", "agent_id"]
        })
    }

    async fn execute(
        &self,
        input: serde_json::Value,
        ctx: &AgentToolContext,
    ) -> Result<ToolResult, AgentRuntimeError> {
        let network = require_network(ctx)?;
        let project_id = input["project_id"]
            .as_str()
            .ok_or_else(|| AgentRuntimeError::ToolError("project_id is required".into()))?;
        let agent_id = input["agent_id"]
            .as_str()
            .ok_or_else(|| AgentRuntimeError::ToolError("agent_id is required".into()))?;

        let body = json!({ "agent_id": agent_id });
        let url = format!("{}/api/projects/{}/agents", network.base_url(), project_id);
        let resp = network
            .http_client()
            .post(&url)
            .bearer_auth(&ctx.jwt)
            .json(&body)
            .send()
            .await
            .map_err(|e| tool_err("assign_agent_to_project", e))?;

        let status = resp.status();
        let body_text = resp
            .text()
            .await
            .map_err(|e| tool_err("assign_agent_to_project", e))?;

        if !status.is_success() {
            return Ok(ToolResult {
                content: json!({ "error": body_text, "status": status.as_u16() }),
                is_error: true,
            });
        }

        let result: serde_json::Value = serde_json::from_str(&body_text)
            .unwrap_or_else(|_| json!({ "message": "Agent assigned successfully" }));
        invalidate_agent_caches();
        Ok(ToolResult {
            content: result,
            is_error: false,
        })
    }
}

// ---------------------------------------------------------------------------
// 4. CreateAgentTool
// ---------------------------------------------------------------------------

pub struct CreateAgentTool;

#[async_trait]
impl AgentTool for CreateAgentTool {
    fn name(&self) -> &str {
        "create_agent"
    }
    fn description(&self) -> &str {
        "Create a new agent template"
    }
    fn domain(&self) -> ToolDomain {
        ToolDomain::Agent
    }

    fn parameters_schema(&self) -> serde_json::Value {
        json!({
            "type": "object",
            "properties": {
                "name": { "type": "string", "description": "Agent name" },
                "role": { "type": "string", "description": "Agent role (e.g. developer, designer)" },
                "personality": { "type": "string", "description": "Agent personality description" },
                "system_prompt": { "type": "string", "description": "System prompt for the agent" },
                "skills": { "type": "array", "items": { "type": "string" }, "description": "List of skill IDs" },
                "machine_type": { "type": "string", "description": "VM machine type for remote agents" }
            },
            "required": ["name"]
        })
    }

    async fn execute(
        &self,
        input: serde_json::Value,
        ctx: &AgentToolContext,
    ) -> Result<ToolResult, AgentRuntimeError> {
        let Some(network) = ctx.network_client.as_deref() else {
            return Ok(ToolResult {
                content: json!({ "error": "Creating agents requires network connectivity. Please connect to aura-network first." }),
                is_error: true,
            });
        };
        let mut body = json!({
            "name": input["name"].as_str().unwrap_or_default(),
            "org_id": &ctx.org_id,
        });
        for field in &["role", "personality", "system_prompt", "machine_type"] {
            if let Some(v) = input[field].as_str() {
                body[field] = json!(v);
            }
        }
        if let Some(skills) = input["skills"].as_array() {
            body["skills"] = json!(skills);
        }
        let result = network_post(network, "/api/agents", &ctx.jwt, &body).await;
        if matches!(result, Ok(ref r) if !r.is_error) {
            invalidate_agent_caches();
        }
        result
    }
}

// ---------------------------------------------------------------------------
// 5. UpdateAgentTool
// ---------------------------------------------------------------------------

pub struct UpdateAgentTool;

#[async_trait]
impl AgentTool for UpdateAgentTool {
    fn name(&self) -> &str {
        "update_agent"
    }
    fn description(&self) -> &str {
        "Update an agent template's settings"
    }
    fn domain(&self) -> ToolDomain {
        ToolDomain::Agent
    }

    fn parameters_schema(&self) -> serde_json::Value {
        json!({
            "type": "object",
            "properties": {
                "agent_id": { "type": "string", "description": "Agent ID" },
                "name": { "type": "string", "description": "New name" },
                "role": { "type": "string", "description": "New role" },
                "personality": { "type": "string", "description": "New personality" },
                "system_prompt": { "type": "string", "description": "New system prompt" },
                "skills": { "type": "array", "items": { "type": "string" }, "description": "Updated skill IDs" }
            },
            "required": ["agent_id"]
        })
    }

    async fn execute(
        &self,
        input: serde_json::Value,
        ctx: &AgentToolContext,
    ) -> Result<ToolResult, AgentRuntimeError> {
        let Some(network) = ctx.network_client.as_deref() else {
            return Ok(ToolResult {
                content: json!({ "error": "Updating agents requires network connectivity. Please connect to aura-network first." }),
                is_error: true,
            });
        };
        let agent_id = require_str(&input, "agent_id")?;
        let mut body = json!({});
        for field in &["name", "role", "personality", "system_prompt"] {
            if let Some(v) = input[field].as_str() {
                body[field] = json!(v);
            }
        }
        if let Some(skills) = input["skills"].as_array() {
            body["skills"] = json!(skills);
        }
        let result = network_put(network, &format!("/api/agents/{agent_id}"), &ctx.jwt, &body).await;
        if matches!(result, Ok(ref r) if !r.is_error) {
            invalidate_agent_caches();
        }
        result
    }
}

// ---------------------------------------------------------------------------
// 6. DeleteAgentTool
// ---------------------------------------------------------------------------

pub struct DeleteAgentTool;

#[async_trait]
impl AgentTool for DeleteAgentTool {
    fn name(&self) -> &str {
        "delete_agent"
    }
    fn description(&self) -> &str {
        "Delete an agent template"
    }
    fn domain(&self) -> ToolDomain {
        ToolDomain::Agent
    }

    fn parameters_schema(&self) -> serde_json::Value {
        json!({
            "type": "object",
            "properties": {
                "agent_id": { "type": "string", "description": "Agent ID to delete" }
            },
            "required": ["agent_id"]
        })
    }

    async fn execute(
        &self,
        input: serde_json::Value,
        ctx: &AgentToolContext,
    ) -> Result<ToolResult, AgentRuntimeError> {
        let Some(network) = ctx.network_client.as_deref() else {
            return Ok(ToolResult {
                content: json!({ "error": "Deleting agents requires network connectivity. Please connect to aura-network first." }),
                is_error: true,
            });
        };
        let agent_id = require_str(&input, "agent_id")?;
        let result = network_delete(network, &format!("/api/agents/{agent_id}"), &ctx.jwt).await;
        if matches!(result, Ok(ref r) if !r.is_error) {
            invalidate_agent_caches();
        }
        result
    }
}

// ---------------------------------------------------------------------------
// 7. ListAgentInstancesTool
// ---------------------------------------------------------------------------

pub struct ListAgentInstancesTool;

#[async_trait]
impl AgentTool for ListAgentInstancesTool {
    fn name(&self) -> &str {
        "list_agent_instances"
    }
    fn description(&self) -> &str {
        "List all agent instances assigned to a project"
    }
    fn domain(&self) -> ToolDomain {
        ToolDomain::Agent
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
            &format!("/api/projects/{project_id}/agents"),
            &ctx.jwt,
        )
        .await
    }
}

// ---------------------------------------------------------------------------
// 8. UpdateAgentInstanceTool
// ---------------------------------------------------------------------------

pub struct UpdateAgentInstanceTool;

#[async_trait]
impl AgentTool for UpdateAgentInstanceTool {
    fn name(&self) -> &str {
        "update_agent_instance"
    }
    fn description(&self) -> &str {
        "Update an agent instance's status within a project"
    }
    fn domain(&self) -> ToolDomain {
        ToolDomain::Agent
    }

    fn parameters_schema(&self) -> serde_json::Value {
        json!({
            "type": "object",
            "properties": {
                "project_id": { "type": "string", "description": "Project ID" },
                "agent_instance_id": { "type": "string", "description": "Agent instance ID" },
                "status": {
                    "type": "string",
                    "enum": ["idle", "working", "blocked", "stopped", "error", "archived"],
                    "description": "New status for the agent instance"
                }
            },
            "required": ["project_id", "agent_instance_id", "status"]
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
        let status = require_str(&input, "status")?;
        let body = json!({ "status": status });
        network_put(
            network,
            &format!("/api/projects/{project_id}/agents/{agent_instance_id}"),
            &ctx.jwt,
            &body,
        )
        .await
    }
}

// ---------------------------------------------------------------------------
// 9. DeleteAgentInstanceTool
// ---------------------------------------------------------------------------

pub struct DeleteAgentInstanceTool;

#[async_trait]
impl AgentTool for DeleteAgentInstanceTool {
    fn name(&self) -> &str {
        "delete_agent_instance"
    }
    fn description(&self) -> &str {
        "Remove an agent instance from a project"
    }
    fn domain(&self) -> ToolDomain {
        ToolDomain::Agent
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
        network_delete(
            network,
            &format!("/api/projects/{project_id}/agents/{agent_instance_id}"),
            &ctx.jwt,
        )
        .await
    }
}

// ---------------------------------------------------------------------------
// 10. RemoteAgentActionTool
// ---------------------------------------------------------------------------

pub struct RemoteAgentActionTool;

#[async_trait]
impl AgentTool for RemoteAgentActionTool {
    fn name(&self) -> &str {
        "remote_agent_action"
    }
    fn description(&self) -> &str {
        "Perform a lifecycle action on a remote agent (hibernate, stop, restart, wake, start)"
    }
    fn domain(&self) -> ToolDomain {
        ToolDomain::Agent
    }

    fn parameters_schema(&self) -> serde_json::Value {
        json!({
            "type": "object",
            "properties": {
                "agent_id": { "type": "string", "description": "Agent ID" },
                "action": {
                    "type": "string",
                    "enum": ["hibernate", "stop", "restart", "wake", "start"],
                    "description": "Lifecycle action to perform"
                }
            },
            "required": ["agent_id", "action"]
        })
    }

    async fn execute(
        &self,
        input: serde_json::Value,
        ctx: &AgentToolContext,
    ) -> Result<ToolResult, AgentRuntimeError> {
        let network = require_network(ctx)?;
        let agent_id = require_str(&input, "agent_id")?;
        let action = require_str(&input, "action")?;
        network_post(
            network,
            &format!("/api/agents/{agent_id}/remote_agent/{action}"),
            &ctx.jwt,
            &json!({}),
        )
        .await
    }
}
