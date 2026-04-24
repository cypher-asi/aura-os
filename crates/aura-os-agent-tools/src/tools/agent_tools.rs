use async_trait::async_trait;
use serde_json::json;
use tracing::warn;

use aura_os_core::{AgentId, Capability, ToolDomain};

use super::helpers::{
    network_delete, network_get, network_post, network_put, require_network, require_str, tool_err,
};
use super::{AgentTool, AgentToolContext, CapabilityRequirement, Surface, ToolResult};
use aura_os_agent_runtime::AgentRuntimeError;

/// Render a `NetworkAgent` as the minimal summary the CEO needs to
/// route a follow-up (`get_agent`, `send_to_agent`, ...).
///
/// `NetworkAgent` carries multi-KB `system_prompt` / `personality`
/// strings plus marketplace fields (`revenue_usd`, `reputation`,
/// `jobs`, `expertise`, ...). Emitting any of those from `list_agents`
/// pushes tens of KB into the LLM's tool_result which then rides along
/// with every subsequent turn (the harness `Session.messages` vector
/// is append-only). Keep the shape to `{id, name, role}` — anything
/// richer is a UI concern served by the Agent Library's `GET
/// /api/agents` handler, not something that belongs in the LLM
/// context. Callers that really want the full record can ask
/// `get_agent` with `include_details=true`.
fn to_agent_summary(agent: &aura_os_network::NetworkAgent) -> serde_json::Value {
    json!({
        "id": agent.id,
        "name": agent.name,
        "role": agent.role,
    })
}

/// Merge an org-scoped and a user-scoped agent listing into a single
/// deduplicated view, preferring the org-scoped record on `id` collision.
///
/// Mirrors the merge strategy in `apps/aura-os-server` `list_agents`
/// handler (commit 23ad8d56): the org-scoped call returns every
/// teammate's agent in the org, while the user-scoped call acts as a
/// best-effort backstop so legacy rows with `org_id IS NULL` — created
/// before the UI started stamping `activeOrg` on create — don't
/// silently disappear from the caller's view. Org entries are
/// emitted first, then any user-only ids, preserving the relative
/// order of each input.
fn merge_network_agents(
    org_agents: Vec<aura_os_network::NetworkAgent>,
    user_agents: Vec<aura_os_network::NetworkAgent>,
) -> Vec<aura_os_network::NetworkAgent> {
    let mut merged: Vec<aura_os_network::NetworkAgent> =
        Vec::with_capacity(org_agents.len() + user_agents.len());
    let mut seen = std::collections::HashSet::with_capacity(org_agents.len() + user_agents.len());
    for na in org_agents.into_iter().chain(user_agents.into_iter()) {
        if seen.insert(na.id.clone()) {
            merged.push(na);
        }
    }
    merged
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
        if let Some(network) = ctx.network_client.as_deref() {
            // Scope the catalog fetch to the caller's org so the CEO
            // sees every teammate's agent in the org, not just the
            // ones owned by the JWT's user_id (commit 8a085cc0).
            // aura-network's `list_agents?org_id=X` drops the user_id
            // filter (and authorizes via org membership) once org_id
            // is supplied.
            //
            // The strict `WHERE org_id = $1` filter on the server
            // hides legacy rows with `org_id IS NULL` — agents
            // created before the UI started stamping `activeOrg` on
            // create, or created during an activeOrg-null window on
            // mount. Commit 23ad8d56 patched this for the HTTP
            // handler in apps/aura-os-server by running the
            // org-scoped and user-scoped lookups concurrently and
            // merging by id. Mirror that here so the CEO's
            // `list_agents` tool returns the same view as the
            // sidebar — otherwise NULL-org agents the caller owns
            // are silently invisible to the CEO (4 shown where the
            // sidebar shows 15).
            //
            // Guard against the `DEFAULT_ORG_SENTINEL` string used
            // by the server dispatcher when it genuinely can't
            // resolve an org: sending `?org_id=default` to
            // aura-network will 403 because nobody is a member of
            // that literal. Fall back to the user-scoped call in
            // that case so the CEO at least sees its own
            // bootstrap-seeded agents.
            let trimmed = ctx.org_id.trim();
            let agents = if trimmed.is_empty() || trimmed == "default" {
                network
                    .list_agents(&ctx.jwt)
                    .await
                    .map_err(|e| tool_err("list_agents", e))?
            } else {
                let org_scoped = network.list_agents_by_org(trimmed, &ctx.jwt);
                let user_scoped = network.list_agents(&ctx.jwt);
                let (org_agents, user_agents) = tokio::join!(org_scoped, user_scoped);
                let org_agents = org_agents.map_err(|e| tool_err("list_agents", e))?;
                // The user-scoped call is a best-effort backstop for
                // legacy NULL-org agents; if it fails (e.g. transient
                // aura-network blip), fall back to the org view
                // alone rather than failing the whole tool call.
                let user_agents = match user_agents {
                    Ok(list) => list,
                    Err(err) => {
                        warn!(
                            error = %err,
                            "list_agents tool: user-scoped backstop failed; returning org-scoped result only"
                        );
                        Vec::new()
                    }
                };
                merge_network_agents(org_agents, user_agents)
            };
            let summaries: Vec<serde_json::Value> = agents.iter().map(to_agent_summary).collect();
            return Ok(ToolResult {
                content: serde_json::Value::Array(summaries),
                is_error: false,
            });
        }

        let agents = ctx
            .agent_service
            .list_agents()
            .map_err(|e| tool_err("list_agents", e))?;
        let summaries: Vec<serde_json::Value> = agents
            .iter()
            .map(|a| {
                json!({
                    "id": a.agent_id.to_string(),
                    "name": a.name,
                    "role": a.role,
                })
            })
            .collect();
        Ok(ToolResult {
            content: serde_json::Value::Array(summaries),
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
        "Get details of a specific agent. Returns a compact summary by default; pass include_details=true to also include the full system prompt, personality, and marketplace metadata (verbose)."
    }
    fn domain(&self) -> ToolDomain {
        ToolDomain::Agent
    }
    fn required_capabilities(&self) -> &'static [CapabilityRequirement] {
        &[CapabilityRequirement::Exact(Capability::ReadAgent)]
    }

    fn parameters_schema(&self) -> serde_json::Value {
        json!({
            "type": "object",
            "properties": {
                "agent_id": { "type": "string", "description": "Agent ID" },
                "include_details": {
                    "type": "boolean",
                    "description": "If true, include the full system_prompt, personality, and marketplace metadata. Defaults to false to keep conversation context small.",
                    "default": false
                }
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
        let include_details = input
            .get("include_details")
            .and_then(|v| v.as_bool())
            .unwrap_or(false);

        if let Some(network) = ctx.network_client.as_deref() {
            let agent = network
                .get_agent(agent_id_str, &ctx.jwt)
                .await
                .map_err(|e| tool_err("get_agent", e))?;
            let value = if include_details {
                serde_json::to_value(&agent).unwrap_or_default()
            } else {
                to_agent_summary(&agent)
            };
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
        let value = if include_details {
            serde_json::to_value(&agent).unwrap_or_default()
        } else {
            json!({
                "id": agent.agent_id.to_string(),
                "name": agent.name,
                "role": agent.role,
            })
        };
        Ok(ToolResult {
            content: value,
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
    fn required_capabilities(&self) -> &'static [CapabilityRequirement] {
        &[CapabilityRequirement::WriteProjectFromArg("project_id")]
    }

    fn parameters_schema(&self) -> serde_json::Value {
        json!({
            "type": "object",
            "properties": {
                "project_id": { "type": "string", "description": "Target project ID" },
                "agent_id": { "type": "string", "description": "Agent template ID to assign" }
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
    fn surface(&self) -> Surface {
        Surface::OnDemand
    }
    fn required_capabilities(&self) -> &'static [CapabilityRequirement] {
        &[CapabilityRequirement::Exact(Capability::SpawnAgent)]
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
        network_post(network, "/api/agents", &ctx.jwt, &body).await
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
    fn surface(&self) -> Surface {
        Surface::OnDemand
    }
    fn required_capabilities(&self) -> &'static [CapabilityRequirement] {
        &[CapabilityRequirement::Exact(Capability::ControlAgent)]
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
        network_put(network, &format!("/api/agents/{agent_id}"), &ctx.jwt, &body).await
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
    fn surface(&self) -> Surface {
        Surface::OnDemand
    }
    fn required_capabilities(&self) -> &'static [CapabilityRequirement] {
        &[CapabilityRequirement::Exact(Capability::ControlAgent)]
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
        network_delete(network, &format!("/api/agents/{agent_id}"), &ctx.jwt).await
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
    fn required_capabilities(&self) -> &'static [CapabilityRequirement] {
        &[CapabilityRequirement::ReadProjectFromArg("project_id")]
    }

    fn parameters_schema(&self) -> serde_json::Value {
        json!({
            "type": "object",
            "properties": {
                "project_id": { "type": "string", "description": "Project ID" }
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
                "agent_instance_id": { "type": "string", "description": "Agent instance ID" },
                "status": {
                    "type": "string",
                    "enum": ["idle", "working", "blocked", "stopped", "error", "archived"],
                    "description": "New status for the agent instance"
                }
            },
            "required": ["agent_instance_id", "status"]
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
                "agent_instance_id": { "type": "string", "description": "Agent instance ID" }
            },
            "required": ["agent_instance_id"]
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
    fn surface(&self) -> Surface {
        Surface::OnDemand
    }
    fn required_capabilities(&self) -> &'static [CapabilityRequirement] {
        &[CapabilityRequirement::Exact(Capability::ControlAgent)]
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

#[cfg(test)]
mod tests {
    use super::*;
    use aura_os_network::NetworkAgent;

    fn fixture_agent() -> NetworkAgent {
        NetworkAgent {
            id: "agent-1".into(),
            name: "Barret".into(),
            role: Some("engineer".into()),
            personality: Some("A".repeat(2000)),
            system_prompt: Some("S".repeat(5000)),
            skills: Some(vec!["rust".into()]),
            icon: Some("robot".into()),
            harness: Some("local".into()),
            machine_type: Some("m1".into()),
            vm_id: None,
            user_id: "user-1".into(),
            org_id: Some("org-1".into()),
            profile_id: None,
            tags: Some(vec!["core".into()]),
            listing_status: Some("closed".into()),
            expertise: Some(vec!["rust".into()]),
            jobs: Some(12),
            revenue_usd: Some(1234.5),
            reputation: Some(4.2),
            permissions: Default::default(),
            intent_classifier: None,
            created_at: None,
            updated_at: None,
        }
    }

    #[test]
    fn to_agent_summary_is_id_name_role_only() {
        // Guardrail: the `list_agents` tool_result rides along with
        // every subsequent CEO turn via the harness's append-only
        // `Session.messages`. Keep the shape strictly `{id, name,
        // role}` — adding any richer field here (skills, tags,
        // listing_status, icon, personality, system_prompt, ...) was
        // how a single `list_agents` call used to push the context
        // utilisation bar to 100% on two-turn chats. Anything richer
        // is a UI concern served by `GET /api/agents`, not something
        // that belongs in the LLM context.
        let agent = fixture_agent();
        let summary = to_agent_summary(&agent);

        let obj = summary.as_object().expect("summary is a JSON object");
        let keys: std::collections::BTreeSet<&str> = obj.keys().map(String::as_str).collect();
        assert_eq!(
            keys,
            ["id", "name", "role"].into_iter().collect(),
            "to_agent_summary must emit exactly id/name/role; got {keys:?}"
        );
        assert_eq!(obj["id"], "agent-1");
        assert_eq!(obj["name"], "Barret");
        assert_eq!(obj["role"], "engineer");

        // And the resulting payload is tiny compared to the raw record.
        let rendered = serde_json::to_string(&summary).expect("serializes");
        let raw = serde_json::to_string(&agent).expect("serializes raw");
        assert!(
            rendered.len() < raw.len() / 20,
            "summary ({} bytes) not materially smaller than raw ({} bytes)",
            rendered.len(),
            raw.len()
        );
    }

    fn minimal_agent(id: &str, user_id: &str, org_id: Option<&str>) -> NetworkAgent {
        NetworkAgent {
            id: id.into(),
            name: format!("agent-{id}"),
            role: Some("engineer".into()),
            personality: None,
            system_prompt: None,
            skills: None,
            icon: None,
            harness: None,
            machine_type: None,
            vm_id: None,
            user_id: user_id.into(),
            org_id: org_id.map(str::to_string),
            profile_id: None,
            tags: None,
            listing_status: None,
            expertise: None,
            jobs: None,
            revenue_usd: None,
            reputation: None,
            permissions: Default::default(),
            intent_classifier: None,
            created_at: None,
            updated_at: None,
        }
    }

    #[test]
    fn merge_prefers_org_record_on_id_collision() {
        // Same agent id appears in both lists, but with different
        // `user_id` values (simulating aura-network's org view
        // exposing a teammate's `user_id` field that the caller's
        // user-scoped view doesn't carry). The org entry must win
        // so fleet-membership metadata isn't clobbered — matches
        // the server handler's merge semantics from commit
        // 23ad8d56.
        let org = vec![minimal_agent("shared", "teammate", Some("org-1"))];
        let user = vec![minimal_agent("shared", "caller", None)];

        let merged = merge_network_agents(org, user);

        assert_eq!(merged.len(), 1, "id collisions should dedupe");
        assert_eq!(merged[0].id, "shared");
        assert_eq!(
            merged[0].user_id, "teammate",
            "org record must win on conflict"
        );
        assert_eq!(
            merged[0].org_id.as_deref(),
            Some("org-1"),
            "org metadata preserved"
        );
    }

    #[test]
    fn merge_includes_user_only_agents() {
        // The whole point of the merge: a legacy NULL-org agent the
        // caller owns is invisible to the strict org-scoped view
        // and must be restored from the user-scoped backstop.
        let org = vec![minimal_agent("org-only", "teammate", Some("org-1"))];
        let user = vec![minimal_agent("null-org", "caller", None)];

        let merged = merge_network_agents(org, user);

        let ids: std::collections::BTreeSet<&str> = merged.iter().map(|a| a.id.as_str()).collect();
        assert_eq!(
            ids,
            ["null-org", "org-only"].into_iter().collect(),
            "both lists contribute their unique ids"
        );
    }

    #[test]
    fn merge_is_order_stable_org_first() {
        // Emitting org entries first (in their original order)
        // followed by user-only entries keeps the output
        // deterministic for downstream consumers / tests.
        let org = vec![
            minimal_agent("a", "t", Some("org-1")),
            minimal_agent("b", "t", Some("org-1")),
        ];
        let user = vec![
            minimal_agent("a", "caller", None),
            minimal_agent("c", "caller", None),
        ];

        let merged = merge_network_agents(org, user);

        let ordered_ids: Vec<&str> = merged.iter().map(|a| a.id.as_str()).collect();
        assert_eq!(
            ordered_ids,
            vec!["a", "b", "c"],
            "org entries come first, then user-only ids"
        );
    }

    #[test]
    fn merge_empty_user_backstop_returns_org_only() {
        // When the user-scoped call is skipped (empty Vec — the
        // fallback path used when the backstop errors), merging
        // must still yield the org-scoped list untouched.
        let org = vec![
            minimal_agent("a", "t", Some("org-1")),
            minimal_agent("b", "t", Some("org-1")),
        ];

        let merged = merge_network_agents(org.clone(), Vec::new());

        assert_eq!(merged.len(), org.len());
        assert_eq!(merged[0].id, "a");
        assert_eq!(merged[1].id, "b");
    }
}
