use std::sync::Arc;

use async_trait::async_trait;
use serde_json::json;

use aura_os_core::{Capability, ProcessId, ProcessRunTrigger, ToolDomain};
use aura_os_process::ProcessExecutor;

use super::{AgentTool, AgentToolContext, CapabilityRequirement, Surface, ToolResult};
use aura_os_agent_runtime::AgentRuntimeError;

fn tool_err(action: &str, e: impl std::fmt::Display) -> AgentRuntimeError {
    AgentRuntimeError::ToolError(format!("{action}: {e}"))
}

fn require_storage_client(
    ctx: &AgentToolContext,
    action: &str,
) -> Result<Arc<aura_os_storage::StorageClient>, AgentRuntimeError> {
    ctx.storage_client
        .clone()
        .ok_or_else(|| tool_err(action, "aura-storage is not configured"))
}

fn default_project_id(ctx: &AgentToolContext) -> Option<String> {
    ctx.project_service
        .list_projects()
        .ok()
        .and_then(|projects| {
            projects
                .first()
                .map(|project| project.project_id.to_string())
        })
}

pub struct CreateProcessTool;

#[async_trait]
impl AgentTool for CreateProcessTool {
    fn name(&self) -> &str {
        "create_process"
    }
    fn description(&self) -> &str {
        "Create a new process workflow"
    }
    fn domain(&self) -> ToolDomain {
        ToolDomain::Process
    }
    fn surface(&self) -> Surface {
        Surface::OnDemand
    }
    fn required_capabilities(&self) -> &'static [CapabilityRequirement] {
        &[CapabilityRequirement::Exact(Capability::InvokeProcess)]
    }

    fn parameters_schema(&self) -> serde_json::Value {
        json!({
            "type": "object",
            "properties": {
                "name": { "type": "string", "description": "Name of the process" },
                "description": { "type": "string", "description": "Description of what the process does" },
                "project_id": { "type": "string", "description": "Project ID to associate this process with. If omitted, uses the first available project." },
                "schedule": { "type": "string", "description": "Optional schedule expression for scheduled triggering (cron syntax)" }
            },
            "required": ["name"]
        })
    }

    async fn execute(
        &self,
        input: serde_json::Value,
        ctx: &AgentToolContext,
    ) -> Result<ToolResult, AgentRuntimeError> {
        let client = require_storage_client(ctx, "create_process")?;
        let name = input["name"]
            .as_str()
            .ok_or_else(|| tool_err("create_process", "name is required"))?;
        let description = input
            .get("description")
            .and_then(|v| v.as_str())
            .map(str::to_string);
        let project_id = input
            .get("project_id")
            .and_then(|v| v.as_str())
            .map(str::to_string)
            .or_else(|| default_project_id(ctx));
        let project_id = project_id.ok_or_else(|| {
            tool_err(
                "create_process",
                "project_id is required when no projects are available",
            )
        })?;
        let schedule = input
            .get("schedule")
            .and_then(|v| v.as_str())
            .map(str::to_string);

        let storage_req = aura_os_storage::CreateProcessRequest {
            org_id: ctx.org_id.clone(),
            name: name.to_string(),
            project_id: Some(project_id),
            folder_id: None,
            description,
            enabled: Some(true),
            schedule,
            tags: Some(Vec::new()),
        };
        let created = client
            .create_process(&ctx.jwt, &storage_req)
            .await
            .map_err(|e| tool_err("create_process", e))?;
        let node_req = aura_os_storage::CreateProcessNodeRequest {
            node_type: "ignition".to_string(),
            label: Some("Ignition".to_string()),
            agent_id: None,
            prompt: None,
            config: None,
            position_x: Some(250.0),
            position_y: Some(50.0),
        };
        client
            .create_process_node(&created.id, &ctx.jwt, &node_req)
            .await
            .map_err(|e| tool_err("create_process", e))?;

        Ok(ToolResult {
            content: json!({
                "process_id": created.id,
                "name": created.name,
                "status": "created",
            }),
            is_error: false,
        })
    }
}

pub struct ListProcessesTool;

#[async_trait]
impl AgentTool for ListProcessesTool {
    fn name(&self) -> &str {
        "list_processes"
    }
    fn description(&self) -> &str {
        "List all processes in the organization"
    }
    fn domain(&self) -> ToolDomain {
        ToolDomain::Process
    }
    fn surface(&self) -> Surface {
        Surface::OnDemand
    }
    fn required_capabilities(&self) -> &'static [CapabilityRequirement] {
        &[CapabilityRequirement::Exact(Capability::InvokeProcess)]
    }

    fn parameters_schema(&self) -> serde_json::Value {
        json!({ "type": "object", "properties": {}, "required": [] })
    }

    async fn execute(
        &self,
        _input: serde_json::Value,
        ctx: &AgentToolContext,
    ) -> Result<ToolResult, AgentRuntimeError> {
        let client = require_storage_client(ctx, "list_processes")?;
        let processes = client
            .list_processes(&ctx.org_id, &ctx.jwt)
            .await
            .map_err(|e| tool_err("list_processes", e))?;
        let items: Vec<serde_json::Value> = processes
            .iter()
            .map(|p| {
                json!({
                    "process_id": p.id,
                    "name": p.name,
                    "enabled": p.enabled,
                    "last_run_at": p.last_run_at,
                })
            })
            .collect();
        Ok(ToolResult {
            content: json!({ "processes": items, "count": items.len() }),
            is_error: false,
        })
    }
}

pub struct TriggerProcessTool {
    pub executor: Arc<ProcessExecutor>,
}

#[async_trait]
impl AgentTool for TriggerProcessTool {
    fn name(&self) -> &str {
        "trigger_process"
    }
    fn description(&self) -> &str {
        trigger_process_metadata().0
    }
    fn domain(&self) -> ToolDomain {
        ToolDomain::Process
    }
    fn surface(&self) -> Surface {
        Surface::OnDemand
    }
    fn required_capabilities(&self) -> &'static [CapabilityRequirement] {
        &[CapabilityRequirement::Exact(Capability::InvokeProcess)]
    }

    fn parameters_schema(&self) -> serde_json::Value {
        trigger_process_metadata().1
    }

    async fn execute(
        &self,
        input: serde_json::Value,
        ctx: &AgentToolContext,
    ) -> Result<ToolResult, AgentRuntimeError> {
        let id_str = input["process_id"]
            .as_str()
            .ok_or_else(|| tool_err("trigger_process", "process_id is required"))?;
        let process_id: ProcessId = id_str.parse().map_err(|e| tool_err("trigger_process", e))?;

        let run = self
            .executor
            .trigger_with_auth(&process_id, ProcessRunTrigger::Manual, Some(&ctx.jwt))
            .await
            .map_err(|e| tool_err("trigger_process", e))?;

        Ok(ToolResult {
            content: json!({
                "process_id": id_str,
                "run_id": run.run_id.to_string(),
                "status": format!("{:?}", run.status),
            }),
            is_error: false,
        })
    }
}

pub struct DeleteProcessTool;

#[async_trait]
impl AgentTool for DeleteProcessTool {
    fn name(&self) -> &str {
        "delete_process"
    }
    fn description(&self) -> &str {
        "Delete a process permanently"
    }
    fn domain(&self) -> ToolDomain {
        ToolDomain::Process
    }
    fn surface(&self) -> Surface {
        Surface::OnDemand
    }
    fn required_capabilities(&self) -> &'static [CapabilityRequirement] {
        // TODO(tier-a): deletion needs the owning project's write cap but
        // the arg is `process_id`, not `project_id`; gate on
        // InvokeProcess as a conservative minimum.
        &[CapabilityRequirement::Exact(Capability::InvokeProcess)]
    }

    fn parameters_schema(&self) -> serde_json::Value {
        json!({
            "type": "object",
            "properties": {
                "process_id": { "type": "string", "description": "ID of the process to delete" }
            },
            "required": ["process_id"]
        })
    }

    async fn execute(
        &self,
        input: serde_json::Value,
        ctx: &AgentToolContext,
    ) -> Result<ToolResult, AgentRuntimeError> {
        let client = require_storage_client(ctx, "delete_process")?;
        let id_str = input["process_id"]
            .as_str()
            .ok_or_else(|| tool_err("delete_process", "process_id is required"))?;
        client
            .delete_process(id_str, &ctx.jwt)
            .await
            .map_err(|e| tool_err("delete_process", e))?;

        Ok(ToolResult {
            content: json!({ "process_id": id_str, "status": "deleted" }),
            is_error: false,
        })
    }
}

pub struct ListProcessRunsTool;

#[async_trait]
impl AgentTool for ListProcessRunsTool {
    fn name(&self) -> &str {
        "list_process_runs"
    }
    fn description(&self) -> &str {
        "List execution runs for a process"
    }
    fn domain(&self) -> ToolDomain {
        ToolDomain::Process
    }
    fn surface(&self) -> Surface {
        Surface::OnDemand
    }
    fn required_capabilities(&self) -> &'static [CapabilityRequirement] {
        &[CapabilityRequirement::Exact(Capability::InvokeProcess)]
    }

    fn parameters_schema(&self) -> serde_json::Value {
        json!({
            "type": "object",
            "properties": {
                "process_id": { "type": "string", "description": "ID of the process" }
            },
            "required": ["process_id"]
        })
    }

    async fn execute(
        &self,
        input: serde_json::Value,
        ctx: &AgentToolContext,
    ) -> Result<ToolResult, AgentRuntimeError> {
        let client = require_storage_client(ctx, "list_process_runs")?;
        let id_str = input["process_id"]
            .as_str()
            .ok_or_else(|| tool_err("list_process_runs", "process_id is required"))?;
        let runs = client
            .list_process_runs(id_str, &ctx.jwt)
            .await
            .map_err(|e| tool_err("list_process_runs", e))?;

        let items: Vec<serde_json::Value> = runs
            .iter()
            .map(|r| {
                json!({
                    "run_id": r.id,
                    "status": r.status,
                    "trigger": r.trigger,
                    "started_at": r.started_at,
                    "completed_at": r.completed_at,
                    "error": r.error,
                })
            })
            .collect();

        Ok(ToolResult {
            content: json!({ "runs": items, "count": items.len() }),
            is_error: false,
        })
    }
}

/// Static `(description, parameters_schema)` for `trigger_process`.
///
/// `TriggerProcessTool` holds an `Arc<ProcessExecutor>` so it can't be
/// instantiated by [`crate::tools::tool_metadata_map`] (which runs
/// without an executor). Both that map and the trait impl below call
/// this helper so the two can't drift out of sync.
pub(crate) fn trigger_process_metadata() -> (&'static str, serde_json::Value) {
    (
        "Manually trigger a process to run immediately",
        json!({
            "type": "object",
            "properties": {
                "process_id": {
                    "type": "string",
                    "description": "ID of the process to trigger"
                }
            },
            "required": ["process_id"]
        }),
    )
}
