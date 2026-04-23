use std::time::Duration;

use async_trait::async_trait;
use futures_util::StreamExt;
use serde_json::json;

use aura_os_core::{Capability, ToolDomain};
use aura_os_link::AutomatonStartParams;

use super::{AgentTool, AgentToolContext, CapabilityRequirement, ToolResult};
use aura_os_agent_runtime::AgentRuntimeError;

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
    fn required_capabilities(&self) -> &'static [CapabilityRequirement] {
        &[CapabilityRequirement::WriteProjectFromArg("project_id")]
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
            prior_failure: None,
            work_log: Vec::new(),
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
    fn required_capabilities(&self) -> &'static [CapabilityRequirement] {
        // TODO(tier-a): `pause_dev_loop` takes `automaton_id`, not
        // `project_id`, so we can't scope-check a `WriteProject{id}`
        // at dispatch time. Fall back to `ControlAgent` as a proxy;
        // the underlying AutomatonClient still enforces ownership.
        &[CapabilityRequirement::Exact(Capability::ControlAgent)]
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
    fn required_capabilities(&self) -> &'static [CapabilityRequirement] {
        // TODO(tier-a): `stop_dev_loop` takes `automaton_id`, not
        // `project_id`; see `pause_dev_loop` above.
        &[CapabilityRequirement::Exact(Capability::ControlAgent)]
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
    fn required_capabilities(&self) -> &'static [CapabilityRequirement] {
        // TODO(tier-a): `get_loop_status` takes `automaton_id`; no
        // project-scoped `ReadProject` check is possible. Falls back
        // to `ReadAgent`.
        &[CapabilityRequirement::Exact(Capability::ReadAgent)]
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

/// Parsed metadata from the target agent's SSE response. Populated from
/// both the initial HTTP response headers (`x-aura-chat-*`) and by
/// draining the `text_delta` / `assistant_message_end` events on the
/// body stream.
struct SendResponse {
    status: reqwest::StatusCode,
    body: String,
    session_id: Option<String>,
    project_id: Option<String>,
    /// Accumulated `text_delta` payloads from the target agent's
    /// turn. Empty when the stream timed out before the first delta
    /// or when the server returned a non-2xx.
    reply_text: String,
    /// True iff we observed an `assistant_message_end` SSE event —
    /// i.e. the target fully finished its turn within our budget.
    reply_complete: bool,
    /// True iff the drain hit `DRAIN_MAX_WAIT`. The CEO will still
    /// get whatever partial text we collected, just flagged so the
    /// LLM can explain that the reply may be clipped.
    reply_timed_out: bool,
    /// True iff the drain hit `DRAIN_MAX_BYTES` or `DRAIN_MAX_REPLY_CHARS`
    /// and we stopped reading early.
    reply_truncated: bool,
}

/// Total wall-clock budget for draining the target's SSE response.
///
/// Most inter-agent exchanges are short (a couple of sentences), so
/// 60s is generous; large multi-tool-call turns will hit this and
/// we'll surface a `reply_timed_out: true` flag instead of stalling
/// the calling agent forever. The harness's own turn timeout is in
/// the same ballpark, so we can't do much better without plumbing.
const DRAIN_MAX_WAIT: Duration = Duration::from_secs(60);
/// Hard cap on raw bytes pulled off the SSE socket. Exists to defend
/// against a runaway target filling the CEO's tool_result with
/// arbitrary data (every tool_result rides in the harness conversation
/// history for the rest of the session — that's exactly the mechanism
/// that caused the 100% context utilisation bug with `list_agents`).
const DRAIN_MAX_BYTES: usize = 256 * 1024;
/// Hard cap on the `reply_text` string we return to the LLM. Keeps
/// even the worst-case tool_result comfortably under the 8 KiB
/// warn-threshold in `dispatch_agent_tool`.
const DRAIN_MAX_REPLY_CHARS: usize = 32 * 1024;

/// Map a transport-level reqwest failure from the initial
/// `send_to_agent` POST into a `ToolError` that names the URL we
/// were trying to reach **and** which env var most likely caused it,
/// instead of the generic `action: err` format used by other tools.
///
/// In production the symptom is "operation timed out" on
/// `127.0.0.1:19847` (the desktop's preferred control-plane port)
/// while the embedded server actually bound an ephemeral port, or
/// while nothing is listening at all. With the short connect timeout
/// now configured in `aura-os-agent-runtime::build_local_http_client`
/// we get here in ~3s with `is_connect() || is_timeout()` true —
/// surface every piece of context we have so the operator can
/// correlate the tool error directly with a stale env override
/// without grepping logs.
fn send_to_agent_transport_err(
    full_url: &str,
    resolved_base_url: &str,
    err: reqwest::Error,
) -> AgentRuntimeError {
    if err.is_connect() || err.is_timeout() {
        let server_base_url = std::env::var("AURA_SERVER_BASE_URL")
            .ok()
            .unwrap_or_else(|| "<unset>".to_string());
        let vite_api_url = std::env::var("VITE_API_URL")
            .ok()
            .unwrap_or_else(|| "<unset>".to_string());
        let server_host = std::env::var("AURA_SERVER_HOST")
            .ok()
            .unwrap_or_else(|| "<unset>".to_string());
        let server_port = std::env::var("AURA_SERVER_PORT")
            .ok()
            .unwrap_or_else(|| "<unset>".to_string());
        AgentRuntimeError::ToolError(format!(
            "send_to_agent: transport failure contacting {full_url} \
             (base={resolved_base_url}); \
             AURA_SERVER_BASE_URL={server_base_url}, \
             VITE_API_URL={vite_api_url}, \
             AURA_SERVER_HOST={server_host}, \
             AURA_SERVER_PORT={server_port}; \
             underlying error: {err}"
        ))
    } else {
        tool_err("send_to_agent", err)
    }
}

async fn parse_response(resp: reqwest::Response) -> Result<SendResponse, AgentRuntimeError> {
    let status = resp.status();
    let headers = resp.headers().clone();
    let session_id = headers
        .get("x-aura-chat-session-id")
        .and_then(|v| v.to_str().ok())
        .map(str::to_owned);
    let project_id = headers
        .get("x-aura-chat-project-id")
        .and_then(|v| v.to_str().ok())
        .map(str::to_owned);

    if !status.is_success() {
        // Error path: body is a structured `ApiError` JSON — read it
        // whole, no streaming needed.
        let body = resp.text().await.unwrap_or_default();
        return Ok(SendResponse {
            status,
            body,
            session_id,
            project_id,
            reply_text: String::new(),
            reply_complete: false,
            reply_timed_out: false,
            reply_truncated: false,
        });
    }

    let (reply_text, reply_complete, reply_timed_out, reply_truncated) =
        drain_sse_reply(resp).await;

    Ok(SendResponse {
        status,
        body: String::new(),
        session_id,
        project_id,
        reply_text,
        reply_complete,
        reply_timed_out,
        reply_truncated,
    })
}

/// Drain the SSE body until we see `assistant_message_end`, the stream
/// closes, or one of the budgets is exhausted.
///
/// Returns `(reply_text, complete, timed_out, truncated)`. `text_delta`
/// events are concatenated into `reply_text`; every other event type
/// (`tool_use_start`, `tool_call_snapshot`, `tool_result`, ...) is
/// ignored on purpose — those belong in the target agent's own
/// session history, not in the calling agent's tool_result.
async fn drain_sse_reply(resp: reqwest::Response) -> (String, bool, bool, bool) {
    let mut text = String::new();
    let mut total_bytes: usize = 0;
    let mut reply_complete = false;
    let mut reply_timed_out = false;
    let mut reply_truncated = false;

    let deadline = tokio::time::Instant::now() + DRAIN_MAX_WAIT;
    let mut stream = resp.bytes_stream();
    let mut buf: Vec<u8> = Vec::new();
    let mut current_event: Option<String> = None;

    'outer: loop {
        let remaining = deadline.saturating_duration_since(tokio::time::Instant::now());
        if remaining.is_zero() {
            reply_timed_out = true;
            break;
        }

        let next = match tokio::time::timeout(remaining, stream.next()).await {
            Ok(Some(Ok(chunk))) => chunk,
            Ok(Some(Err(_))) => break,
            Ok(None) => break,
            Err(_) => {
                reply_timed_out = true;
                break;
            }
        };

        total_bytes = total_bytes.saturating_add(next.len());
        if total_bytes > DRAIN_MAX_BYTES {
            reply_truncated = true;
            break;
        }
        buf.extend_from_slice(&next);

        while let Some(pos) = buf.iter().position(|&b| b == b'\n') {
            let raw: Vec<u8> = buf.drain(..=pos).collect();
            let mut line = std::str::from_utf8(&raw)
                .unwrap_or("")
                .trim_end_matches('\n')
                .trim_end_matches('\r')
                .to_string();
            // Empty line terminates an SSE event.
            if line.is_empty() {
                current_event = None;
                continue;
            }
            if let Some(rest) = line.strip_prefix("event:") {
                current_event = Some(rest.trim().to_string());
                continue;
            }
            if let Some(rest) = line.strip_prefix("data:") {
                line = rest.trim().to_string();
                let event_type = current_event.as_deref().unwrap_or("");
                match event_type {
                    "text_delta" => {
                        if let Ok(v) = serde_json::from_str::<serde_json::Value>(&line) {
                            if let Some(t) = v.get("text").and_then(|x| x.as_str()) {
                                let budget = DRAIN_MAX_REPLY_CHARS.saturating_sub(text.len());
                                if budget == 0 {
                                    reply_truncated = true;
                                    break 'outer;
                                }
                                if t.len() <= budget {
                                    text.push_str(t);
                                } else {
                                    // Find the largest char boundary <= budget so we
                                    // don't split a multi-byte codepoint in half.
                                    let mut cut = budget;
                                    while cut > 0 && !t.is_char_boundary(cut) {
                                        cut -= 1;
                                    }
                                    text.push_str(&t[..cut]);
                                    reply_truncated = true;
                                    break 'outer;
                                }
                            }
                        }
                    }
                    "assistant_message_end" => {
                        reply_complete = true;
                        break 'outer;
                    }
                    _ => {
                        // Ignore tool_use_*, progress, error, etc. —
                        // those are the target agent's private
                        // machinery and shouldn't leak into the
                        // caller's tool_result.
                    }
                }
            }
        }
    }

    (text, reply_complete, reply_timed_out, reply_truncated)
}

pub struct SendToAgentTool;

#[async_trait]
impl AgentTool for SendToAgentTool {
    fn name(&self) -> &str {
        "send_to_agent"
    }
    fn required_capabilities(&self) -> &'static [CapabilityRequirement] {
        &[CapabilityRequirement::Exact(Capability::ControlAgent)]
    }
    fn description(&self) -> &str {
        "Send a chat message to another agent by agent_id and wait for \
         their reply (up to ~60s). The message is delivered to the target \
         agent's conversation as a user turn and the target's response text \
         is returned as `reply`. Fields `reply_complete`, `reply_timed_out`, \
         and `reply_truncated` indicate whether the drain hit a budget — \
         when any are true, `reply` may be partial. Requires the \
         ControlAgent capability. Use `list_agents` to discover the target's \
         agent_id."
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
        // AURA_SERVER_BASE_URL / VITE_API_URL / host+port in
        // app_builder); only fall back to the network client as a
        // legacy safety net.
        //
        // The server awaits the storage `create_event` call for the user
        // turn before opening SSE, so a 2xx here means the message is
        // already saved in the target agent's chat history (see
        // `open_harness_chat_stream` and the `chat_persist_failed` /
        // `chat_persist_unavailable` error contract in `error.rs`).
        //
        // After the 2xx we drain the SSE body to harvest the target's
        // reply — without that the calling LLM (the CEO) only sees
        // "sent" and has nothing to reason about, which is why asking
        // Barret a question used to return silence.
        let path = format!("/api/agents/{agent_id}/events/stream");

        let parsed = if let Some(base) = ctx.local_server_base_url.as_deref() {
            let url = format!("{base}{path}");
            let resp = ctx
                .local_http_client
                .post(&url)
                .bearer_auth(&ctx.jwt)
                .json(&body)
                .send()
                .await
                .map_err(|e| send_to_agent_transport_err(&url, base, e))?;
            parse_response(resp).await?
        } else {
            let network = ctx.network_client.as_ref().ok_or_else(|| {
                AgentRuntimeError::Internal(
                    "send_to_agent: neither local_server_base_url nor network_client is configured"
                        .into(),
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
            // Parse the structured ApiError JSON body produced by the
            // server. We care specifically about the `chat_persist_*`
            // codes (see `ApiError::chat_persist_failed` /
            // `chat_persist_unavailable`), but any non-2xx maps to a
            // hard tool failure — no more "sent but vanished" soft path.
            let status_u16 = parsed.status.as_u16();
            let fallback_content = json!({
                "sent": false,
                "agent_id": agent_id,
                "code": "chat_persist_failed",
                "reason": parsed.body.clone(),
                "upstream_status": status_u16,
                "session_id": parsed.session_id,
                "project_id": parsed.project_id,
            });

            let content = match serde_json::from_str::<serde_json::Value>(&parsed.body) {
                Ok(err_json) => {
                    // Prefer the structured `data` payload the server
                    // attaches to `chat_persist_*` errors. Fall back to
                    // the top-level `code` / `error` / `details` fields
                    // for legacy non-structured errors.
                    let data = err_json.get("data");
                    let code = data
                        .and_then(|d| d.get("code"))
                        .and_then(|v| v.as_str())
                        .or_else(|| err_json.get("code").and_then(|v| v.as_str()))
                        .unwrap_or("chat_persist_failed")
                        .to_string();
                    let reason = data
                        .and_then(|d| d.get("reason"))
                        .and_then(|v| v.as_str())
                        .or_else(|| err_json.get("details").and_then(|v| v.as_str()))
                        .or_else(|| err_json.get("error").and_then(|v| v.as_str()))
                        .unwrap_or_else(|| parsed.body.as_str())
                        .to_string();
                    let upstream_status = data
                        .and_then(|d| d.get("upstream_status"))
                        .and_then(|v| v.as_u64())
                        .map(|v| v as u16);
                    let session_id = data
                        .and_then(|d| d.get("session_id"))
                        .and_then(|v| v.as_str())
                        .map(str::to_owned)
                        .or(parsed.session_id.clone());
                    let project_id = data
                        .and_then(|d| d.get("project_id"))
                        .and_then(|v| v.as_str())
                        .map(str::to_owned)
                        .or(parsed.project_id.clone());
                    let project_agent_id = data
                        .and_then(|d| d.get("project_agent_id"))
                        .and_then(|v| v.as_str())
                        .map(str::to_owned);
                    json!({
                        "sent": false,
                        "agent_id": agent_id,
                        "code": code,
                        "reason": reason,
                        "upstream_status": upstream_status.map(|s| s as u64).unwrap_or(status_u16 as u64),
                        "session_id": session_id,
                        "project_id": project_id,
                        "project_agent_id": project_agent_id,
                    })
                }
                Err(_) => fallback_content,
            };

            return Ok(ToolResult {
                content,
                is_error: true,
            });
        }

        // Success path: include the target's reply text so the
        // calling LLM can actually reason about it ("Barret said
        // X, therefore ..."). The `reply_*` flags let the LLM
        // narrate gracefully when the drain hit a budget — e.g.
        // "Barret didn't finish within 60s; here's the partial
        // response so far".
        let reply = parsed.reply_text;
        Ok(ToolResult {
            content: json!({
                "sent": true,
                "persisted": true,
                "agent_id": agent_id,
                "session_id": parsed.session_id,
                "project_id": parsed.project_id,
                "reply": reply,
                "reply_complete": parsed.reply_complete,
                "reply_timed_out": parsed.reply_timed_out,
                "reply_truncated": parsed.reply_truncated,
            }),
            is_error: false,
        })
    }
}

// ---------------------------------------------------------------------------
// Tests for SendToAgentTool
// ---------------------------------------------------------------------------

#[cfg(test)]
mod send_to_agent_tests {
    use super::*;
    use std::sync::Arc;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::TcpListener;
    use tokio::sync::broadcast;

    use aura_os_agents::{AgentInstanceService, AgentService, RuntimeAgentStateMap};
    use aura_os_billing::BillingClient;
    use aura_os_link::AutomatonClient;
    use aura_os_orgs::OrgService;
    use aura_os_projects::ProjectService;
    use aura_os_sessions::SessionService;
    use aura_os_store::SettingsStore;
    use aura_os_tasks::TaskService;

    /// A single-shot HTTP mock: binds to 127.0.0.1:0, accepts one connection,
    /// parses the request headers enough to consume the body (via
    /// Content-Length), then writes the provided response bytes.
    ///
    /// Returns (base_url, join_handle). Awaiting the join handle yields the
    /// raw request bytes received — useful for request-shape assertions.
    async fn spawn_mock_server(
        response_status: u16,
        response_body: &'static str,
        response_headers: Vec<(&'static str, &'static str)>,
    ) -> (String, tokio::task::JoinHandle<Vec<u8>>) {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let base_url = format!("http://{}", addr);

        let handle = tokio::spawn(async move {
            let (mut sock, _) = listener.accept().await.unwrap();
            let mut buf = Vec::with_capacity(4096);
            let mut tmp = [0u8; 1024];

            // Read until we have full headers, then drain Content-Length bytes.
            let (header_end, content_length) = loop {
                let n = sock.read(&mut tmp).await.unwrap();
                if n == 0 {
                    break (buf.len(), 0usize);
                }
                buf.extend_from_slice(&tmp[..n]);
                if let Some(pos) = find_header_end(&buf) {
                    let cl = parse_content_length(&buf[..pos]);
                    break (pos + 4, cl);
                }
            };

            let need = header_end + content_length;
            while buf.len() < need {
                let n = sock.read(&mut tmp).await.unwrap();
                if n == 0 {
                    break;
                }
                buf.extend_from_slice(&tmp[..n]);
            }

            let status_line = match response_status {
                200 => "HTTP/1.1 200 OK",
                424 => "HTTP/1.1 424 Failed Dependency",
                502 => "HTTP/1.1 502 Bad Gateway",
                503 => "HTTP/1.1 503 Service Unavailable",
                500 => "HTTP/1.1 500 Internal Server Error",
                _ => "HTTP/1.1 500 Internal Server Error",
            };

            let mut resp = format!("{status_line}\r\n");
            resp.push_str("Content-Type: application/json\r\n");
            resp.push_str(&format!("Content-Length: {}\r\n", response_body.len()));
            for (k, v) in &response_headers {
                resp.push_str(&format!("{k}: {v}\r\n"));
            }
            resp.push_str("Connection: close\r\n\r\n");

            sock.write_all(resp.as_bytes()).await.unwrap();
            sock.write_all(response_body.as_bytes()).await.unwrap();
            sock.shutdown().await.ok();

            buf
        });

        (base_url, handle)
    }

    fn find_header_end(buf: &[u8]) -> Option<usize> {
        buf.windows(4).position(|w| w == b"\r\n\r\n")
    }

    fn parse_content_length(headers: &[u8]) -> usize {
        let text = match std::str::from_utf8(headers) {
            Ok(t) => t,
            Err(_) => return 0,
        };
        for line in text.split("\r\n") {
            if let Some((k, v)) = line.split_once(':') {
                if k.trim().eq_ignore_ascii_case("content-length") {
                    return v.trim().parse().unwrap_or(0);
                }
            }
        }
        0
    }

    fn temp_store() -> (tempfile::TempDir, Arc<SettingsStore>) {
        let dir = tempfile::tempdir().unwrap();
        let store = Arc::new(SettingsStore::open(dir.path()).unwrap());
        (dir, store)
    }

    fn build_ctx_with_base(base_url: String, store: Arc<SettingsStore>) -> AgentToolContext {
        let runtime_state: RuntimeAgentStateMap =
            Arc::new(tokio::sync::Mutex::new(std::collections::HashMap::new()));
        let (tx, _) = broadcast::channel(16);
        AgentToolContext {
            user_id: "test-user".into(),
            org_id: "test-org".into(),
            jwt: "test-jwt".into(),
            project_service: Arc::new(ProjectService::new(store.clone())),
            agent_service: Arc::new(AgentService::new(store.clone(), None)),
            agent_instance_service: Arc::new(AgentInstanceService::new(
                store.clone(),
                None,
                runtime_state,
                None,
            )),
            task_service: Arc::new(TaskService::new(store.clone(), None)),
            session_service: Arc::new(SessionService::new(store.clone(), 0.8, 200_000)),
            org_service: Arc::new(OrgService::new(store.clone())),
            billing_client: Arc::new(BillingClient::new()),
            automaton_client: Arc::new(AutomatonClient::new("http://localhost:0".into())),
            orbit_client: None,
            network_client: None,
            storage_client: None,
            store: store.clone(),
            event_broadcast: tx,
            local_server_base_url: Some(base_url),
            local_http_client: reqwest::Client::new(),
        }
    }

    #[tokio::test]
    async fn send_to_agent_success_returns_persisted_with_headers() {
        let (base_url, _handle) = spawn_mock_server(
            200,
            "",
            vec![
                ("x-aura-chat-session-id", "sess-123"),
                ("x-aura-chat-project-id", "proj-456"),
            ],
        )
        .await;

        let (_dir, store) = temp_store();
        let ctx = build_ctx_with_base(base_url, store);

        let tool = SendToAgentTool;
        let result = tool
            .execute(
                json!({ "agent_id": "agent-xyz", "content": "hello target" }),
                &ctx,
            )
            .await
            .expect("tool should complete");

        assert!(!result.is_error, "2xx should not set is_error");
        assert_eq!(result.content["sent"], json!(true));
        assert_eq!(result.content["persisted"], json!(true));
        assert_eq!(result.content["agent_id"], json!("agent-xyz"));
        assert_eq!(result.content["session_id"], json!("sess-123"));
        assert_eq!(result.content["project_id"], json!("proj-456"));
        // Empty-body mock closes immediately; drain returns an empty
        // reply with no completion marker. The tool still succeeds —
        // the calling LLM sees `reply: ""` and can narrate accordingly.
        assert_eq!(result.content["reply"], json!(""));
        assert_eq!(result.content["reply_complete"], json!(false));
        assert_eq!(result.content["reply_timed_out"], json!(false));
        assert_eq!(result.content["reply_truncated"], json!(false));
    }

    #[tokio::test]
    async fn send_to_agent_persist_failed_500_with_structured_body() {
        let body = r#"{
            "code": "chat_persist_failed",
            "error": "Failed to persist chat message",
            "data": {
                "code": "chat_persist_failed",
                "reason": "storage upstream 503 — connection refused",
                "upstream_status": 503,
                "session_id": "sess-abc",
                "project_id": "proj-def",
                "project_agent_id": "pa-ghi"
            }
        }"#;
        let (base_url, _handle) = spawn_mock_server(502, body, vec![]).await;

        let (_dir, store) = temp_store();
        let ctx = build_ctx_with_base(base_url, store);

        let tool = SendToAgentTool;
        let result = tool
            .execute(json!({ "agent_id": "agent-xyz", "content": "hi" }), &ctx)
            .await
            .expect("tool should return Ok even on server 5xx");

        assert!(result.is_error, "non-2xx must set is_error=true");
        assert_eq!(result.content["sent"], json!(false));
        assert_eq!(result.content["code"], json!("chat_persist_failed"));
        assert_eq!(
            result.content["reason"],
            json!("storage upstream 503 — connection refused")
        );
        assert_eq!(result.content["upstream_status"], json!(503));
        assert_eq!(result.content["session_id"], json!("sess-abc"));
        assert_eq!(result.content["project_id"], json!("proj-def"));
        assert_eq!(result.content["project_agent_id"], json!("pa-ghi"));
        assert_eq!(result.content["agent_id"], json!("agent-xyz"));
        // Nothing in the contract says `persisted: true` should leak through
        // on failure -- we explicitly dropped that soft-failure branch.
        assert!(result.content.get("persisted").is_none());
    }

    #[tokio::test]
    async fn send_to_agent_persist_unavailable_424_is_hard_failure() {
        let body = r#"{
            "code": "chat_persist_unavailable",
            "error": "Chat persistence is not configured for this agent",
            "data": {
                "code": "chat_persist_unavailable",
                "reason": "no project agent binding for agent",
                "upstream_status": null,
                "session_id": null,
                "project_id": null,
                "project_agent_id": null
            }
        }"#;
        let (base_url, _handle) = spawn_mock_server(424, body, vec![]).await;

        let (_dir, store) = temp_store();
        let ctx = build_ctx_with_base(base_url, store);

        let tool = SendToAgentTool;
        let result = tool
            .execute(json!({ "agent_id": "agent-xyz", "content": "hi" }), &ctx)
            .await
            .expect("tool should return Ok");

        assert!(result.is_error, "424 must be a hard tool failure");
        assert_eq!(result.content["sent"], json!(false));
        assert_eq!(result.content["code"], json!("chat_persist_unavailable"));
        assert_eq!(
            result.content["reason"],
            json!("no project agent binding for agent")
        );
    }

    /// Spawn a mock that writes an SSE-style body (`event:`/`data:`
    /// frames) under a plain 200. Chunked transfer isn't needed — we
    /// rely on `Content-Length` closing the stream cleanly, which
    /// exercises the drain's stream-closed branch as a proxy for the
    /// real `assistant_message_end` hit.
    async fn spawn_sse_mock(body: &'static str) -> String {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let base_url = format!("http://{}", addr);

        tokio::spawn(async move {
            let (mut sock, _) = listener.accept().await.unwrap();
            let mut buf = Vec::with_capacity(4096);
            let mut tmp = [0u8; 1024];
            let (header_end, content_length) = loop {
                let n = sock.read(&mut tmp).await.unwrap();
                if n == 0 {
                    break (buf.len(), 0usize);
                }
                buf.extend_from_slice(&tmp[..n]);
                if let Some(pos) = find_header_end(&buf) {
                    let cl = parse_content_length(&buf[..pos]);
                    break (pos + 4, cl);
                }
            };
            let need = header_end + content_length;
            while buf.len() < need {
                let n = sock.read(&mut tmp).await.unwrap();
                if n == 0 {
                    break;
                }
                buf.extend_from_slice(&tmp[..n]);
            }
            let mut resp = String::from("HTTP/1.1 200 OK\r\n");
            resp.push_str("Content-Type: text/event-stream\r\n");
            resp.push_str(&format!("Content-Length: {}\r\n", body.len()));
            resp.push_str("x-aura-chat-session-id: sess-drain\r\n");
            resp.push_str("x-aura-chat-project-id: proj-drain\r\n");
            resp.push_str("Connection: close\r\n\r\n");
            sock.write_all(resp.as_bytes()).await.unwrap();
            sock.write_all(body.as_bytes()).await.unwrap();
            sock.shutdown().await.ok();
        });

        base_url
    }

    #[tokio::test]
    async fn send_to_agent_drains_reply_text_from_sse() {
        // Two text_delta frames plus an assistant_message_end terminator.
        // The drain should concatenate the deltas, flag `reply_complete`
        // true, and leave the truncation/timeout flags false.
        let body = "event: text_delta\r\n\
                    data: {\"text\":\"Hello \"}\r\n\
                    \r\n\
                    event: text_delta\r\n\
                    data: {\"text\":\"world\"}\r\n\
                    \r\n\
                    event: assistant_message_end\r\n\
                    data: {\"message_id\":\"m-1\",\"stop_reason\":\"end_turn\"}\r\n\
                    \r\n";
        let base_url = spawn_sse_mock(body).await;

        let (_dir, store) = temp_store();
        let ctx = build_ctx_with_base(base_url, store);

        let tool = SendToAgentTool;
        let result = tool
            .execute(
                json!({ "agent_id": "agent-xyz", "content": "say hi" }),
                &ctx,
            )
            .await
            .expect("tool should complete");

        assert!(!result.is_error);
        assert_eq!(result.content["sent"], json!(true));
        assert_eq!(result.content["reply"], json!("Hello world"));
        assert_eq!(result.content["reply_complete"], json!(true));
        assert_eq!(result.content["reply_timed_out"], json!(false));
        assert_eq!(result.content["reply_truncated"], json!(false));
        assert_eq!(result.content["session_id"], json!("sess-drain"));
        assert_eq!(result.content["project_id"], json!("proj-drain"));
    }

    #[tokio::test]
    async fn send_to_agent_ignores_non_text_events() {
        // The drain must only collect `text_delta`. Tool-use events
        // belong in the target agent's own session history, not in
        // the caller's tool_result — letting them through would
        // re-introduce the multi-KB context-bloat class of bugs.
        let body = "event: tool_use_start\r\n\
                    data: {\"id\":\"tu-1\",\"name\":\"list_specs\"}\r\n\
                    \r\n\
                    event: text_delta\r\n\
                    data: {\"text\":\"ok\"}\r\n\
                    \r\n\
                    event: tool_result\r\n\
                    data: {\"name\":\"list_specs\",\"result\":\"[...]\",\"is_error\":false}\r\n\
                    \r\n\
                    event: assistant_message_end\r\n\
                    data: {\"message_id\":\"m-2\",\"stop_reason\":\"end_turn\"}\r\n\
                    \r\n";
        let base_url = spawn_sse_mock(body).await;

        let (_dir, store) = temp_store();
        let ctx = build_ctx_with_base(base_url, store);

        let tool = SendToAgentTool;
        let result = tool
            .execute(json!({ "agent_id": "agent-xyz", "content": "hi" }), &ctx)
            .await
            .expect("tool should complete");

        assert_eq!(result.content["reply"], json!("ok"));
        assert_eq!(result.content["reply_complete"], json!(true));
    }

    #[tokio::test]
    async fn send_to_agent_non_json_error_body_falls_back_to_generic() {
        let (base_url, _handle) =
            spawn_mock_server(500, "internal server error (plain text)", vec![]).await;

        let (_dir, store) = temp_store();
        let ctx = build_ctx_with_base(base_url, store);

        let tool = SendToAgentTool;
        let result = tool
            .execute(json!({ "agent_id": "agent-xyz", "content": "hi" }), &ctx)
            .await
            .expect("tool should return Ok");

        assert!(result.is_error, "500 must be a hard tool failure");
        assert_eq!(result.content["sent"], json!(false));
        // Falls back to chat_persist_failed with the raw body as reason.
        assert_eq!(result.content["code"], json!("chat_persist_failed"));
        assert_eq!(result.content["upstream_status"], json!(500));
        assert_eq!(
            result.content["reason"],
            json!("internal server error (plain text)")
        );
    }
}
