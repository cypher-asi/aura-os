use std::collections::HashMap;
use std::convert::Infallible;
use std::path::PathBuf;
use std::process::Stdio;
use std::time::Duration;

use axum::extract::{Path, State};
use axum::http::HeaderValue;
use axum::response::sse::{Event, KeepAlive, Sse};
use axum::Json;
use serde_json::Value;
use tokio::fs;
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};
use tokio::process::Command;
use tokio::sync::{broadcast, mpsc};
use tokio::time::timeout;
use tokio_stream::wrappers::UnboundedReceiverStream;
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
use crate::handlers::agents::chat::{
    setup_agent_chat_persistence, spawn_chat_persist_task, SseResponse, SseStream,
};
use crate::handlers::agents::workspace_tools::{
    active_workspace_tools, control_plane_api_base_url as workspace_control_plane_api_base_url,
    installed_workspace_app_tools, installed_workspace_integrations_for_org_with_token,
    shared_workspace_tools, workspace_tool, WorkspaceToolSourceKind,
};
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

#[derive(Clone)]
struct ExternalProjectMcpConfig {
    server_name: String,
    command: String,
    args: Vec<String>,
    env: HashMap<String, String>,
}

fn is_external_tool_name(name: &str) -> bool {
    workspace_tool(name).is_some()
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

    let integration = resolve_integration(&state, &agent, &jwt).await?;
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
    if supports_external_project_tools(&agent.adapter_type) && body.project_id.is_some() {
        return send_external_project_agent_event_stream(state, jwt, agent, body).await;
    }

    let integration = resolve_integration(state, agent, jwt).await?;
    let model = effective_model(agent, integration.as_ref(), body.model.clone());
    let persist_ctx = setup_agent_chat_persistence(state, &agent.agent_id, &agent.name, jwt).await;
    if let Some(ref ctx) = persist_ctx {
        super::chat::persist_user_message(ctx, &body.content, &None);
    }
    let prompt =
        build_external_prompt(state, agent, &body.content, body.project_id.as_deref()).await;

    let outcome = run_external_adapter_prompt(
        state,
        agent,
        integration.as_ref(),
        &prompt,
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

async fn send_external_project_agent_event_stream(
    state: &AppState,
    jwt: &str,
    agent: &Agent,
    body: SendChatRequest,
) -> ApiResult<SseResponse> {
    let project_id = body
        .project_id
        .clone()
        .ok_or_else(|| ApiError::bad_request("External project chat requires a project id"))?;
    let integration = resolve_integration(state, agent, jwt).await?;
    let model = effective_model(agent, integration.as_ref(), body.model.clone());
    let persist_ctx = setup_agent_chat_persistence(state, &agent.agent_id, &agent.name, jwt).await;
    if let Some(ref ctx) = persist_ctx {
        super::chat::persist_user_message(ctx, &body.content, &None);
    }

    let prompt =
        build_external_prompt(state, agent, &body.content, Some(project_id.as_str())).await;
    let mcp_config = build_external_project_mcp_config(state, &project_id, jwt, agent).await?;
    let tool_infos = external_project_tool_infos(state, agent, jwt).await;
    let (events_tx, _) = broadcast::channel::<HarnessOutbound>(256);
    let (sse_tx, sse_rx) = mpsc::unbounded_channel::<Result<Event, Infallible>>();
    let message_id = Uuid::new_v4().to_string();

    if let Some(ctx) = persist_ctx {
        spawn_chat_persist_task(events_tx.subscribe(), ctx);
    }

    let sse_stream: SseStream = Box::pin(UnboundedReceiverStream::new(sse_rx));
    let state = state.clone();
    let agent = agent.clone();
    tokio::spawn(async move {
        emit_harness_event(
            &events_tx,
            &sse_tx,
            HarnessOutbound::SessionReady(SessionReady {
                session_id: Uuid::new_v4().to_string(),
                tools: tool_infos.clone(),
                skills: Vec::new(),
            }),
        );
        emit_harness_event(
            &events_tx,
            &sse_tx,
            HarnessOutbound::AssistantMessageStart(AssistantMessageStart {
                message_id: message_id.clone(),
            }),
        );

        let result = match agent.adapter_type.as_str() {
            "codex" => {
                stream_codex_project_turn(
                    &state,
                    &agent,
                    integration.as_ref(),
                    &prompt,
                    model,
                    &project_id,
                    &message_id,
                    &mcp_config,
                    &events_tx,
                    &sse_tx,
                )
                .await
            }
            "claude_code" => {
                stream_claude_project_turn(
                    &state,
                    integration.as_ref(),
                    &prompt,
                    model,
                    &project_id,
                    &message_id,
                    &mcp_config,
                    &events_tx,
                    &sse_tx,
                )
                .await
            }
            other => Err(ApiError::bad_request(format!(
                "unsupported external adapter `{other}`"
            ))),
        };

        if let Err(err) = result {
            let (_, error) = err;
            emit_harness_event(
                &events_tx,
                &sse_tx,
                HarnessOutbound::Error(aura_os_link::ErrorMsg {
                    code: "external_adapter_error".to_string(),
                    message: error.0.error,
                    recoverable: false,
                }),
            );
        }
    });

    Ok((
        [("x-accel-buffering", HeaderValue::from_static("no"))],
        Sse::new(sse_stream).keep_alive(KeepAlive::default()),
    ))
}

fn supports_external_project_tools(adapter_type: &str) -> bool {
    matches!(adapter_type, "codex" | "claude_code")
}

fn model_provider_env_var(provider: &str) -> Option<&'static str> {
    match provider {
        "anthropic" => Some("ANTHROPIC_API_KEY"),
        "openai" => Some("OPENAI_API_KEY"),
        "google_gemini" => Some("GEMINI_API_KEY"),
        "xai" => Some("XAI_API_KEY"),
        "groq" => Some("GROQ_API_KEY"),
        "openrouter" => Some("OPENROUTER_API_KEY"),
        "together" => Some("TOGETHER_API_KEY"),
        "mistral" => Some("MISTRAL_API_KEY"),
        "perplexity" => Some("PERPLEXITY_API_KEY"),
        _ => None,
    }
}

fn opencode_default_model(provider: &str) -> Option<&'static str> {
    match provider {
        "anthropic" => Some("anthropic/claude-sonnet-4.5"),
        "openai" => Some("openai/gpt-5.2-codex"),
        "google_gemini" => Some("google/gemini-2.5-pro"),
        "xai" => Some("xai/grok-4"),
        "groq" => Some("groq/llama-3.3-70b-versatile"),
        "openrouter" => Some("openrouter/openai/gpt-4.1-mini"),
        "together" => Some("together/meta-llama/Meta-Llama-3.1-70B-Instruct-Turbo"),
        "mistral" => Some("mistral/mistral-large-latest"),
        "perplexity" => Some("perplexity/sonar-pro"),
        _ => None,
    }
}

async fn external_project_tool_infos(state: &AppState, agent: &Agent, jwt: &str) -> Vec<ToolInfo> {
    let mut tools = shared_workspace_tools()
        .iter()
        .filter(|tool| tool.source_kind == WorkspaceToolSourceKind::AuraNative)
        .map(|tool| ToolInfo {
            name: tool.name.clone(),
            description: tool.description.clone(),
        })
        .collect::<Vec<_>>();

    if let Some(org_id) = agent.org_id.as_ref() {
        tools.extend(
            installed_workspace_app_tools(state, org_id, jwt)
                .await
                .into_iter()
                .map(|tool| ToolInfo {
                    name: tool.name,
                    description: tool.description,
                }),
        );
    }

    tools
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

pub(crate) async fn resolve_integration(
    state: &AppState,
    agent: &Agent,
    jwt: &str,
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

    resolve_integration_inner(state, org_id, integration_id, jwt).await
}

pub(crate) async fn resolve_integration_ref(
    state: &AppState,
    org_id: Option<aura_os_core::OrgId>,
    auth_source: &str,
    integration_id: Option<&str>,
    jwt: &str,
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

    resolve_integration_inner(state, org_id, integration_id, jwt).await
}

async fn resolve_integration_inner(
    state: &AppState,
    org_id: aura_os_core::OrgId,
    integration_id: &str,
    jwt: &str,
) -> Result<Option<ResolvedIntegration>, (axum::http::StatusCode, Json<ApiError>)> {
    if let Some(client) = &state.integrations_client {
        let metadata = client
            .get_integration(&org_id, integration_id, jwt)
            .await
            .map_err(|e| ApiError::internal(format!("loading integration: {e}")))?;
        let secret = client
            .get_integration_secret_authed(&org_id, integration_id, jwt)
            .await
            .map_err(|e| ApiError::internal(format!("loading integration secret: {e}")))?;
        return Ok(Some(ResolvedIntegration { metadata, secret }));
    }

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
    let installed_tools = if let Some(org_id) = agent.org_id.as_ref() {
        let tools = installed_workspace_app_tools(state, org_id, jwt).await;
        (!tools.is_empty()).then_some(tools)
    } else {
        None
    };
    let installed_integrations = if let Some(org_id) = agent.org_id.as_ref() {
        let integrations =
            installed_workspace_integrations_for_org_with_token(state, org_id, jwt).await;
        (!integrations.is_empty()).then_some(integrations)
    } else {
        None
    };
    let config = SessionConfig {
        system_prompt: Some(agent.system_prompt.clone()),
        agent_id: Some(agent.agent_id.to_string()),
        agent_name: Some(agent.name.clone()),
        model: model.clone(),
        token: Some(jwt.to_string()),
        provider_config: build_harness_provider_config(integration, model.as_deref())?,
        installed_tools,
        installed_integrations,
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
            attachments: None,
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
    let mut writes_prompt_to_stdin = true;

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
        "gemini_cli" => {
            if let Some(resolved) = integration {
                if resolved.metadata.provider != "google_gemini" {
                    return Err(ApiError::bad_request(
                        "Gemini CLI integrations must use the Google Gemini provider",
                    ));
                }
                if let Some(secret) = resolved.secret.as_deref() {
                    env_overrides.insert("GEMINI_API_KEY".to_string(), secret.to_string());
                    env_overrides.insert("GOOGLE_API_KEY".to_string(), secret.to_string());
                }
            }
            writes_prompt_to_stdin = false;
            let mut args = vec![
                "--prompt".to_string(),
                prompt.to_string(),
                "--output-format".to_string(),
                "json".to_string(),
                "--yolo".to_string(),
            ];
            if let Some(model) = model.as_deref() {
                args.push("--model".to_string());
                args.push(model.to_string());
            }
            ("gemini".to_string(), args)
        }
        "opencode" => {
            if let Some(resolved) = integration {
                let Some(env_var) = model_provider_env_var(&resolved.metadata.provider) else {
                    return Err(ApiError::bad_request(format!(
                        "OpenCode does not yet support team integration provider `{}`",
                        resolved.metadata.provider
                    )));
                };
                if let Some(secret) = resolved.secret.as_deref() {
                    env_overrides.insert(env_var.to_string(), secret.to_string());
                }
            }
            env_overrides.insert(
                "OPENCODE_DISABLE_PROJECT_CONFIG".to_string(),
                "true".to_string(),
            );
            writes_prompt_to_stdin = false;
            let resolved_model = model
                .clone()
                .or_else(|| {
                    integration.and_then(|resolved| {
                        opencode_default_model(&resolved.metadata.provider).map(str::to_string)
                    })
                })
                .ok_or_else(|| {
                    ApiError::bad_request(
                        "OpenCode requires a default model or a compatible integration default model",
                    )
                })?;
            let args = vec![
                "run".to_string(),
                "--format".to_string(),
                "json".to_string(),
                "--model".to_string(),
                resolved_model,
                prompt.to_string(),
            ];
            ("opencode".to_string(), args)
        }
        "cursor" => {
            if integration.is_some() {
                return Err(ApiError::bad_request(
                    "Cursor currently supports local CLI auth only",
                ));
            }
            writes_prompt_to_stdin = false;
            let mut args = vec![
                "--print".to_string(),
                "--output-format".to_string(),
                "json".to_string(),
            ];
            if let Some(model) = model.as_deref() {
                args.push("--model".to_string());
                args.push(model.to_string());
            }
            args.push(prompt.to_string());
            ("cursor-agent".to_string(), args)
        }
        other => {
            return Err(ApiError::bad_request(format!(
                "unsupported external adapter `{other}`"
            )))
        }
    };

    let output = if writes_prompt_to_stdin {
        run_cli_command(&bin, &args, &cwd, prompt, &env_overrides, &env_removals).await?
    } else {
        run_cli_command_no_stdin(&bin, &args, &cwd, &env_overrides, &env_removals).await?
    };
    match agent.adapter_type.as_str() {
        "claude_code" => parse_claude_output(&output, model),
        "codex" => parse_codex_output(&output, model),
        "gemini_cli" => parse_gemini_output(&output, model),
        "opencode" => parse_opencode_output(&output, model),
        "cursor" => parse_cursor_output(&output, model),
        _ => Err(ApiError::bad_request("unsupported external adapter")),
    }
}

async fn stream_codex_project_turn(
    state: &AppState,
    _agent: &Agent,
    integration: Option<&ResolvedIntegration>,
    prompt: &str,
    model: Option<String>,
    project_id: &str,
    message_id: &str,
    mcp_config: &ExternalProjectMcpConfig,
    events_tx: &broadcast::Sender<HarnessOutbound>,
    sse_tx: &mpsc::UnboundedSender<Result<Event, Infallible>>,
) -> ApiResult<()> {
    let cwd = resolve_runtime_cwd(state, Some(project_id))
        .unwrap_or_else(|| state.data_dir.to_string_lossy().to_string());
    let mut env_overrides = HashMap::new();
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
        "-c".to_string(),
        format!(
            "mcp_servers.{}.command={}",
            mcp_config.server_name,
            codex_toml_string(&mcp_config.command)
        ),
        "-c".to_string(),
        format!(
            "mcp_servers.{}.args=[{}]",
            mcp_config.server_name,
            mcp_config
                .args
                .iter()
                .map(|a| codex_toml_string(a))
                .collect::<Vec<_>>()
                .join(",")
        ),
        "-c".to_string(),
        format!(
            "mcp_servers.{}.env={}",
            mcp_config.server_name,
            codex_inline_env(&mcp_config.env)
        ),
        "-".to_string(),
    ];
    if let Some(model) = model.as_deref() {
        let insert_at = args.len() - 1;
        args.insert(insert_at, model.to_string());
        args.insert(insert_at, "--model".to_string());
    }

    let mut cmd = Command::new("codex");
    cmd.args(&args)
        .current_dir(&cwd)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    for (key, value) in &env_overrides {
        cmd.env(key, value);
    }

    let mut child = cmd.spawn().map_err(|e| {
        ApiError::bad_gateway(format!(
            "failed to start codex in `{cwd}`: {e}. If this agent is bound to a project, verify the workspace path still exists."
        ))
    })?;

    if let Some(mut stdin) = child.stdin.take() {
        stdin
            .write_all(format!("{prompt}\n").as_bytes())
            .await
            .map_err(|e| ApiError::bad_gateway(format!("failed writing prompt to codex: {e}")))?;
        let _ = stdin.shutdown().await;
    }

    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| ApiError::bad_gateway("codex stdout unavailable"))?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| ApiError::bad_gateway("codex stderr unavailable"))?;

    let stderr_task = tokio::spawn(async move {
        let mut reader = BufReader::new(stderr);
        let mut output = String::new();
        let _ = reader.read_to_string(&mut output).await;
        output
    });

    let mut lines = BufReader::new(stdout).lines();
    let mut usage = SessionUsage {
        model: model.unwrap_or_else(|| "codex".to_string()),
        provider: "openai".to_string(),
        ..Default::default()
    };
    let mut saw_text = false;
    let mut saw_tool_event = false;

    loop {
        let next_line = timeout(Duration::from_secs(120), lines.next_line())
            .await
            .map_err(|_| ApiError::bad_gateway("codex timed out"))?;
        let Some(line) = next_line
            .map_err(|e| ApiError::bad_gateway(format!("reading codex output failed: {e}")))?
        else {
            break;
        };

        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        let Ok(event) = serde_json::from_str::<Value>(trimmed) else {
            continue;
        };

        if let Some(turn_usage) = codex_turn_usage(&event, usage.model.clone()) {
            usage = turn_usage;
            continue;
        }

        if let Some(tool_start) = codex_tool_use_start(&event) {
            saw_tool_event = true;
            let tool_name = tool_start.name.clone();
            let tool_id = tool_start.id.clone();
            emit_harness_event(events_tx, sse_tx, HarnessOutbound::ToolUseStart(tool_start));
            if let Some(tool_call) = codex_tool_call_payload(&event, &tool_id, &tool_name) {
                emit_json_sse_event(sse_tx, "tool_call", tool_call);
            }
            continue;
        }

        if let Some(tool_result) = codex_tool_result(&event) {
            saw_tool_event = true;
            let tool_result_id = tool_result.tool_use_id.clone();
            let tool_name = tool_result.name.clone();
            let _ = events_tx.send(HarnessOutbound::ToolResult(tool_result.clone()));
            emit_json_sse_event(
                sse_tx,
                "tool_result",
                serde_json::json!({
                    "id": tool_result_id,
                    "name": tool_result.name,
                    "result": tool_result.result,
                    "is_error": tool_result.is_error,
                }),
            );
            emit_saved_artifact_events(
                sse_tx,
                &tool_name,
                tool_result.is_error,
                &tool_result.result,
            );
            continue;
        }

        if let Some(text) = codex_agent_message_text(&event) {
            if !text.trim().is_empty() {
                saw_text = true;
                emit_harness_event(
                    events_tx,
                    sse_tx,
                    HarnessOutbound::TextDelta(TextDelta { text }),
                );
            }
        }
    }

    let status = timeout(Duration::from_secs(5), child.wait())
        .await
        .map_err(|_| ApiError::bad_gateway("waiting for codex failed"))?
        .map_err(|e| ApiError::bad_gateway(format!("waiting for codex failed: {e}")))?;
    let stderr_output = stderr_task.await.unwrap_or_default();

    if !status.success() && !saw_text && !saw_tool_event {
        return Err(ApiError::bad_gateway(format!(
            "codex exited with {}: {}",
            status,
            stderr_output.trim()
        )));
    }

    if !saw_text && !saw_tool_event {
        return Err(ApiError::bad_gateway(
            "Codex returned no assistant message or tool activity. Check the runtime auth/session and try again.",
        ));
    }

    emit_harness_event(
        events_tx,
        sse_tx,
        HarnessOutbound::AssistantMessageEnd(AssistantMessageEnd {
            message_id: message_id.to_string(),
            stop_reason: "end_turn".to_string(),
            usage,
            files_changed: FilesChanged::default(),
        }),
    );

    Ok(())
}

async fn stream_claude_project_turn(
    state: &AppState,
    integration: Option<&ResolvedIntegration>,
    prompt: &str,
    model: Option<String>,
    project_id: &str,
    message_id: &str,
    mcp_config: &ExternalProjectMcpConfig,
    events_tx: &broadcast::Sender<HarnessOutbound>,
    sse_tx: &mpsc::UnboundedSender<Result<Event, Infallible>>,
) -> ApiResult<()> {
    let cwd = resolve_runtime_cwd(state, Some(project_id))
        .unwrap_or_else(|| state.data_dir.to_string_lossy().to_string());
    let mcp_config_path = write_claude_mcp_config_file(mcp_config).await?;
    let mut env_overrides = HashMap::new();
    let mut env_removals = Vec::new();
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
        "--strict-mcp-config".to_string(),
        "--mcp-config".to_string(),
        mcp_config_path.to_string_lossy().to_string(),
        "--".to_string(),
        prompt.to_string(),
    ];
    if let Some(model) = model.as_deref() {
        let insert_at = args.len() - 1;
        args.insert(insert_at, model.to_string());
        args.insert(insert_at, "--model".to_string());
    }

    let mut cmd = Command::new("claude");
    cmd.args(&args)
        .current_dir(&cwd)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    for (key, value) in &env_overrides {
        cmd.env(key, value);
    }
    for key in &env_removals {
        cmd.env_remove(key);
    }

    let mut child = cmd.spawn().map_err(|e| {
        let _ = std::fs::remove_file(&mcp_config_path);
        ApiError::bad_gateway(format!(
            "failed to start claude in `{cwd}`: {e}. If this agent is bound to a project, verify the workspace path still exists."
        ))
    })?;

    drop(child.stdin.take());

    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| ApiError::bad_gateway("claude stdout unavailable"))?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| ApiError::bad_gateway("claude stderr unavailable"))?;

    let stderr_task = tokio::spawn(async move {
        let mut reader = BufReader::new(stderr);
        let mut output = String::new();
        let _ = reader.read_to_string(&mut output).await;
        output
    });

    let mut lines = BufReader::new(stdout).lines();
    let mut usage = SessionUsage {
        model: model.unwrap_or_else(|| "claude".to_string()),
        provider: "anthropic".to_string(),
        ..Default::default()
    };
    let mut saw_text = false;
    let mut saw_tool_event = false;
    let mut tool_names_by_id = HashMap::<String, String>::new();

    loop {
        let next_line = timeout(Duration::from_secs(120), lines.next_line())
            .await
            .map_err(|_| ApiError::bad_gateway("claude timed out"))?;
        let Some(line) = next_line
            .map_err(|e| ApiError::bad_gateway(format!("reading claude output failed: {e}")))?
        else {
            break;
        };

        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        let Ok(event) = serde_json::from_str::<Value>(trimmed) else {
            continue;
        };

        if let Some(error_message) = claude_result_error(&event) {
            return Err(ApiError::bad_gateway(error_message));
        }

        if let Some(turn_usage) = claude_result_usage(&event, usage.model.clone()) {
            usage = turn_usage;
        }

        for tool_start in claude_tool_use_starts(&event) {
            saw_tool_event = true;
            tool_names_by_id.insert(tool_start.id.clone(), tool_start.name.clone());
            let tool_id = tool_start.id.clone();
            let tool_name = tool_start.name.clone();
            emit_harness_event(events_tx, sse_tx, HarnessOutbound::ToolUseStart(tool_start));
            if let Some(tool_call) = claude_tool_call_payload(&event, &tool_id, &tool_name) {
                emit_json_sse_event(sse_tx, "tool_call", tool_call);
            }
        }

        for tool_result in claude_tool_results(&event, &tool_names_by_id) {
            saw_tool_event = true;
            let tool_name = tool_result.name.clone();
            let tool_result_id = tool_result.tool_use_id.clone();
            let _ = events_tx.send(HarnessOutbound::ToolResult(tool_result.clone()));
            emit_json_sse_event(
                sse_tx,
                "tool_result",
                serde_json::json!({
                    "id": tool_result_id,
                    "name": tool_result.name,
                    "result": tool_result.result,
                    "is_error": tool_result.is_error,
                }),
            );
            emit_saved_artifact_events(
                sse_tx,
                &tool_name,
                tool_result.is_error,
                &tool_result.result,
            );
        }

        if let Some(text) = claude_result_text(&event) {
            if !text.trim().is_empty() {
                saw_text = true;
                emit_harness_event(
                    events_tx,
                    sse_tx,
                    HarnessOutbound::TextDelta(TextDelta { text }),
                );
            }
        }
    }

    let status = timeout(Duration::from_secs(5), child.wait())
        .await
        .map_err(|_| ApiError::bad_gateway("waiting for claude failed"))?
        .map_err(|e| ApiError::bad_gateway(format!("waiting for claude failed: {e}")))?;
    let _ = fs::remove_file(&mcp_config_path).await;
    let stderr_output = stderr_task.await.unwrap_or_default();

    if !status.success() && !saw_text && !saw_tool_event {
        return Err(ApiError::bad_gateway(format!(
            "claude exited with {}: {}",
            status,
            stderr_output.trim()
        )));
    }

    if !saw_text && !saw_tool_event {
        return Err(ApiError::bad_gateway(
            "Claude Code returned no assistant message or tool activity. Check the runtime auth/session and try again.",
        ));
    }

    emit_harness_event(
        events_tx,
        sse_tx,
        HarnessOutbound::AssistantMessageEnd(AssistantMessageEnd {
            message_id: message_id.to_string(),
            stop_reason: "end_turn".to_string(),
            usage,
            files_changed: FilesChanged::default(),
        }),
    );

    Ok(())
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

async fn run_cli_command_no_stdin(
    bin: &str,
    args: &[String],
    cwd: &str,
    env_overrides: &HashMap<String, String>,
    env_removals: &[String],
) -> ApiResult<String> {
    let mut cmd = Command::new(bin);
    cmd.args(args)
        .current_dir(cwd)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    for (key, value) in env_overrides {
        cmd.env(key, value);
    }
    for key in env_removals {
        cmd.env_remove(key);
    }

    let child = cmd.spawn().map_err(|e| {
        ApiError::bad_gateway(format!(
            "failed to start {bin} in `{cwd}`: {e}. If this agent is bound to a project, verify the workspace path still exists."
        ))
    })?;

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

async fn build_external_project_mcp_config(
    state: &AppState,
    project_id: &str,
    jwt: &str,
    agent: &Agent,
) -> ApiResult<ExternalProjectMcpConfig> {
    let script_path = find_control_plane_mcp_script().ok_or_else(|| {
        ApiError::bad_gateway(
            "External project tool bridge is unavailable because the Aura control-plane MCP script could not be found.",
        )
    })?;
    let agent_instance_id =
        resolve_or_create_project_agent_instance_id(state, project_id, jwt, agent).await?;

    let mut env = HashMap::new();
    env.insert(
        "AURA_MCP_API_BASE_URL".to_string(),
        control_plane_api_base_url(),
    );
    env.insert("AURA_MCP_PROJECT_ID".to_string(), project_id.to_string());
    env.insert("AURA_MCP_JWT".to_string(), jwt.to_string());
    env.insert("AURA_MCP_AGENT_INSTANCE_ID".to_string(), agent_instance_id);
    if let Some(workspace_path) = resolve_runtime_cwd(state, Some(project_id)) {
        env.insert("AURA_MCP_PROJECT_WORKSPACE".to_string(), workspace_path);
    }
    if let Some(org_id) = agent.org_id {
        env.insert("AURA_MCP_ORG_ID".to_string(), org_id.to_string());
    }
    if let Some(secrets_json) = mcp_server_secrets_json(state, agent) {
        env.insert(
            "AURA_MCP_INTEGRATION_SECRETS_JSON".to_string(),
            secrets_json,
        );
    }

    Ok(ExternalProjectMcpConfig {
        server_name: "aura".to_string(),
        command: "node".to_string(),
        args: vec![script_path.to_string_lossy().to_string()],
        env,
    })
}

fn claude_mcp_config_json(mcp_config: &ExternalProjectMcpConfig) -> String {
    serde_json::json!({
        "mcpServers": {
            mcp_config.server_name.clone(): {
                "command": mcp_config.command,
                "args": mcp_config.args,
                "env": mcp_config.env,
            }
        }
    })
    .to_string()
}

async fn write_claude_mcp_config_file(mcp_config: &ExternalProjectMcpConfig) -> ApiResult<PathBuf> {
    let path = std::env::temp_dir().join(format!("aura-claude-mcp-{}.json", Uuid::new_v4()));
    fs::write(&path, claude_mcp_config_json(mcp_config))
        .await
        .map_err(|e| ApiError::internal(format!("failed to write Claude MCP config: {e}")))?;
    Ok(path)
}

fn find_control_plane_mcp_script() -> Option<PathBuf> {
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let candidates = [
        manifest_dir.join("../../interface/scripts/aura-control-plane-mcp.mjs"),
        PathBuf::from("interface/scripts/aura-control-plane-mcp.mjs"),
        PathBuf::from("../../interface/scripts/aura-control-plane-mcp.mjs"),
    ];
    candidates.into_iter().find(|path| path.exists())
}

async fn resolve_or_create_project_agent_instance_id(
    state: &AppState,
    project_id: &str,
    jwt: &str,
    agent: &Agent,
) -> ApiResult<String> {
    let storage = state.require_storage_client()?;
    let project_agents = storage
        .list_project_agents(project_id, jwt)
        .await
        .map_err(|e| ApiError::internal(format!("listing project agents for MCP bridge: {e}")))?;

    let agent_id = agent.agent_id.to_string();
    if let Some(existing) = project_agents
        .into_iter()
        .find(|project_agent| project_agent.agent_id.as_deref() == Some(agent_id.as_str()))
    {
        return Ok(existing.id);
    }

    let request = aura_os_storage::CreateProjectAgentRequest {
        agent_id,
        name: agent.name.clone(),
        org_id: None,
        role: Some(agent.role.clone()),
        personality: Some(agent.personality.clone()),
        system_prompt: Some(agent.system_prompt.clone()),
        skills: Some(agent.skills.clone()),
        icon: agent.icon.clone(),
        harness: None,
    };

    let created = storage
        .create_project_agent(project_id, jwt, &request)
        .await
        .map_err(|e| ApiError::internal(format!("creating project agent for MCP bridge: {e}")))?;
    Ok(created.id)
}

fn control_plane_api_base_url() -> String {
    workspace_control_plane_api_base_url()
}

fn mcp_server_secrets_json(state: &AppState, agent: &Agent) -> Option<String> {
    let org_id = agent.org_id?;
    let integrations = state.org_service.list_integrations(&org_id).ok()?;
    let mut secrets = serde_json::Map::new();

    for integration in integrations {
        if !integration.has_secret
            || !integration.enabled
            || integration.kind != aura_os_core::OrgIntegrationKind::McpServer
        {
            continue;
        }
        let secret = state
            .org_service
            .get_integration_secret(&integration.integration_id)
            .ok()
            .flatten()
            .filter(|value| !value.trim().is_empty());
        if let Some(secret) = secret {
            secrets.insert(integration.integration_id, Value::String(secret));
        }
    }

    if secrets.is_empty() {
        None
    } else {
        Some(Value::Object(secrets).to_string())
    }
}

fn emit_harness_event(
    events_tx: &broadcast::Sender<HarnessOutbound>,
    sse_tx: &mpsc::UnboundedSender<Result<Event, Infallible>>,
    event: HarnessOutbound,
) {
    let _ = events_tx.send(event.clone());
    let _ = sse_tx.send(harness_event_to_sse(&event));
}

fn emit_json_sse_event(
    sse_tx: &mpsc::UnboundedSender<Result<Event, Infallible>>,
    event_type: &str,
    value: Value,
) {
    let event = Event::default()
        .event(event_type)
        .json_data(value)
        .unwrap_or_else(|_| Event::default().event(event_type).data("{}"));
    let _ = sse_tx.send(Ok(event));
}

fn emit_saved_artifact_events(
    sse_tx: &mpsc::UnboundedSender<Result<Event, Infallible>>,
    tool_name: &str,
    is_error: bool,
    result: &str,
) {
    if is_error {
        return;
    }
    let Some(tool) = workspace_tool(tool_name) else {
        return;
    };
    let Some(saved_event) = tool.saved_event.as_deref() else {
        return;
    };
    let Some(value) = parse_tool_result_json(result) else {
        return;
    };
    let payload_key = tool.saved_payload_key.as_deref().unwrap_or("result");
    let payload = value.get(payload_key).cloned().unwrap_or(value);
    emit_json_sse_event(
        sse_tx,
        saved_event,
        serde_json::json!({ payload_key: payload }),
    );
}

fn codex_inline_env(values: &HashMap<String, String>) -> String {
    let mut entries = values.iter().collect::<Vec<_>>();
    entries.sort_by(|(left, _), (right, _)| left.cmp(right));
    let pairs = entries
        .into_iter()
        .map(|(key, value)| format!("{key}={}", codex_toml_string(value)))
        .collect::<Vec<_>>()
        .join(",");
    format!("{{{pairs}}}")
}

fn codex_toml_string(value: &str) -> String {
    let escaped = value
        .replace('\\', "\\\\")
        .replace('"', "\\\"")
        .replace('\n', "\\n")
        .replace('\r', "\\r")
        .replace('\t', "\\t");
    format!("\"{escaped}\"")
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

fn parse_gemini_output(stdout: &str, fallback_model: Option<String>) -> ApiResult<RuntimeOutcome> {
    if stdout.contains("Please set an Auth method") {
        return Err(ApiError::bad_gateway(
            "Gemini CLI is not authenticated for the aura-os-server process. Configure local Gemini auth in ~/.gemini/settings.json or attach a Google Gemini team integration.",
        ));
    }

    let event = parse_json_output(stdout)
        .or_else(|| parse_jsonl(stdout).into_iter().last())
        .ok_or_else(|| ApiError::bad_gateway("Gemini CLI produced no structured output"))?;

    if let Some(message) = event.get("error").and_then(Value::as_str).or_else(|| {
        event
            .get("error")
            .and_then(|error| error.get("message"))
            .and_then(Value::as_str)
    }) {
        return Err(ApiError::bad_gateway(message));
    }

    let text = event
        .get("response")
        .and_then(Value::as_str)
        .or_else(|| event.get("result").and_then(Value::as_str))
        .or_else(|| event.get("text").and_then(Value::as_str))
        .unwrap_or_default()
        .to_string();
    let stats = event.get("stats").cloned().unwrap_or(Value::Null);
    let model = event
        .get("model")
        .and_then(Value::as_str)
        .map(sanitize_model)
        .filter(|value| !value.is_empty())
        .or(fallback_model)
        .unwrap_or_else(|| "gemini".to_string());

    ensure_non_empty_external_text(
        "Gemini CLI",
        RuntimeOutcome {
            text,
            usage: SessionUsage {
                input_tokens: usage_number(&stats, "input_tokens"),
                output_tokens: usage_number(&stats, "output_tokens"),
                estimated_context_tokens: 0,
                cache_creation_input_tokens: 0,
                cache_read_input_tokens: 0,
                cumulative_input_tokens: usage_number(&stats, "input_tokens"),
                cumulative_output_tokens: usage_number(&stats, "output_tokens"),
                cumulative_cache_creation_input_tokens: 0,
                cumulative_cache_read_input_tokens: 0,
                context_utilization: 0.0,
                model,
                provider: "google_gemini".to_string(),
            },
        },
    )
}

fn parse_opencode_output(
    stdout: &str,
    fallback_model: Option<String>,
) -> ApiResult<RuntimeOutcome> {
    let parsed = parse_json_output(stdout).or_else(|| parse_jsonl(stdout).into_iter().last());
    let text = parsed
        .as_ref()
        .and_then(|event| {
            event
                .get("result")
                .and_then(Value::as_str)
                .or_else(|| event.get("text").and_then(Value::as_str))
                .or_else(|| event.get("response").and_then(Value::as_str))
        })
        .unwrap_or_else(|| stdout.trim())
        .to_string();
    let model = fallback_model.unwrap_or_else(|| "opencode".to_string());
    let provider = model
        .split('/')
        .next()
        .filter(|value| !value.is_empty())
        .unwrap_or("opencode")
        .to_string();

    ensure_non_empty_external_text(
        "OpenCode",
        RuntimeOutcome {
            text,
            usage: SessionUsage {
                model,
                provider,
                ..Default::default()
            },
        },
    )
}

fn parse_cursor_output(stdout: &str, fallback_model: Option<String>) -> ApiResult<RuntimeOutcome> {
    if stdout.contains("Not logged in") || stdout.contains("cursor login") {
        return Err(ApiError::bad_gateway(
            "Cursor CLI is not logged in for the aura-os-server process. Authenticate Cursor on this machine before using local login.",
        ));
    }

    let event = parse_json_output(stdout).or_else(|| parse_jsonl(stdout).into_iter().last());
    let text = event
        .as_ref()
        .and_then(|value| {
            value
                .get("result")
                .and_then(Value::as_str)
                .or_else(|| value.get("text").and_then(Value::as_str))
                .or_else(|| value.get("message").and_then(Value::as_str))
        })
        .unwrap_or_else(|| stdout.trim())
        .to_string();
    let model = fallback_model.unwrap_or_else(|| "cursor".to_string());

    ensure_non_empty_external_text(
        "Cursor",
        RuntimeOutcome {
            text,
            usage: SessionUsage {
                model,
                provider: "cursor".to_string(),
                ..Default::default()
            },
        },
    )
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

fn parse_json_output(stdout: &str) -> Option<Value> {
    serde_json::from_str::<Value>(stdout.trim()).ok()
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

fn normalize_external_tool_name(name: &str) -> String {
    name.strip_prefix("mcp__aura__").unwrap_or(name).to_string()
}

fn codex_agent_message_text(event: &Value) -> Option<String> {
    event
        .get("item")
        .filter(|item| item.get("type") == Some(&Value::String("agent_message".to_string())))
        .and_then(|item| item.get("text"))
        .and_then(Value::as_str)
        .map(str::to_string)
}

fn codex_tool_use_start(event: &Value) -> Option<aura_os_link::ToolUseStart> {
    let item = event.get("item")?;
    if item.get("type") != Some(&Value::String("mcp_tool_call".to_string()))
        || event.get("type") != Some(&Value::String("item.started".to_string()))
    {
        return None;
    }

    Some(aura_os_link::ToolUseStart {
        id: item.get("id")?.as_str()?.to_string(),
        name: item.get("tool")?.as_str()?.to_string(),
    })
}

fn codex_tool_result(event: &Value) -> Option<aura_os_link::ToolResultMsg> {
    let item = event.get("item")?;
    if item.get("type") != Some(&Value::String("mcp_tool_call".to_string()))
        || event.get("type") != Some(&Value::String("item.completed".to_string()))
    {
        return None;
    }

    let status = item
        .get("status")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let is_error = status != "completed";
    let result = if is_error {
        item.get("error")
            .and_then(|error| error.get("message"))
            .and_then(Value::as_str)
            .unwrap_or("MCP tool call failed")
            .to_string()
    } else {
        codex_tool_content_text(item.get("result"))
    };

    Some(aura_os_link::ToolResultMsg {
        name: item.get("tool")?.as_str()?.to_string(),
        result,
        is_error,
        tool_use_id: item.get("id").and_then(Value::as_str).map(str::to_string),
    })
}

fn codex_tool_content_text(result: Option<&Value>) -> String {
    result
        .and_then(|value| value.get("content"))
        .and_then(Value::as_array)
        .map(|content| {
            content
                .iter()
                .filter_map(|block| block.get("text").and_then(Value::as_str))
                .collect::<Vec<_>>()
                .join("\n")
        })
        .filter(|text| !text.trim().is_empty())
        .unwrap_or_else(|| "{}".to_string())
}

fn codex_tool_call_payload(event: &Value, id: &str, name: &str) -> Option<Value> {
    let mut input = event
        .get("item")
        .and_then(|item| item.get("arguments"))
        .cloned()
        .unwrap_or_else(|| serde_json::json!({}));
    if let Some(object) = input.as_object_mut() {
        if let Some(markdown_contents) = object.get("markdownContents").cloned() {
            object
                .entry("markdown_contents".to_string())
                .or_insert(markdown_contents);
        }
    }
    Some(serde_json::json!({
        "id": id,
        "name": name,
        "input": input,
    }))
}

fn parse_tool_result_json(result: &str) -> Option<Value> {
    serde_json::from_str::<Value>(result).ok()
}

fn claude_tool_use_starts(event: &Value) -> Vec<aura_os_link::ToolUseStart> {
    let Some(content) = event
        .get("message")
        .and_then(|message| message.get("content"))
        .and_then(Value::as_array)
    else {
        return Vec::new();
    };

    content
        .iter()
        .filter(|block| block.get("type") == Some(&Value::String("tool_use".to_string())))
        .filter_map(|block| {
            let name = block.get("name").and_then(Value::as_str)?;
            let normalized = normalize_external_tool_name(name);
            if !is_external_tool_name(&normalized) {
                return None;
            }
            Some(aura_os_link::ToolUseStart {
                id: block.get("id")?.as_str()?.to_string(),
                name: normalized,
            })
        })
        .collect()
}

fn claude_tool_call_payload(event: &Value, id: &str, name: &str) -> Option<Value> {
    let block = event
        .get("message")
        .and_then(|message| message.get("content"))
        .and_then(Value::as_array)?
        .iter()
        .find(|block| {
            block.get("type") == Some(&Value::String("tool_use".to_string()))
                && block.get("id").and_then(Value::as_str) == Some(id)
        })?;
    let mut input = block
        .get("input")
        .cloned()
        .unwrap_or_else(|| serde_json::json!({}));
    if let Some(object) = input.as_object_mut() {
        if let Some(markdown_contents) = object.get("markdownContents").cloned() {
            object
                .entry("markdown_contents".to_string())
                .or_insert(markdown_contents);
        }
    }
    Some(serde_json::json!({
        "id": id,
        "name": name,
        "input": input,
    }))
}

fn claude_tool_results(
    event: &Value,
    tool_names_by_id: &HashMap<String, String>,
) -> Vec<aura_os_link::ToolResultMsg> {
    let Some(content) = event
        .get("message")
        .and_then(|message| message.get("content"))
        .and_then(Value::as_array)
    else {
        return Vec::new();
    };

    content
        .iter()
        .filter(|block| block.get("type") == Some(&Value::String("tool_result".to_string())))
        .filter_map(|block| {
            let tool_use_id = block.get("tool_use_id").and_then(Value::as_str)?;
            let name = tool_names_by_id.get(tool_use_id)?.clone();
            Some(aura_os_link::ToolResultMsg {
                name,
                result: claude_tool_result_content(block.get("content")),
                is_error: block
                    .get("is_error")
                    .and_then(Value::as_bool)
                    .unwrap_or(false),
                tool_use_id: Some(tool_use_id.to_string()),
            })
        })
        .collect()
}

fn claude_tool_result_content(content: Option<&Value>) -> String {
    match content {
        Some(Value::String(text)) => text.to_string(),
        Some(Value::Array(blocks)) => blocks
            .iter()
            .filter_map(|block| block.get("text").and_then(Value::as_str))
            .collect::<Vec<_>>()
            .join("\n"),
        _ => String::new(),
    }
}

fn claude_result_text(event: &Value) -> Option<String> {
    if event.get("type") != Some(&Value::String("result".to_string())) {
        return None;
    }
    event
        .get("result")
        .and_then(Value::as_str)
        .map(str::to_string)
}

fn claude_result_error(event: &Value) -> Option<String> {
    if event.get("type") != Some(&Value::String("result".to_string())) {
        return None;
    }
    if !event
        .get("is_error")
        .and_then(Value::as_bool)
        .unwrap_or(false)
    {
        return None;
    }
    let message = event
        .get("result")
        .and_then(Value::as_str)
        .unwrap_or("Claude execution failed");
    Some(if message.contains("Not logged in") {
        "Claude Code is not logged in for the aura-os-server process. Run `claude` and complete `/login` in the same host environment, or switch this agent to org integration.".to_string()
    } else {
        message.to_string()
    })
}

fn claude_result_usage(event: &Value, fallback_model: String) -> Option<SessionUsage> {
    if event.get("type") != Some(&Value::String("result".to_string())) {
        return None;
    }
    let usage = event.get("usage").cloned().unwrap_or(Value::Null);
    let model = event
        .get("message")
        .and_then(|message| message.get("model"))
        .and_then(Value::as_str)
        .map(sanitize_model)
        .filter(|value| !value.is_empty())
        .unwrap_or(fallback_model);

    Some(SessionUsage {
        input_tokens: usage_number(&usage, "input_tokens"),
        output_tokens: usage_number(&usage, "output_tokens"),
        estimated_context_tokens: 0,
        cache_creation_input_tokens: usage_number(&usage, "cache_creation_input_tokens"),
        cache_read_input_tokens: usage_number(&usage, "cache_read_input_tokens"),
        cumulative_input_tokens: usage_number(&usage, "input_tokens"),
        cumulative_output_tokens: usage_number(&usage, "output_tokens"),
        cumulative_cache_creation_input_tokens: usage_number(&usage, "cache_creation_input_tokens"),
        cumulative_cache_read_input_tokens: usage_number(&usage, "cache_read_input_tokens"),
        context_utilization: 0.0,
        model,
        provider: "anthropic".to_string(),
    })
}

fn codex_turn_usage(event: &Value, model: String) -> Option<SessionUsage> {
    if event.get("type") != Some(&Value::String("turn.completed".to_string())) {
        return None;
    }
    let usage = event.get("usage").cloned().unwrap_or(Value::Null);
    Some(SessionUsage {
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
        model,
        provider: "openai".to_string(),
    })
}

async fn build_external_prompt(
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
    if supports_external_project_tools(&agent.adapter_type) && project_id.is_some() {
        prompt.push_str("Aura control-plane tools:\n");
        for tool in active_workspace_tools(state, agent).await {
            prompt.push_str("- ");
            prompt.push_str(&tool.prompt_signature);
            prompt.push_str(": ");
            prompt.push_str(&tool.description);
            prompt.push_str(".\n");
        }
        prompt.push_str("When the user asks to create, save, or persist a project spec or task, use these tools directly instead of only drafting prose or writing a file.\n");
        prompt.push_str("Spec creation and task creation are separate steps. Do not create tasks in the same turn as creating specs.\n");
        prompt.push_str("When the user asks to inspect, update, or delete existing Aura project state, use the matching control-plane tool instead of only describing the change in prose.\n");
        prompt.push_str("When the user asks to move an existing task between states, use transition_task or update_task(status=...) instead of describing the change in prose.\n");
        prompt.push_str("When the user asks to retry a task, use retry_task. When the user asks to start or run a task through Aura OS, use run_task.\n");
        prompt.push_str("When the user asks to control the project loop itself, use start_dev_loop, pause_dev_loop, stop_dev_loop, or get_loop_status.\n");
        prompt.push_str("When the user asks to use a connected org system like GitHub, Linear, Slack, or Notion, use the matching Aura tool if it is available instead of only drafting prose.\n");
        prompt.push_str("After creating or transitioning tasks, stop and summarize what changed. Do not start implementation work unless the user explicitly asks for it.\n\n");
    }
    prompt.push_str("User request:\n");
    prompt.push_str(user_content.trim());
    prompt
}

#[cfg(test)]
mod tests {
    use super::{
        claude_tool_results, claude_tool_use_starts, codex_tool_result, codex_tool_use_start,
        codex_turn_usage, parse_cursor_output, parse_gemini_output, parse_opencode_output,
    };
    use crate::handlers::agents::workspace_tools::{
        shared_workspace_tools, WorkspaceToolSourceKind,
    };
    use serde_json::json;
    use std::collections::{HashMap, HashSet};

    #[test]
    fn codex_mcp_tool_events_map_to_protocol_messages() {
        let start = json!({
            "type": "item.started",
            "item": {
                "id": "item_1",
                "type": "mcp_tool_call",
                "tool": "create_spec",
                "arguments": {"title": "Spec"}
            }
        });
        let start_msg = codex_tool_use_start(&start).expect("tool start");
        assert_eq!(start_msg.id, "item_1");
        assert_eq!(start_msg.name, "create_spec");

        let done = json!({
            "type": "item.completed",
            "item": {
                "id": "item_1",
                "type": "mcp_tool_call",
                "tool": "create_spec",
                "status": "completed",
                "result": {
                    "content": [
                        {"type": "text", "text": "{\"spec_id\":\"spec-1\"}"}
                    ]
                }
            }
        });
        let result_msg = codex_tool_result(&done).expect("tool result");
        assert_eq!(result_msg.tool_use_id.as_deref(), Some("item_1"));
        assert_eq!(result_msg.name, "create_spec");
        assert_eq!(result_msg.result, "{\"spec_id\":\"spec-1\"}");
        assert!(!result_msg.is_error);
    }

    #[test]
    fn codex_turn_completed_maps_usage() {
        let event = json!({
            "type": "turn.completed",
            "usage": {
                "input_tokens": 10,
                "output_tokens": 4,
                "cached_input_tokens": 3
            }
        });
        let usage = codex_turn_usage(&event, "codex".to_string()).expect("usage");
        assert_eq!(usage.input_tokens, 10);
        assert_eq!(usage.output_tokens, 4);
        assert_eq!(usage.cache_read_input_tokens, 3);
        assert_eq!(usage.provider, "openai");
    }

    #[test]
    fn codex_inline_env_uses_toml_inline_table_syntax() {
        let mut env = HashMap::new();
        env.insert("AURA_MCP_PROJECT_ID".to_string(), "proj-1".to_string());
        env.insert("AURA_MCP_JWT".to_string(), "secret".to_string());

        let rendered = super::codex_inline_env(&env);
        assert!(rendered.starts_with('{'));
        assert!(rendered.ends_with('}'));
        assert!(rendered.contains("AURA_MCP_PROJECT_ID=\"proj-1\""));
        assert!(rendered.contains("AURA_MCP_JWT=\"secret\""));
    }

    #[test]
    fn gemini_auth_error_maps_to_friendly_message() {
        let result = parse_gemini_output(
            "Please set an Auth method in your /Users/test/.gemini/settings.json or specify one of the following environment variables before running: GEMINI_API_KEY",
            Some("gemini-2.5-pro".to_string()),
        );
        assert!(result.is_err(), "expected auth failure");
        let error = result.err().expect("gemini auth error");

        assert!(format!("{error:?}").contains("Gemini CLI is not authenticated"));
    }

    #[test]
    fn opencode_plain_text_output_still_produces_a_result() {
        let outcome = parse_opencode_output(
            "hello from opencode",
            Some("openai/gpt-5.2-codex".to_string()),
        )
        .expect("parse opencode");

        assert_eq!(outcome.text, "hello from opencode");
        assert_eq!(outcome.usage.provider, "openai");
    }

    #[test]
    fn cursor_json_output_parses_result_text() {
        let outcome = parse_cursor_output(
            r#"{"result":"hello from cursor"}"#,
            Some("auto".to_string()),
        )
        .expect("parse cursor");

        assert_eq!(outcome.text, "hello from cursor");
        assert_eq!(outcome.usage.provider, "cursor");
    }

    #[test]
    fn claude_mcp_tool_events_map_to_protocol_messages() {
        let assistant = json!({
            "type": "assistant",
            "message": {
                "content": [
                    {
                        "type": "tool_use",
                        "id": "toolu_1",
                        "name": "mcp__aura__create_task",
                        "input": {
                            "spec_id": "spec-1",
                            "title": "Task 1",
                            "description": "Do it"
                        }
                    }
                ]
            }
        });
        let starts = claude_tool_use_starts(&assistant);
        assert_eq!(starts.len(), 1);
        assert_eq!(starts[0].id, "toolu_1");
        assert_eq!(starts[0].name, "create_task");

        let mut names = HashMap::new();
        names.insert("toolu_1".to_string(), "create_task".to_string());
        let user = json!({
            "type": "user",
            "message": {
                "content": [
                    {
                        "type": "tool_result",
                        "tool_use_id": "toolu_1",
                        "content": [
                            {"type": "text", "text": "{\"task\":{\"task_id\":\"task-1\"}}"}
                        ],
                        "is_error": false
                    }
                ]
            }
        });
        let results = claude_tool_results(&user, &names);
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].tool_use_id.as_deref(), Some("toolu_1"));
        assert_eq!(results[0].name, "create_task");
        assert_eq!(results[0].result, "{\"task\":{\"task_id\":\"task-1\"}}");
        assert!(!results[0].is_error);
    }

    #[test]
    fn shared_project_tool_manifest_has_unique_names_and_signatures() {
        let tools = shared_workspace_tools().iter().collect::<Vec<_>>();
        assert!(!tools.is_empty());

        let mut names = HashSet::new();
        let mut signatures = HashSet::new();
        for tool in tools {
            assert!(names.insert(tool.name.clone()), "duplicate tool name");
            assert!(
                signatures.insert(tool.prompt_signature.clone()),
                "duplicate prompt signature"
            );
            assert!(
                tool.input_schema.is_object(),
                "input schema must be an object"
            );
        }
    }

    #[test]
    fn workspace_tool_registry_tracks_source_kinds() {
        let tools = shared_workspace_tools();
        assert!(tools
            .iter()
            .any(|tool| tool.source_kind == WorkspaceToolSourceKind::AuraNative));
        assert!(tools
            .iter()
            .any(|tool| tool.source_kind == WorkspaceToolSourceKind::AppProvider));
        assert!(!tools
            .iter()
            .any(|tool| tool.source_kind == WorkspaceToolSourceKind::Mcp));
    }
}
