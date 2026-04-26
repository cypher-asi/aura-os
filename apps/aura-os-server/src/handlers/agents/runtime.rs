use std::time::Duration;

use axum::extract::{Path, State};
use axum::Json;
use tokio::time::timeout;

use aura_os_core::{Agent, AgentId, OrgIntegration};
use aura_os_harness::{
    HarnessInbound, HarnessOutbound, SessionConfig, SessionProviderConfig, SessionUsage,
    UserMessage,
};

use crate::dto::AgentRuntimeTestResponse;
use crate::error::{ApiError, ApiResult};
use crate::handlers::agents::workspace_tools::{
    installed_workspace_app_tools, installed_workspace_integrations_for_org_with_token,
};
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

    if agent.adapter_type != "aura_harness" {
        return Err(ApiError::bad_request(format!(
            "adapter `{}` is no longer supported; only `aura_harness` agents can be tested",
            agent.adapter_type
        )));
    }

    let integration = resolve_integration(&state, &agent, &jwt).await?;
    let model = effective_model(&agent, integration.as_ref(), None);

    let outcome =
        run_harness_test(&state, &agent, &jwt, model.clone(), integration.as_ref()).await?;

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
    auth_source: &str,
    integration: Option<&ResolvedIntegration>,
    model: Option<&str>,
) -> ApiResult<Option<SessionProviderConfig>> {
    if auth_source == "aura_managed" {
        let default_model = model
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string);
        return Ok(Some(SessionProviderConfig {
            provider: "anthropic".to_string(),
            routing_mode: Some("proxy".to_string()),
            upstream_provider_family: harness_upstream_provider_family(model),
            api_key: None,
            base_url: None,
            default_model,
            fallback_model: None,
            prompt_caching_enabled: Some(true),
        }));
    }

    let Some(integration) = integration else {
        return Ok(None);
    };

    match integration.metadata.provider.as_str() {
        "anthropic" => Ok(Some(SessionProviderConfig {
            provider: "anthropic".to_string(),
            routing_mode: Some("direct".to_string()),
            upstream_provider_family: None,
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

fn harness_upstream_provider_family(model: Option<&str>) -> Option<String> {
    let model = model?.trim().to_ascii_lowercase();
    if model.is_empty() {
        return None;
    }

    if model.starts_with("aura-claude") || model.starts_with("claude") {
        Some("anthropic".to_string())
    } else if model.starts_with("aura-kimi")
        || model.starts_with("aura-deepseek")
        || model.starts_with("aura-oss")
        || model.starts_with("aura-qwen")
    {
        Some("fireworks".to_string())
    } else if model.starts_with("aura-gpt")
        || model.starts_with("aura-o")
        || model.starts_with("gpt")
        || model.starts_with("o1")
        || model.starts_with("o3")
        || model.starts_with("o4")
    {
        Some("openai".to_string())
    } else {
        None
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
        provider_config: build_harness_provider_config(
            &agent.auth_source,
            integration,
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

#[cfg(test)]
mod tests {
    use super::harness_upstream_provider_family;

    #[test]
    fn harness_upstream_provider_family_maps_aura_managed_models() {
        assert_eq!(
            harness_upstream_provider_family(Some("aura-gpt-5-4-mini")),
            Some("openai".to_string())
        );
        assert_eq!(
            harness_upstream_provider_family(Some("aura-claude-sonnet-4-6")),
            Some("anthropic".to_string())
        );
        assert_eq!(
            harness_upstream_provider_family(Some("aura-kimi-k2-5")),
            Some("fireworks".to_string())
        );
        assert_eq!(
            harness_upstream_provider_family(Some("unknown-model")),
            None
        );
    }
}
