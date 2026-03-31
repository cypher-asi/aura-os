use async_trait::async_trait;
use serde_json::json;

use aura_os_core::ToolDomain;

use super::helpers::{network_get, network_post, require_network, require_str};
use super::{SuperAgentContext, SuperAgentTool, ToolResult};
use crate::SuperAgentError;

// ---------------------------------------------------------------------------
// 1. ListTasksTool
// ---------------------------------------------------------------------------

pub struct ListTasksTool;

#[async_trait]
impl SuperAgentTool for ListTasksTool {
    fn name(&self) -> &str { "list_tasks" }
    fn description(&self) -> &str { "List all tasks for a project" }
    fn domain(&self) -> ToolDomain { ToolDomain::Task }

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
        network_get(network, &format!("/api/projects/{project_id}/tasks"), &ctx.jwt).await
    }
}

// ---------------------------------------------------------------------------
// 2. ListTasksBySpecTool
// ---------------------------------------------------------------------------

pub struct ListTasksBySpecTool;

#[async_trait]
impl SuperAgentTool for ListTasksBySpecTool {
    fn name(&self) -> &str { "list_tasks_by_spec" }
    fn description(&self) -> &str { "List all tasks for a specific specification" }
    fn domain(&self) -> ToolDomain { ToolDomain::Task }

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
        network_get(network, &format!("/api/projects/{project_id}/specs/{spec_id}/tasks"), &ctx.jwt).await
    }
}

// ---------------------------------------------------------------------------
// 3. CreateTaskTool
// ---------------------------------------------------------------------------

pub struct CreateTaskTool;

#[async_trait]
impl SuperAgentTool for CreateTaskTool {
    fn name(&self) -> &str { "create_task" }
    fn description(&self) -> &str { "Create a new task in a project" }
    fn domain(&self) -> ToolDomain { ToolDomain::Task }

    fn parameters_schema(&self) -> serde_json::Value {
        json!({
            "type": "object",
            "properties": {
                "project_id": { "type": "string", "description": "Project ID" },
                "title": { "type": "string", "description": "Task title" },
                "description": { "type": "string", "description": "Task description" },
                "spec_id": { "type": "string", "description": "Spec ID to associate with" },
                "status": { "type": "string", "description": "Initial status (e.g. pending, in_progress)" }
            },
            "required": ["project_id", "title", "spec_id"]
        })
    }

    async fn execute(&self, input: serde_json::Value, ctx: &SuperAgentContext) -> Result<ToolResult, SuperAgentError> {
        let network = require_network(ctx)?;
        let project_id = require_str(&input, "project_id")?;
        let mut body = json!({
            "title": input["title"].as_str().unwrap_or_default(),
        });
        if let Some(desc) = input["description"].as_str() {
            body["description"] = json!(desc);
        }
        if let Some(spec_id) = input["spec_id"].as_str() {
            body["spec_id"] = json!(spec_id);
        }
        if let Some(status) = input["status"].as_str() {
            body["status"] = json!(status);
        }
        network_post(network, &format!("/api/projects/{project_id}/tasks"), &ctx.jwt, &body).await
    }
}

// ---------------------------------------------------------------------------
// 4. ExtractTasksTool
// ---------------------------------------------------------------------------

pub struct ExtractTasksTool;

#[async_trait]
impl SuperAgentTool for ExtractTasksTool {
    fn name(&self) -> &str { "extract_tasks" }
    fn description(&self) -> &str { "Auto-extract tasks from project specifications" }
    fn domain(&self) -> ToolDomain { ToolDomain::Task }

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
        network_post(network, &format!("/api/projects/{project_id}/tasks/extract"), &ctx.jwt, &json!({})).await
    }
}

// ---------------------------------------------------------------------------
// 5. TransitionTaskTool
// ---------------------------------------------------------------------------

pub struct TransitionTaskTool;

#[async_trait]
impl SuperAgentTool for TransitionTaskTool {
    fn name(&self) -> &str { "transition_task" }
    fn description(&self) -> &str { "Transition a task to a new status (e.g. pending -> in_progress -> done)" }
    fn domain(&self) -> ToolDomain { ToolDomain::Task }

    fn parameters_schema(&self) -> serde_json::Value {
        json!({
            "type": "object",
            "properties": {
                "project_id": { "type": "string", "description": "Project ID" },
                "task_id": { "type": "string", "description": "Task ID" },
                "new_status": { "type": "string", "description": "Target status (e.g. pending, ready, in_progress, done, failed)" }
            },
            "required": ["project_id", "task_id", "new_status"]
        })
    }

    async fn execute(&self, input: serde_json::Value, ctx: &SuperAgentContext) -> Result<ToolResult, SuperAgentError> {
        let network = require_network(ctx)?;
        let project_id = require_str(&input, "project_id")?;
        let task_id = require_str(&input, "task_id")?;
        let new_status = require_str(&input, "new_status")?;
        let body = json!({ "new_status": new_status });
        network_post(network, &format!("/api/projects/{project_id}/tasks/{task_id}/transition"), &ctx.jwt, &body).await
    }
}

// ---------------------------------------------------------------------------
// 6. RetryTaskTool
// ---------------------------------------------------------------------------

pub struct RetryTaskTool;

#[async_trait]
impl SuperAgentTool for RetryTaskTool {
    fn name(&self) -> &str { "retry_task" }
    fn description(&self) -> &str { "Retry a failed task" }
    fn domain(&self) -> ToolDomain { ToolDomain::Task }

    fn parameters_schema(&self) -> serde_json::Value {
        json!({
            "type": "object",
            "properties": {
                "project_id": { "type": "string", "description": "Project ID" },
                "task_id": { "type": "string", "description": "Task ID" }
            },
            "required": ["project_id", "task_id"]
        })
    }

    async fn execute(&self, input: serde_json::Value, ctx: &SuperAgentContext) -> Result<ToolResult, SuperAgentError> {
        let network = require_network(ctx)?;
        let project_id = require_str(&input, "project_id")?;
        let task_id = require_str(&input, "task_id")?;
        network_post(network, &format!("/api/projects/{project_id}/tasks/{task_id}/retry"), &ctx.jwt, &json!({})).await
    }
}

// ---------------------------------------------------------------------------
// 7. RunTaskTool
// ---------------------------------------------------------------------------

pub struct RunTaskTool;

#[async_trait]
impl SuperAgentTool for RunTaskTool {
    fn name(&self) -> &str { "run_task" }
    fn description(&self) -> &str { "Execute a task by dispatching it to an agent" }
    fn domain(&self) -> ToolDomain { ToolDomain::Task }

    fn parameters_schema(&self) -> serde_json::Value {
        json!({
            "type": "object",
            "properties": {
                "project_id": { "type": "string", "description": "Project ID" },
                "task_id": { "type": "string", "description": "Task ID" }
            },
            "required": ["project_id", "task_id"]
        })
    }

    async fn execute(&self, input: serde_json::Value, ctx: &SuperAgentContext) -> Result<ToolResult, SuperAgentError> {
        let network = require_network(ctx)?;
        let project_id = require_str(&input, "project_id")?;
        let task_id = require_str(&input, "task_id")?;
        network_post(network, &format!("/api/projects/{project_id}/tasks/{task_id}/run"), &ctx.jwt, &json!({})).await
    }
}

// ---------------------------------------------------------------------------
// 8. GetTaskOutputTool
// ---------------------------------------------------------------------------

pub struct GetTaskOutputTool;

#[async_trait]
impl SuperAgentTool for GetTaskOutputTool {
    fn name(&self) -> &str { "get_task_output" }
    fn description(&self) -> &str { "Get the output/result of a completed task" }
    fn domain(&self) -> ToolDomain { ToolDomain::Task }

    fn parameters_schema(&self) -> serde_json::Value {
        json!({
            "type": "object",
            "properties": {
                "project_id": { "type": "string", "description": "Project ID" },
                "task_id": { "type": "string", "description": "Task ID" }
            },
            "required": ["project_id", "task_id"]
        })
    }

    async fn execute(&self, input: serde_json::Value, ctx: &SuperAgentContext) -> Result<ToolResult, SuperAgentError> {
        let network = require_network(ctx)?;
        let project_id = require_str(&input, "project_id")?;
        let task_id = require_str(&input, "task_id")?;
        network_get(network, &format!("/api/projects/{project_id}/tasks/{task_id}/output"), &ctx.jwt).await
    }
}
