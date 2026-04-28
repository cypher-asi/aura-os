use std::time::Duration;

use axum::extract::{Path, State};
use axum::Json;
use tokio::time::timeout;

use aura_os_core::{Agent, AgentId};
use aura_os_harness::{
    HarnessInbound, HarnessOutbound, SessionConfig, SessionModelOverrides, SessionUsage,
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

/// Build the per-session model overrides Aura OS sends to the harness.
///
/// LLM traffic always flows through aura-router with a per-request JWT;
/// there is no provider/routing toggle on the wire. Returns `None` when
/// no model is set, which tells the harness to use its env defaults
/// verbatim.
pub(crate) fn session_model_overrides(model: Option<&str>) -> Option<SessionModelOverrides> {
    let default_model = model
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)?;
    Some(SessionModelOverrides {
        default_model: Some(default_model),
        fallback_model: None,
        prompt_caching_enabled: Some(true),
    })
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
        provider_overrides: session_model_overrides(model.as_deref()),
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
    fn session_model_overrides_populates_default_model() {
        let overrides = session_model_overrides(Some("claude-sonnet-4"))
            .expect("model present should produce overrides");
        assert_eq!(overrides.default_model.as_deref(), Some("claude-sonnet-4"));
        assert_eq!(overrides.prompt_caching_enabled, Some(true));
    }

    #[test]
    fn session_model_overrides_returns_none_for_blank_model() {
        assert!(session_model_overrides(None).is_none());
        assert!(session_model_overrides(Some("")).is_none());
        assert!(session_model_overrides(Some("   ")).is_none());
    }
}
