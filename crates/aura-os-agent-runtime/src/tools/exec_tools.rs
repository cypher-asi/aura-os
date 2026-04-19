use async_trait::async_trait;
use serde_json::json;

use aura_os_core::ToolDomain;
use aura_os_link::AutomatonStartParams;

use super::{AgentToolContext, AgentTool, ToolResult};
use crate::AgentRuntimeError;

fn tool_err(action: &str, e: impl std::fmt::Display) -> AgentRuntimeError {
    AgentRuntimeError::ToolError(format!("{action}: {e}"))
}

// ---------------------------------------------------------------------------
// 1. StartDevLoopTool
// ---------------------------------------------------------------------------

pub struct StartDevLoopTool;

#[async_trait]
impl AgentTool for StartDevLoopTool {
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
        ctx: &AgentToolContext,
    ) -> Result<ToolResult, AgentRuntimeError> {
        let project_id = input["project_id"]
            .as_str()
            .ok_or_else(|| AgentRuntimeError::ToolError("project_id is required".into()))?;
        let _agent_instance_id = input["agent_instance_id"]
            .as_str()
            .ok_or_else(|| AgentRuntimeError::ToolError("agent_instance_id is required".into()))?;

        let params = AutomatonStartParams {
            project_id: project_id.to_string(),
            auth_token: Some(ctx.jwt.clone()),
            model: None,
            workspace_root: None,
            task_id: None,
            git_repo_url: None,
            git_branch: None,
            installed_tools: None,
            installed_integrations: None,
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
impl AgentTool for PauseDevLoopTool {
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
        ctx: &AgentToolContext,
    ) -> Result<ToolResult, AgentRuntimeError> {
        let automaton_id = input["automaton_id"]
            .as_str()
            .ok_or_else(|| AgentRuntimeError::ToolError("automaton_id is required".into()))?;

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
impl AgentTool for StopDevLoopTool {
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
        ctx: &AgentToolContext,
    ) -> Result<ToolResult, AgentRuntimeError> {
        let automaton_id = input["automaton_id"]
            .as_str()
            .ok_or_else(|| AgentRuntimeError::ToolError("automaton_id is required".into()))?;

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
impl AgentTool for GetLoopStatusTool {
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
        ctx: &AgentToolContext,
    ) -> Result<ToolResult, AgentRuntimeError> {
        let automaton_id = input["automaton_id"]
            .as_str()
            .ok_or_else(|| AgentRuntimeError::ToolError("automaton_id is required".into()))?;

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
impl AgentTool for SendToAgentTool {
    fn name(&self) -> &str {
        "send_to_agent"
    }
    fn description(&self) -> &str {
        "Send a chat message to another agent by agent_id. The message is \
         delivered to the target agent's conversation as a user turn and \
         triggers its next response. Requires the ControlAgent capability. \
         Use `list_agents` to discover the target's agent_id."
    }
    fn domain(&self) -> ToolDomain {
        ToolDomain::Execution
    }

    fn parameters_schema(&self) -> serde_json::Value {
        json!({
            "type": "object",
            "properties": {
                "agent_id": {
                    "type": "string",
                    "description": "Target agent id (org-level agent). Use list_agents to discover."
                },
                "content": {
                    "type": "string",
                    "description": "Message content to deliver to the target agent."
                },
                "attachments": {
                    "description": "Optional structured attachments forwarded with the message."
                }
            },
            "required": ["agent_id", "content"]
        })
    }

    async fn execute(
        &self,
        input: serde_json::Value,
        ctx: &AgentToolContext,
    ) -> Result<ToolResult, AgentRuntimeError> {
        let agent_id = input["agent_id"]
            .as_str()
            .ok_or_else(|| AgentRuntimeError::ToolError("agent_id is required".into()))?;
        let content = input["content"]
            .as_str()
            .ok_or_else(|| AgentRuntimeError::ToolError("content is required".into()))?;
        let attachments = input.get("attachments").cloned();

        let mut body = json!({
            "content": content,
            "action": "message"
        });
        if let Some(att) = attachments {
            if !att.is_null() {
                body["attachments"] = att;
            }
        }

        // The per-agent chat endpoint (`/api/agents/:id/events/stream`)
        // is owned by aura-os-server — it schedules the target agent's
        // next harness turn and streams its response back over SSE.
        // aura-network does NOT expose this route, so posting to
        // `network.base_url()` always returned 404. Route through the
        // local server base URL instead (always populated from
        // AURA_SERVER_BASE_URL / host+port in app_builder); only fall
        // back to the network client as a legacy safety net.
        //
        // The channel send inside `send_agent_event_stream` schedules
        // the turn synchronously before the SSE stream is returned,
        // so dropping the response body after checking the status
        // still delivers the message.
        let path = format!("/api/agents/{agent_id}/events/stream");
        // Pull persistence signals back from `send_agent_event_stream`
        // headers so the caller (and the CEO, via the tool result) can
        // tell whether the message will actually show up in the target
        // agent's chat history — not just whether the harness accepted
        // it. Without this the tool returns 200 even when the target
        // agent has no project binding, and the message silently
        // vanishes from the UI.
        struct SendResponse {
            status: reqwest::StatusCode,
            body: Option<String>,
            persisted: Option<bool>,
            session_id: Option<String>,
            project_id: Option<String>,
        }
        async fn parse_response(
            resp: reqwest::Response,
        ) -> Result<SendResponse, AgentRuntimeError> {
            let status = resp.status();
            let headers = resp.headers().clone();
            let persisted = headers
                .get("x-aura-chat-persisted")
                .and_then(|v| v.to_str().ok())
                .map(|v| v.eq_ignore_ascii_case("true"));
            let session_id = headers
                .get("x-aura-chat-session-id")
                .and_then(|v| v.to_str().ok())
                .map(str::to_owned);
            let project_id = headers
                .get("x-aura-chat-project-id")
                .and_then(|v| v.to_str().ok())
                .map(str::to_owned);
            let body = if status.is_success() {
                None
            } else {
                Some(resp.text().await.unwrap_or_default())
            };
            Ok(SendResponse {
                status,
                body,
                persisted,
                session_id,
                project_id,
            })
        }

        let parsed = if let Some(base) = ctx.local_server_base_url.as_deref() {
            let url = format!("{base}{path}");
            let resp = ctx
                .local_http_client
                .post(&url)
                .bearer_auth(&ctx.jwt)
                .json(&body)
                .send()
                .await
                .map_err(|e| tool_err("send_to_agent", e))?;
            parse_response(resp).await?
        } else {
            let network = ctx.network_client.as_ref().ok_or_else(|| {
                AgentRuntimeError::Internal(
                    "send_to_agent: neither local_server_base_url nor network_client is configured".into(),
                )
            })?;
            let url = format!("{}{path}", network.base_url());
            let resp = network
                .http_client()
                .post(&url)
                .bearer_auth(&ctx.jwt)
                .json(&body)
                .send()
                .await
                .map_err(|e| tool_err("send_to_agent", e))?;
            parse_response(resp).await?
        };

        if !parsed.status.is_success() {
            return Ok(ToolResult {
                content: json!({
                    "error": parsed.body.unwrap_or_default(),
                    "status": parsed.status.as_u16()
                }),
                is_error: true,
            });
        }

        let mut result = json!({
            "sent": true,
            "agent_id": agent_id,
        });
        // `persisted=false` means `send_agent_event_stream` could not
        // bind the target agent to any project in storage. The harness
        // processed the turn but nothing was written to the session
        // event log, so the user will NOT see the message in that
        // agent's chat tab. Surface this explicitly so the CEO stops
        // reporting false success.
        match parsed.persisted {
            Some(true) => {
                result["persisted"] = json!(true);
                if let Some(sid) = parsed.session_id {
                    result["session_id"] = json!(sid);
                }
                if let Some(pid) = parsed.project_id {
                    result["project_id"] = json!(pid);
                }
            }
            Some(false) => {
                result["persisted"] = json!(false);
                result["warning"] = json!(
                    "Message was delivered to the target agent's harness, but it is not \
                     bound to any project in storage, so the turn will NOT appear in that \
                     agent's chat history. Bind the agent to a project (or chat with it at \
                     least once from the UI to create a session) before using send_to_agent."
                );
                return Ok(ToolResult {
                    content: result,
                    is_error: true,
                });
            }
            None => {
                result["persisted"] = json!("unknown");
            }
        }

        Ok(ToolResult {
            content: result,
            is_error: false,
        })
    }
}
