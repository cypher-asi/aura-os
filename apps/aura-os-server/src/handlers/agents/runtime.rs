use std::collections::HashMap;
use std::convert::Infallible;
use std::process::Stdio;
use std::time::Duration;

use axum::extract::{Path, State};
use axum::http::HeaderValue;
use axum::response::sse::{Event, KeepAlive, Sse};
use axum::Json;
use serde_json::Value;
use tokio::io::AsyncWriteExt;
use tokio::process::Command;
use tokio::time::timeout;
use tracing::warn;
use uuid::Uuid;

use aura_os_core::{Agent, AgentId, OrgIntegration, ProjectId};
use aura_os_link::{
    AssistantMessageEnd, AssistantMessageStart, FilesChanged, HarnessInbound, HarnessOutbound,
    SessionConfig, SessionProviderConfig, SessionReady, SessionUsage, TextDelta, ToolInfo,
    UserMessage,
};

use crate::dto::{AgentRuntimeTestResponse, SendChatRequest};
use crate::error::{ApiError, ApiResult};
use crate::handlers::agents::chat::{setup_agent_chat_persistence, SseResponse, SseStream};
use crate::handlers::projects_helpers::resolve_project_workspace_path_for_machine;
use crate::handlers::sse::harness_event_to_sse;
use crate::state::{AppState, AuthJwt};

#[derive(Clone)]
pub(crate) struct ResolvedIntegration {
    pub(crate) metadata: OrgIntegration,
    pub(crate) secret: Option<String>,
}

struct RuntimeOutcome {
    text: String,
    usage: SessionUsage,
}

pub(crate) async fn test_agent_runtime(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    Path(agent_id): Path<AgentId>,
) -> ApiResult<Json<AgentRuntimeTestResponse>> {
    let agent = state
        .agent_service
        .get_agent_async("", &agent_id)
        .await
        .or_else(|_| state.agent_service.get_agent_local(&agent_id))
        .map_err(|e| ApiError::not_found(format!("agent not found: {e}")))?;

    let integration = resolve_integration(&state, &agent)?;
    let model = effective_model(&agent, integration.as_ref(), None);

    let outcome = if agent.adapter_type == "aura_harness" {
        run_harness_test(&state, &agent, &jwt, model.clone(), integration.as_ref()).await?
    } else {
        let prompt = "Reply with exactly `hello from aura` and stop.";
        run_external_adapter_prompt(
            &state,
            &agent,
            integration.as_ref(),
            prompt,
            model.clone(),
            None,
        )
        .await?
    };

    Ok(Json(AgentRuntimeTestResponse {
        ok: true,
        adapter_type: agent.adapter_type.clone(),
        environment: agent.environment.clone(),
        auth_source: agent.auth_source.clone(),
        provider: non_empty_string(&outcome.usage.provider),
        model: non_empty_string(&outcome.usage.model),
        integration_id: integration
            .as_ref()
            .map(|resolved| resolved.metadata.integration_id.clone()),
        integration_name: integration
            .as_ref()
            .map(|resolved| resolved.metadata.name.clone()),
        message: outcome.text.trim().to_string(),
    }))
}

pub(crate) async fn send_external_agent_event_stream(
    state: &AppState,
    jwt: &str,
    agent: &Agent,
    body: SendChatRequest,
) -> ApiResult<SseResponse> {
    let integration = resolve_integration(state, agent)?;
    let model = effective_model(agent, integration.as_ref(), body.model.clone());
    let persist_ctx = setup_agent_chat_persistence(state, &agent.agent_id, &agent.name, jwt).await;
    if let Some(ref ctx) = persist_ctx {
        super::chat::persist_user_message(ctx, &body.content);
    }

    let outcome = run_external_adapter_prompt(
        state,
        agent,
        integration.as_ref(),
        &build_external_prompt(state, agent, &body.content, body.project_id.as_deref()),
        model,
        body.project_id.clone(),
    )
    .await?;

    if let Some(ref ctx) = persist_ctx {
        super::chat::persist_external_agent_turn(ctx, &outcome.text, &outcome.usage);
    } else {
        warn!(agent_id = %agent.agent_id, "external agent chat: persistence context unavailable");
    }

    let events = vec![
        HarnessOutbound::SessionReady(SessionReady {
            session_id: Uuid::new_v4().to_string(),
            tools: Vec::<ToolInfo>::new(),
            skills: Vec::new(),
        }),
        HarnessOutbound::AssistantMessageStart(AssistantMessageStart {
            message_id: Uuid::new_v4().to_string(),
        }),
        HarnessOutbound::TextDelta(TextDelta {
            text: outcome.text.clone(),
        }),
        HarnessOutbound::AssistantMessageEnd(AssistantMessageEnd {
            message_id: Uuid::new_v4().to_string(),
            stop_reason: "end_turn".to_string(),
            usage: outcome.usage,
            files_changed: FilesChanged::default(),
        }),
    ];

    let stream = futures_util::stream::iter(
        events
            .into_iter()
            .map(|evt| harness_event_to_sse(&evt))
            .collect::<Vec<Result<Event, Infallible>>>(),
    );
    let boxed: SseStream = Box::pin(stream);
    Ok((
        [("x-accel-buffering", HeaderValue::from_static("no"))],
        Sse::new(boxed).keep_alive(KeepAlive::default()),
    ))
}

pub(crate) fn effective_model(
    agent: &Agent,
    integration: Option<&ResolvedIntegration>,
    override_model: Option<String>,
) -> Option<String> {
    override_model
        .filter(|value| !value.trim().is_empty())
        .or_else(|| {
            agent
                .default_model
                .clone()
                .filter(|value| !value.trim().is_empty())
        })
        .or_else(|| {
            integration
                .and_then(|resolved| resolved.metadata.default_model.clone())
                .filter(|value| !value.trim().is_empty())
        })
}

fn non_empty_string(value: &str) -> Option<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

pub(crate) fn resolve_integration(
    state: &AppState,
    agent: &Agent,
) -> Result<Option<ResolvedIntegration>, (axum::http::StatusCode, Json<ApiError>)> {
    if agent.auth_source != "org_integration" {
        return Ok(None);
    }

    let Some(integration_id) = agent.integration_id.as_deref() else {
        return Ok(None);
    };

    let org_id = agent.org_id.ok_or_else(|| {
        ApiError::bad_request("Agent must belong to an organization before using integrations")
    })?;
    let metadata = state
        .org_service
        .get_integration(&org_id, integration_id)
        .map_err(|e| ApiError::internal(format!("loading integration: {e}")))?
        .ok_or_else(|| ApiError::not_found("Selected integration was not found"))?;
    let secret = state
        .org_service
        .get_integration_secret(integration_id)
        .map_err(|e| ApiError::internal(format!("loading integration secret: {e}")))?;

    Ok(Some(ResolvedIntegration { metadata, secret }))
}

pub(crate) fn resolve_integration_ref(
    state: &AppState,
    org_id: Option<aura_os_core::OrgId>,
    auth_source: &str,
    integration_id: Option<&str>,
) -> Result<Option<ResolvedIntegration>, (axum::http::StatusCode, Json<ApiError>)> {
    if auth_source != "org_integration" {
        return Ok(None);
    }

    let Some(integration_id) = integration_id else {
        return Ok(None);
    };

    let org_id = org_id.ok_or_else(|| {
        ApiError::bad_request("Agent must belong to an organization before using integrations")
    })?;
    let metadata = state
        .org_service
        .get_integration(&org_id, integration_id)
        .map_err(|e| ApiError::internal(format!("loading integration: {e}")))?
        .ok_or_else(|| ApiError::not_found("Selected integration was not found"))?;
    let secret = state
        .org_service
        .get_integration_secret(integration_id)
        .map_err(|e| ApiError::internal(format!("loading integration secret: {e}")))?;

    Ok(Some(ResolvedIntegration { metadata, secret }))
}

pub(crate) fn build_harness_provider_config(
    integration: Option<&ResolvedIntegration>,
    model: Option<&str>,
) -> ApiResult<Option<SessionProviderConfig>> {
    let Some(integration) = integration else {
        return Ok(None);
    };

    match integration.metadata.provider.as_str() {
        "anthropic" => Ok(Some(SessionProviderConfig {
            provider: "anthropic".to_string(),
            routing_mode: Some("direct".to_string()),
            api_key: integration.secret.clone(),
            base_url: None,
            default_model: model
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(str::to_string)
                .or_else(|| integration.metadata.default_model.clone()),
            fallback_model: None,
            prompt_caching_enabled: Some(true),
        })),
        other => Err(ApiError::bad_request(format!(
            "Aura currently supports org integrations only for the Anthropic provider, received `{other}`"
        ))),
    }
}

async fn run_harness_test(
    state: &AppState,
    agent: &Agent,
    jwt: &str,
    model: Option<String>,
    integration: Option<&ResolvedIntegration>,
) -> ApiResult<RuntimeOutcome> {
    let config = SessionConfig {
        system_prompt: Some(agent.system_prompt.clone()),
        agent_id: Some(agent.agent_id.to_string()),
        agent_name: Some(agent.name.clone()),
        model: model.clone(),
        token: Some(jwt.to_string()),
        provider_config: build_harness_provider_config(integration, model.as_deref())?,
        ..Default::default()
    };

    let session = state
        .harness_for(agent.harness_mode())
        .open_session(config)
        .await
        .map_err(|e| ApiError::bad_gateway(format!("opening harness session failed: {e}")))?;
    let mut rx = session.events_tx.subscribe();
    session
        .commands_tx
        .send(HarnessInbound::UserMessage(UserMessage {
            content: "Reply with exactly `hello from aura` and stop.".to_string(),
            tool_hints: None,
        }))
        .map_err(|e| ApiError::bad_gateway(format!("sending harness message failed: {e}")))?;

    let turn = timeout(Duration::from_secs(45), async {
        let mut text = String::new();
        loop {
            match rx.recv().await {
                Ok(HarnessOutbound::TextDelta(delta)) => text.push_str(&delta.text),
                Ok(HarnessOutbound::AssistantMessageEnd(end)) => {
                    break Ok(RuntimeOutcome {
                        text,
                        usage: end.usage,
                    });
                }
                Ok(HarnessOutbound::Error(err)) => {
                    break Err(ApiError::bad_gateway(format!(
                        "harness runtime test failed ({}): {}",
                        err.code, err.message
                    )));
                }
                Ok(_) => {}
                Err(e) => break Err(ApiError::bad_gateway(format!("harness stream closed: {e}"))),
            }
        }
    })
    .await
    .map_err(|_| ApiError::bad_gateway("harness runtime test timed out"))??;

    let _ = state
        .harness_for(agent.harness_mode())
        .close_session(&session.session_id)
        .await;

    Ok(turn)
}

async fn run_external_adapter_prompt(
    state: &AppState,
    agent: &Agent,
    integration: Option<&ResolvedIntegration>,
    prompt: &str,
    model: Option<String>,
    project_id: Option<String>,
) -> ApiResult<RuntimeOutcome> {
    let cwd = resolve_runtime_cwd(state, project_id.as_deref())
        .unwrap_or_else(|| state.data_dir.to_string_lossy().to_string());
    let mut env_overrides = HashMap::new();
    let mut env_removals = Vec::new();

    let (bin, args) = match agent.adapter_type.as_str() {
        "claude_code" => {
            if let Some(resolved) = integration {
                if resolved.metadata.provider != "anthropic" {
                    return Err(ApiError::bad_request(
                        "Claude Code integrations must use the Anthropic provider",
                    ));
                }
                if let Some(secret) = resolved.secret.as_deref() {
                    env_overrides.insert("ANTHROPIC_API_KEY".to_string(), secret.to_string());
                }
            }
            env_removals.extend([
                "CLAUDE_CODE_USE_VERTEX".to_string(),
                "ANTHROPIC_VERTEX_PROJECT_ID".to_string(),
                "GOOGLE_APPLICATION_CREDENTIALS".to_string(),
            ]);
            let mut args = vec![
                "--print".to_string(),
                "--output-format".to_string(),
                "stream-json".to_string(),
                "--verbose".to_string(),
                "--dangerously-skip-permissions".to_string(),
                "--add-dir".to_string(),
                cwd.clone(),
            ];
            if let Some(model) = model.as_deref() {
                args.push("--model".to_string());
                args.push(model.to_string());
            }
            args.push("-".to_string());
            ("claude".to_string(), args)
        }
        "codex" => {
            if let Some(resolved) = integration {
                if resolved.metadata.provider != "openai" {
                    return Err(ApiError::bad_request(
                        "Codex integrations must use the OpenAI provider",
                    ));
                }
                if let Some(secret) = resolved.secret.as_deref() {
                    env_overrides.insert("OPENAI_API_KEY".to_string(), secret.to_string());
                }
            }
            let mut args = vec![
                "exec".to_string(),
                "--json".to_string(),
                "--skip-git-repo-check".to_string(),
                "--dangerously-bypass-approvals-and-sandbox".to_string(),
                "--cd".to_string(),
                cwd.clone(),
            ];
            if let Some(model) = model.as_deref() {
                args.push("--model".to_string());
                args.push(model.to_string());
            }
            args.push("-".to_string());
            ("codex".to_string(), args)
        }
        other => {
            return Err(ApiError::bad_request(format!(
                "unsupported external adapter `{other}`"
            )))
        }
    };

    let output = run_cli_command(&bin, &args, &cwd, prompt, &env_overrides, &env_removals).await?;
    match agent.adapter_type.as_str() {
        "claude_code" => parse_claude_output(&output, model),
        "codex" => parse_codex_output(&output, model),
        _ => Err(ApiError::bad_request("unsupported external adapter")),
    }
}

fn resolve_runtime_cwd(state: &AppState, project_id: Option<&str>) -> Option<String> {
    let project_id = project_id?.parse::<ProjectId>().ok()?;
    let project = state.project_service.get_project(&project_id).ok();
    resolve_project_workspace_path_for_machine(
        state,
        &project_id,
        project.as_ref().map(|project| project.name.as_str()),
        "local",
    )
}

async fn run_cli_command(
    bin: &str,
    args: &[String],
    cwd: &str,
    prompt: &str,
    env_overrides: &HashMap<String, String>,
    env_removals: &[String],
) -> ApiResult<String> {
    let mut cmd = Command::new(bin);
    cmd.args(args)
        .current_dir(cwd)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    for (key, value) in env_overrides {
        cmd.env(key, value);
    }
    for key in env_removals {
        cmd.env_remove(key);
    }

    let mut child = cmd
        .spawn()
        .map_err(|e| {
            ApiError::bad_gateway(format!(
                "failed to start {bin} in `{cwd}`: {e}. If this agent is bound to a project, verify the workspace path still exists."
            ))
        })?;

    if let Some(mut stdin) = child.stdin.take() {
        stdin
            .write_all(format!("{prompt}\n").as_bytes())
            .await
            .map_err(|e| ApiError::bad_gateway(format!("failed writing prompt to {bin}: {e}")))?;
        let _ = stdin.shutdown().await;
    }

    let output = timeout(Duration::from_secs(120), child.wait_with_output())
        .await
        .map_err(|_| ApiError::bad_gateway(format!("{bin} timed out")))?
        .map_err(|e| ApiError::bad_gateway(format!("waiting for {bin} failed: {e}")))?;

    let stdout = String::from_utf8_lossy(&output.stdout).into_owned();
    let stderr = String::from_utf8_lossy(&output.stderr).into_owned();
    if !output.status.success() && stdout.trim().is_empty() {
        return Err(ApiError::bad_gateway(format!(
            "{bin} exited with {}: {}",
            output.status,
            stderr.trim()
        )));
    }

    Ok(stdout)
}

fn parse_claude_output(stdout: &str, fallback_model: Option<String>) -> ApiResult<RuntimeOutcome> {
    let events = parse_jsonl(stdout);
    let init = events
        .iter()
        .find(|event| event.get("type") == Some(&Value::String("system".to_string())));
    let assistant = events.iter().rev().find(|event| {
        event.get("type") == Some(&Value::String("assistant".to_string()))
            || event
                .get("message")
                .and_then(|message| message.get("model"))
                .is_some()
    });
    let result = events
        .iter()
        .rev()
        .find(|event| event.get("type") == Some(&Value::String("result".to_string())))
        .ok_or_else(|| ApiError::bad_gateway("Claude produced no result event"))?;

    if result
        .get("is_error")
        .and_then(Value::as_bool)
        .unwrap_or(false)
    {
        let message = result
            .get("result")
            .and_then(Value::as_str)
            .unwrap_or("Claude execution failed");
        if message.contains("Not logged in") {
            return Err(ApiError::bad_gateway(
                "Claude Code is not logged in for the aura-os-server process. Run `claude` and complete `/login` in the same host environment, or switch this agent to org integration.",
            ));
        }
        return Err(ApiError::bad_gateway(message));
    }

    let text = result
        .get("result")
        .and_then(Value::as_str)
        .or_else(|| {
            assistant
                .and_then(|event| event.get("message"))
                .and_then(|message| message.get("content"))
                .and_then(Value::as_array)
                .and_then(|blocks| blocks.first())
                .and_then(|block| block.get("text"))
                .and_then(Value::as_str)
        })
        .unwrap_or_default()
        .to_string();
    let usage = result.get("usage").cloned().unwrap_or(Value::Null);
    let model = sanitize_model(
        assistant
            .and_then(|event| event.get("message"))
            .and_then(|message| message.get("model"))
            .and_then(Value::as_str)
            .or_else(|| {
                init.and_then(|event| event.get("model"))
                    .and_then(Value::as_str)
            })
            .or_else(|| fallback_model.as_deref())
            .unwrap_or(""),
    );

    let outcome = RuntimeOutcome {
        text,
        usage: SessionUsage {
            input_tokens: usage_number(&usage, "input_tokens"),
            output_tokens: usage_number(&usage, "output_tokens"),
            estimated_context_tokens: 0,
            cache_creation_input_tokens: usage_number(&usage, "cache_creation_input_tokens"),
            cache_read_input_tokens: usage_number(&usage, "cache_read_input_tokens"),
            cumulative_input_tokens: usage_number(&usage, "input_tokens"),
            cumulative_output_tokens: usage_number(&usage, "output_tokens"),
            cumulative_cache_creation_input_tokens: usage_number(
                &usage,
                "cache_creation_input_tokens",
            ),
            cumulative_cache_read_input_tokens: usage_number(&usage, "cache_read_input_tokens"),
            context_utilization: 0.0,
            model,
            provider: "anthropic".to_string(),
        },
    };

    ensure_non_empty_external_text("Claude Code", outcome)
}

fn parse_codex_output(stdout: &str, fallback_model: Option<String>) -> ApiResult<RuntimeOutcome> {
    let events = parse_jsonl(stdout);
    let result_text = events
        .iter()
        .rev()
        .find_map(|event| {
            event
                .get("item")
                .and_then(|item| item.get("type"))
                .and_then(Value::as_str)
                .filter(|kind| *kind == "agent_message")
                .and_then(|_| {
                    event
                        .get("item")
                        .and_then(|item| item.get("text"))
                        .and_then(Value::as_str)
                })
        })
        .unwrap_or_default()
        .to_string();
    let usage = events
        .iter()
        .rev()
        .find(|event| event.get("type") == Some(&Value::String("turn.completed".to_string())))
        .and_then(|event| event.get("usage"))
        .cloned()
        .unwrap_or(Value::Null);

    let outcome = RuntimeOutcome {
        text: result_text,
        usage: SessionUsage {
            input_tokens: usage_number(&usage, "input_tokens"),
            output_tokens: usage_number(&usage, "output_tokens"),
            estimated_context_tokens: 0,
            cache_creation_input_tokens: 0,
            cache_read_input_tokens: usage_number(&usage, "cached_input_tokens"),
            cumulative_input_tokens: usage_number(&usage, "input_tokens"),
            cumulative_output_tokens: usage_number(&usage, "output_tokens"),
            cumulative_cache_creation_input_tokens: 0,
            cumulative_cache_read_input_tokens: usage_number(&usage, "cached_input_tokens"),
            context_utilization: 0.0,
            model: fallback_model.unwrap_or_else(|| "codex".to_string()),
            provider: "openai".to_string(),
        },
    };

    ensure_non_empty_external_text("Codex", outcome)
}

fn ensure_non_empty_external_text(
    adapter_label: &str,
    outcome: RuntimeOutcome,
) -> ApiResult<RuntimeOutcome> {
    if outcome.text.trim().is_empty() {
        return Err(ApiError::bad_gateway(format!(
            "{adapter_label} returned no assistant message. Check the runtime auth/session and try again."
        )));
    }

    Ok(outcome)
}

fn parse_jsonl(stdout: &str) -> Vec<Value> {
    stdout
        .lines()
        .filter_map(|line| serde_json::from_str::<Value>(line.trim()).ok())
        .collect()
}

fn usage_number(usage: &Value, key: &str) -> u64 {
    usage.get(key).and_then(Value::as_u64).unwrap_or_default()
}

fn sanitize_model(model: &str) -> String {
    model
        .trim()
        .replace(|c: char| c == '\u{1b}', "")
        .split('[')
        .next()
        .unwrap_or(model)
        .trim()
        .to_string()
}

fn build_external_prompt(
    state: &AppState,
    agent: &Agent,
    user_content: &str,
    project_id: Option<&str>,
) -> String {
    let mut prompt = String::new();
    if !agent.system_prompt.trim().is_empty() {
        prompt.push_str("System instructions:\n");
        prompt.push_str(agent.system_prompt.trim());
        prompt.push_str("\n\n");
    }
    if let Some(project_id) = project_id.and_then(|value| value.parse::<ProjectId>().ok()) {
        if let Ok(project) = state.project_service.get_project(&project_id) {
            prompt.push_str("Project context:\n");
            prompt.push_str(&format!("project_id: {}\n", project.project_id));
            prompt.push_str(&format!("project_name: {}\n", project.name));
            if !project.description.trim().is_empty() {
                prompt.push_str(&format!("description: {}\n", project.description.trim()));
            }
            if let Some(workspace) = resolve_project_workspace_path_for_machine(
                state,
                &project.project_id,
                Some(project.name.as_str()),
                "local",
            ) {
                prompt.push_str(&format!("workspace: {}\n", workspace));
            }
            prompt.push('\n');
        }
    }
    prompt.push_str("User request:\n");
    prompt.push_str(user_content.trim());
    prompt
}
