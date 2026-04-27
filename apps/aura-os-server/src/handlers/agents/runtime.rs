use std::time::Duration;

use axum::extract::{Path, State};
use axum::Json;
use tokio::time::timeout;

use aura_os_core::{Agent, AgentId, HarnessMode};
use aura_os_harness::{
    HarnessInbound, HarnessOutbound, SessionConfig, SessionProviderConfig, SessionUsage,
    UserMessage,
};

use crate::dto::AgentRuntimeTestResponse;
use crate::error::{ApiError, ApiResult};
use crate::handlers::agents::chat::errors::map_harness_error_to_api;
use crate::handlers::agents::workspace_tools::{
    installed_workspace_app_tools, installed_workspace_integrations_for_org_with_token,
};
use crate::state::{AppState, AuthJwt};

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

    if agent.adapter_type != "aura_harness" {
        return Err(ApiError::bad_request(format!(
            "adapter `{}` is no longer supported; only `aura_harness` agents can be tested",
            agent.adapter_type
        )));
    }

    let model = effective_model(&agent, None);

    let outcome = run_harness_test(&state, &agent, &jwt, model.clone()).await?;

    Ok(Json(AgentRuntimeTestResponse {
        ok: true,
        adapter_type: agent.adapter_type.clone(),
        environment: agent.environment.clone(),
        auth_source: agent.auth_source.clone(),
        provider: non_empty_string(&outcome.usage.provider),
        model: non_empty_string(&outcome.usage.model),
        integration_id: None,
        integration_name: None,
        message: outcome.text.trim().to_string(),
    }))
}

pub(crate) fn effective_model(agent: &Agent, override_model: Option<String>) -> Option<String> {
    override_model
        .filter(|value| !value.trim().is_empty())
        .or_else(|| {
            agent
                .default_model
                .clone()
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

pub(crate) fn build_harness_provider_config(
    harness_mode: HarnessMode,
    _auth_source: &str,
    _integration: Option<()>,
    model: Option<&str>,
) -> ApiResult<Option<SessionProviderConfig>> {
    if harness_mode == HarnessMode::Local {
        return Ok(None);
    }

    let default_model = model
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string);
    Ok(Some(SessionProviderConfig {
        provider: "aura_proxy".to_string(),
        routing_mode: Some("proxy".to_string()),
        upstream_provider_family: None,
        api_key: None,
        base_url: None,
        default_model,
        fallback_model: None,
        prompt_caching_enabled: Some(true),
    }))
}

async fn run_harness_test(
    state: &AppState,
    agent: &Agent,
    jwt: &str,
    model: Option<String>,
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
        agent_id: Some(aura_os_core::harness_agent_id(&agent.agent_id, None)),
        template_agent_id: Some(agent.agent_id.to_string()),
        agent_name: Some(agent.name.clone()),
        model: model.clone(),
        token: Some(jwt.to_string()),
        provider_config: build_harness_provider_config(
            agent.harness_mode(),
            &agent.auth_source,
            None,
            model.as_deref(),
        )?,
        installed_tools,
        installed_integrations,
        ..Default::default()
    };

    let session = state
        .harness_for(agent.harness_mode())
        .open_session(config)
        .await
        .map_err(|e| {
            // Phase 6: route through the shared `map_harness_error_to_api`
            // so upstream WS-slot exhaustion surfaces as the structured
            // 503 instead of a raw `bad_gateway`. Non-capacity transport
            // failures keep the original 502 mapping via the fallback.
            map_harness_error_to_api(&e, state.harness_ws_slots, |err| {
                ApiError::bad_gateway(format!("opening harness session failed: {err}"))
            })
        })?;
    let mut rx = session.events_tx.subscribe();
    session
        .commands_tx
        .try_send(HarnessInbound::UserMessage(UserMessage {
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn local_harness_omits_provider_config() {
        let config = build_harness_provider_config(
            HarnessMode::Local,
            "aura",
            None,
            Some("claude-sonnet-4"),
        )
        .expect("provider config should build");

        assert!(config.is_none());
    }

    #[test]
    fn swarm_harness_uses_aura_proxy_provider_config() {
        let config = build_harness_provider_config(
            HarnessMode::Swarm,
            "aura",
            None,
            Some("claude-sonnet-4"),
        )
        .expect("provider config should build")
        .expect("swarm should receive provider config");

        assert_eq!(config.provider, "aura_proxy");
        assert_eq!(config.routing_mode.as_deref(), Some("proxy"));
        assert_eq!(config.default_model.as_deref(), Some("claude-sonnet-4"));
    }
}
