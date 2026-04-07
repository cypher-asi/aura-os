use async_trait::async_trait;
use serde_json::json;

use aura_os_core::ToolDomain;
use aura_os_link::AutomatonStartParams;

use super::{SuperAgentContext, SuperAgentTool, ToolResult};
use crate::SuperAgentError;

fn tool_err(action: &str, e: impl std::fmt::Display) -> SuperAgentError {
    SuperAgentError::ToolError(format!("{action}: {e}"))
}

// ---------------------------------------------------------------------------
// 1. StartDevLoopTool
// ---------------------------------------------------------------------------

pub struct StartDevLoopTool;

#[async_trait]
impl SuperAgentTool for StartDevLoopTool {
    fn name(&self) -> &str {
        "start_dev_loop"
    }
    fn description(&self) -> &str {
        "Start a development loop for an agent instance on a project"
    }
    fn domain(&self) -> ToolDomain {
        ToolDomain::Execution
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
        ctx: &SuperAgentContext,
    ) -> Result<ToolResult, SuperAgentError> {
        let project_id = input["project_id"]
            .as_str()
            .ok_or_else(|| SuperAgentError::ToolError("project_id is required".into()))?;
        let _agent_instance_id = input["agent_instance_id"]
            .as_str()
            .ok_or_else(|| SuperAgentError::ToolError("agent_instance_id is required".into()))?;

        let params = AutomatonStartParams {
            project_id: project_id.to_string(),
            auth_token: Some(ctx.jwt.clone()),
            model: None,
            workspace_root: None,
            task_id: None,
            git_repo_url: None,
            git_branch: None,
        };

        let result = ctx
            .automaton_client
            .start(params)
            .await
            .map_err(|e| tool_err("start_dev_loop", e))?;

        Ok(ToolResult {
            content: json!({
                "automaton_id": result.automaton_id,
                "event_stream_url": result.event_stream_url,
                "status": "started"
            }),
            is_error: false,
        })
    }
}

// ---------------------------------------------------------------------------
// 2. PauseDevLoopTool
// ---------------------------------------------------------------------------

pub struct PauseDevLoopTool;

#[async_trait]
impl SuperAgentTool for PauseDevLoopTool {
    fn name(&self) -> &str {
        "pause_dev_loop"
    }
    fn description(&self) -> &str {
        "Pause a running development loop"
    }
    fn domain(&self) -> ToolDomain {
        ToolDomain::Execution
    }

    fn parameters_schema(&self) -> serde_json::Value {
        json!({
            "type": "object",
            "properties": {
                "automaton_id": { "type": "string", "description": "Automaton ID (returned by start_dev_loop)" }
            },
            "required": ["automaton_id"]
        })
    }

    async fn execute(
        &self,
        input: serde_json::Value,
        ctx: &SuperAgentContext,
    ) -> Result<ToolResult, SuperAgentError> {
        let automaton_id = input["automaton_id"]
            .as_str()
            .ok_or_else(|| SuperAgentError::ToolError("automaton_id is required".into()))?;

        ctx.automaton_client
            .pause(automaton_id)
            .await
            .map_err(|e| tool_err("pause_dev_loop", e))?;

        Ok(ToolResult {
            content: json!({ "status": "paused", "automaton_id": automaton_id }),
            is_error: false,
        })
    }
}

// ---------------------------------------------------------------------------
// 3. StopDevLoopTool
// ---------------------------------------------------------------------------

pub struct StopDevLoopTool;

#[async_trait]
impl SuperAgentTool for StopDevLoopTool {
    fn name(&self) -> &str {
        "stop_dev_loop"
    }
    fn description(&self) -> &str {
        "Stop a running development loop"
    }
    fn domain(&self) -> ToolDomain {
        ToolDomain::Execution
    }

    fn parameters_schema(&self) -> serde_json::Value {
        json!({
            "type": "object",
            "properties": {
                "automaton_id": { "type": "string", "description": "Automaton ID (returned by start_dev_loop)" }
            },
            "required": ["automaton_id"]
        })
    }

    async fn execute(
        &self,
        input: serde_json::Value,
        ctx: &SuperAgentContext,
    ) -> Result<ToolResult, SuperAgentError> {
        let automaton_id = input["automaton_id"]
            .as_str()
            .ok_or_else(|| SuperAgentError::ToolError("automaton_id is required".into()))?;

        ctx.automaton_client
            .stop(automaton_id)
            .await
            .map_err(|e| tool_err("stop_dev_loop", e))?;

        Ok(ToolResult {
            content: json!({ "status": "stopped", "automaton_id": automaton_id }),
            is_error: false,
        })
    }
}

// ---------------------------------------------------------------------------
// 4. GetLoopStatusTool
// ---------------------------------------------------------------------------

pub struct GetLoopStatusTool;

#[async_trait]
impl SuperAgentTool for GetLoopStatusTool {
    fn name(&self) -> &str {
        "get_loop_status"
    }
    fn description(&self) -> &str {
        "Get the current status of a development loop"
    }
    fn domain(&self) -> ToolDomain {
        ToolDomain::Execution
    }

    fn parameters_schema(&self) -> serde_json::Value {
        json!({
            "type": "object",
            "properties": {
                "automaton_id": { "type": "string", "description": "Automaton ID (returned by start_dev_loop)" }
            },
            "required": ["automaton_id"]
        })
    }

    async fn execute(
        &self,
        input: serde_json::Value,
        ctx: &SuperAgentContext,
    ) -> Result<ToolResult, SuperAgentError> {
        let automaton_id = input["automaton_id"]
            .as_str()
            .ok_or_else(|| SuperAgentError::ToolError("automaton_id is required".into()))?;

        let status = ctx
            .automaton_client
            .status(automaton_id)
            .await
            .map_err(|e| tool_err("get_loop_status", e))?;

        Ok(ToolResult {
            content: status,
            is_error: false,
        })
    }
}

// ---------------------------------------------------------------------------
// 5. SendToAgentTool
// ---------------------------------------------------------------------------

pub struct SendToAgentTool;

#[async_trait]
impl SuperAgentTool for SendToAgentTool {
    fn name(&self) -> &str {
        "send_to_agent"
    }
    fn description(&self) -> &str {
        "Send a message/instruction to a running agent instance"
    }
    fn domain(&self) -> ToolDomain {
        ToolDomain::Execution
    }

    fn parameters_schema(&self) -> serde_json::Value {
        json!({
            "type": "object",
            "properties": {
                "project_id": { "type": "string", "description": "Project ID" },
                "agent_instance_id": { "type": "string", "description": "Agent instance ID" },
                "message": { "type": "string", "description": "Message to send to the agent" }
            },
            "required": ["project_id", "agent_instance_id", "message"]
        })
    }

    async fn execute(
        &self,
        input: serde_json::Value,
        ctx: &SuperAgentContext,
    ) -> Result<ToolResult, SuperAgentError> {
        let project_id = input["project_id"]
            .as_str()
            .ok_or_else(|| SuperAgentError::ToolError("project_id is required".into()))?;
        let agent_instance_id = input["agent_instance_id"]
            .as_str()
            .ok_or_else(|| SuperAgentError::ToolError("agent_instance_id is required".into()))?;
        let message = input["message"]
            .as_str()
            .ok_or_else(|| SuperAgentError::ToolError("message is required".into()))?;

        let network = ctx
            .network_client
            .as_ref()
            .ok_or_else(|| SuperAgentError::Internal("network client not available".into()))?;

        let url = format!(
            "{}/api/projects/{}/agents/{}/events/stream",
            network.base_url(),
            project_id,
            agent_instance_id
        );
        let body = json!({
            "content": message,
            "action": "message"
        });

        let resp = network
            .http_client()
            .post(&url)
            .bearer_auth(&ctx.jwt)
            .json(&body)
            .send()
            .await
            .map_err(|e| tool_err("send_to_agent", e))?;

        let status = resp.status();
        if !status.is_success() {
            let err_body = resp.text().await.unwrap_or_default();
            return Ok(ToolResult {
                content: json!({ "error": err_body, "status": status.as_u16() }),
                is_error: true,
            });
        }

        Ok(ToolResult {
            content: json!({
                "sent": true,
                "project_id": project_id,
                "agent_instance_id": agent_instance_id
            }),
            is_error: false,
        })
    }
}
