use std::sync::Arc;

use async_trait::async_trait;
use chrono::Utc;
use serde_json::json;

use aura_os_core::{
    Process, ProcessId, ProcessNode, ProcessNodeId, ProcessNodeType, ProcessRunTrigger, ToolDomain,
};
use aura_os_process::{ProcessExecutor, ProcessStore};

use super::{SuperAgentContext, SuperAgentTool, ToolResult};
use crate::SuperAgentError;

fn tool_err(action: &str, e: impl std::fmt::Display) -> SuperAgentError {
    SuperAgentError::ToolError(format!("{action}: {e}"))
}

// ---------------------------------------------------------------------------
// CreateProcess
// ---------------------------------------------------------------------------

pub struct CreateProcessTool {
    pub store: Arc<ProcessStore>,
}

#[async_trait]
impl SuperAgentTool for CreateProcessTool {
    fn name(&self) -> &str { "create_process" }
    fn description(&self) -> &str { "Create a new process workflow" }
    fn domain(&self) -> ToolDomain { ToolDomain::Process }

    fn parameters_schema(&self) -> serde_json::Value {
        json!({
            "type": "object",
            "properties": {
                "name": { "type": "string", "description": "Name of the process" },
                "description": { "type": "string", "description": "Description of what the process does" },
                "project_id": { "type": "string", "description": "Project ID to associate this process with. If omitted, uses the first available project." },
                "schedule": { "type": "string", "description": "Optional cron expression for scheduled triggering" }
            },
            "required": ["name"]
        })
    }

    async fn execute(
        &self,
        input: serde_json::Value,
        ctx: &SuperAgentContext,
    ) -> Result<ToolResult, SuperAgentError> {
        let name = input["name"].as_str()
            .ok_or_else(|| tool_err("create_process", "name is required"))?;
        let description = input.get("description").and_then(|v| v.as_str()).unwrap_or("");
        let schedule = input.get("schedule").and_then(|v| v.as_str()).map(String::from);

        let project_id = input.get("project_id")
            .and_then(|v| v.as_str())
            .and_then(|s| s.parse().ok())
            .or_else(|| {
                ctx.project_service.list_projects().ok()
                    .and_then(|ps| ps.first().map(|p| p.project_id))
            });

        let now = Utc::now();
        let process = Process {
            process_id: ProcessId::new(),
            org_id: ctx.org_id.parse().unwrap_or_default(),
            user_id: ctx.user_id.clone(),
            project_id,
            name: name.to_string(),
            description: description.to_string(),
            enabled: true,
            folder_id: None,
            schedule,
            tags: Vec::new(),
            last_run_at: None,
            next_run_at: None,
            created_at: now,
            updated_at: now,
        };

        self.store.save_process(&process).map_err(|e| tool_err("create_process", e))?;

        let ignition = ProcessNode {
            node_id: ProcessNodeId::new(),
            process_id: process.process_id,
            node_type: ProcessNodeType::Ignition,
            label: "Ignition".to_string(),
            agent_id: None,
            prompt: String::new(),
            config: json!({}),
            position_x: 250.0,
            position_y: 50.0,
            created_at: now,
            updated_at: now,
        };
        self.store.save_node(&ignition).map_err(|e| tool_err("create_process", e))?;

        Ok(ToolResult {
            content: json!({
                "process_id": process.process_id.to_string(),
                "name": process.name,
                "status": "created"
            }),
            is_error: false,
        })
    }
}

// ---------------------------------------------------------------------------
// ListProcesses
// ---------------------------------------------------------------------------

pub struct ListProcessesTool {
    pub store: Arc<ProcessStore>,
}

#[async_trait]
impl SuperAgentTool for ListProcessesTool {
    fn name(&self) -> &str { "list_processes" }
    fn description(&self) -> &str { "List all processes in the organization" }
    fn domain(&self) -> ToolDomain { ToolDomain::Process }

    fn parameters_schema(&self) -> serde_json::Value {
        json!({ "type": "object", "properties": {}, "required": [] })
    }

    async fn execute(
        &self,
        _input: serde_json::Value,
        _ctx: &SuperAgentContext,
    ) -> Result<ToolResult, SuperAgentError> {
        let processes = self.store.list_processes().map_err(|e| tool_err("list_processes", e))?;
        let items: Vec<serde_json::Value> = processes.iter().map(|p| {
            json!({
                "process_id": p.process_id.to_string(),
                "name": p.name,
                "enabled": p.enabled,
                "last_run_at": p.last_run_at.map(|t| t.to_rfc3339()),
            })
        }).collect();
        Ok(ToolResult {
            content: json!({ "processes": items, "count": items.len() }),
            is_error: false,
        })
    }
}

// ---------------------------------------------------------------------------
// TriggerProcess
// ---------------------------------------------------------------------------

pub struct TriggerProcessTool {
    pub store: Arc<ProcessStore>,
    pub executor: Arc<ProcessExecutor>,
}

#[async_trait]
impl SuperAgentTool for TriggerProcessTool {
    fn name(&self) -> &str { "trigger_process" }
    fn description(&self) -> &str { "Manually trigger a process to run immediately" }
    fn domain(&self) -> ToolDomain { ToolDomain::Process }

    fn parameters_schema(&self) -> serde_json::Value {
        json!({
            "type": "object",
            "properties": {
                "process_id": { "type": "string", "description": "ID of the process to trigger" }
            },
            "required": ["process_id"]
        })
    }

    async fn execute(
        &self,
        input: serde_json::Value,
        _ctx: &SuperAgentContext,
    ) -> Result<ToolResult, SuperAgentError> {
        let id_str = input["process_id"].as_str()
            .ok_or_else(|| tool_err("trigger_process", "process_id is required"))?;
        let process_id: ProcessId = id_str.parse()
            .map_err(|e| tool_err("trigger_process", e))?;

        let run = self.executor.trigger(&process_id, ProcessRunTrigger::Manual)
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

// ---------------------------------------------------------------------------
// DeleteProcess
// ---------------------------------------------------------------------------

pub struct DeleteProcessTool {
    pub store: Arc<ProcessStore>,
}

#[async_trait]
impl SuperAgentTool for DeleteProcessTool {
    fn name(&self) -> &str { "delete_process" }
    fn description(&self) -> &str { "Delete a process permanently" }
    fn domain(&self) -> ToolDomain { ToolDomain::Process }

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
        _ctx: &SuperAgentContext,
    ) -> Result<ToolResult, SuperAgentError> {
        let id_str = input["process_id"].as_str()
            .ok_or_else(|| tool_err("delete_process", "process_id is required"))?;
        let process_id: ProcessId = id_str.parse()
            .map_err(|e| tool_err("delete_process", e))?;

        self.store.delete_process(&process_id)
            .map_err(|e| tool_err("delete_process", e))?;

        Ok(ToolResult {
            content: json!({ "process_id": id_str, "status": "deleted" }),
            is_error: false,
        })
    }
}

// ---------------------------------------------------------------------------
// ListProcessRuns
// ---------------------------------------------------------------------------

pub struct ListProcessRunsTool {
    pub store: Arc<ProcessStore>,
}

#[async_trait]
impl SuperAgentTool for ListProcessRunsTool {
    fn name(&self) -> &str { "list_process_runs" }
    fn description(&self) -> &str { "List execution runs for a process" }
    fn domain(&self) -> ToolDomain { ToolDomain::Process }

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
        _ctx: &SuperAgentContext,
    ) -> Result<ToolResult, SuperAgentError> {
        let id_str = input["process_id"].as_str()
            .ok_or_else(|| tool_err("list_process_runs", "process_id is required"))?;
        let process_id: ProcessId = id_str.parse()
            .map_err(|e| tool_err("list_process_runs", e))?;

        let runs = self.store.list_runs(&process_id)
            .map_err(|e| tool_err("list_process_runs", e))?;

        let items: Vec<serde_json::Value> = runs.iter().map(|r| {
            json!({
                "run_id": r.run_id.to_string(),
                "status": format!("{:?}", r.status),
                "trigger": format!("{:?}", r.trigger),
                "started_at": r.started_at.to_rfc3339(),
                "completed_at": r.completed_at.map(|t| t.to_rfc3339()),
                "error": r.error,
            })
        }).collect();

        Ok(ToolResult {
            content: json!({ "runs": items, "count": items.len() }),
            is_error: false,
        })
    }
}
