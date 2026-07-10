//! Org-integration metadata and secret resolution.

use aura_os_core::{OrgId, OrgIntegration, OrgIntegrationKind};
use aura_os_integrations::{
    platform_web_search_integration, platform_web_search_key_present, IntegrationsError,
    PLATFORM_BRAVE_KEY_ENV, PLATFORM_WEB_SEARCH_INTEGRATION_ID,
};
use aura_os_orgs::IntegrationSecretUpdate;
use serde_json::Value;
use tracing::warn;

use super::args::optional_string;
use crate::error::{ApiError, ApiResult};
use crate::state::AppState;

/// Metadata and credential selected for one tool invocation.
pub(crate) struct ResolvedOrgIntegration {
    pub(super) metadata: OrgIntegration,
    pub(super) secret: String,
}

pub(super) async fn resolve_org_integration(
    state: &AppState,
    org_id: &OrgId,
    provider: &str,
    user_id: Option<&str>,
    args: &Value,
) -> ApiResult<ResolvedOrgIntegration> {
    resolve_org_integration_inner(state, org_id, provider, user_id, args, false).await
}

/// Trusted tools fail closed during canonical service outages instead of using
/// possibly stale local credentials. Local development without a canonical
/// client still resolves from the local store.
pub(super) async fn resolve_trusted_org_integration(
    state: &AppState,
    org_id: &OrgId,
    provider: &str,
    user_id: Option<&str>,
    args: &Value,
) -> ApiResult<ResolvedOrgIntegration> {
    resolve_org_integration_inner(state, org_id, provider, user_id, args, true).await
}

async fn resolve_org_integration_inner(
    state: &AppState,
    org_id: &OrgId,
    provider: &str,
    user_id: Option<&str>,
    args: &Value,
    fail_on_canonical_outage: bool,
) -> ApiResult<ResolvedOrgIntegration> {
    let integration_id = optional_string(args, &["integration_id", "integrationId"]);
    let integration = pick_org_integration_metadata(
        state,
        org_id,
        provider,
        user_id,
        integration_id,
        fail_on_canonical_outage,
    )
    .await?;
    let secret =
        load_org_integration_secret(state, org_id, &integration, fail_on_canonical_outage).await?;

    Ok(ResolvedOrgIntegration {
        metadata: integration,
        secret,
    })
}

async fn pick_org_integration_metadata(
    state: &AppState,
    org_id: &OrgId,
    provider: &str,
    user_id: Option<&str>,
    integration_id: Option<String>,
    fail_on_canonical_outage: bool,
) -> ApiResult<OrgIntegration> {
    if provider == "brave_search"
        && integration_id.as_deref() == Some(PLATFORM_WEB_SEARCH_INTEGRATION_ID)
    {
        return Ok(platform_web_search_integration(org_id));
    }

    let allow_platform_fallback =
        integration_id.is_none() && provider == "brave_search" && platform_web_search_key_present();
    let canonical_integration = load_canonical_org_integration(
        state,
        org_id,
        provider,
        user_id,
        integration_id.as_deref(),
        fail_on_canonical_outage,
    )
    .await?;
    if let Some(integration) = canonical_integration {
        return Ok(integration);
    }
    if allow_platform_fallback && fail_on_canonical_outage && state.integrations_client.is_some() {
        return Ok(platform_web_search_integration(org_id));
    }
    let resolved = if let Some(integration_id) = integration_id {
        load_shadow_org_integration_by_id(state, org_id, provider, user_id, &integration_id)
    } else {
        load_shadow_org_integration_for_provider(state, org_id, provider, user_id)
    };
    match resolved {
        Ok(integration) => Ok(integration),
        Err(_) if allow_platform_fallback => Ok(platform_web_search_integration(org_id)),
        Err(error) => Err(error),
    }
}

async fn load_org_integration_secret(
    state: &AppState,
    org_id: &OrgId,
    integration: &OrgIntegration,
    fail_on_canonical_outage: bool,
) -> ApiResult<String> {
    if integration.integration_id == PLATFORM_WEB_SEARCH_INTEGRATION_ID {
        return load_platform_web_search_secret();
    }

    let Some(client) = &state.integrations_client else {
        return load_shadow_secret(state, &integration.integration_id);
    };

    match client
        .get_integration_secret(org_id, &integration.integration_id)
        .await
    {
        Ok(secret) => {
            if let Some(secret) = secret.filter(|value| !value.trim().is_empty()) {
                Ok(secret)
            } else {
                warn!(
                    %org_id,
                    integration_id = %integration.integration_id,
                    provider = %integration.provider,
                    "canonical aura-integrations secret missing or empty; falling back to compatibility-only local shadow for org tool dispatch"
                );
                load_shadow_secret(state, &integration.integration_id)
            }
        }
        Err(error) => {
            if fail_on_canonical_outage && is_canonical_outage(&error) {
                warn!(
                    %org_id,
                    integration_id = %integration.integration_id,
                    provider = %integration.provider,
                    error = %error,
                    "canonical aura-integrations secret fetch failed for a trusted tool action; returning 503 instead of using the local shadow"
                );
                return Err(integrations_service_down_error());
            }
            warn!(
                %org_id,
                integration_id = %integration.integration_id,
                provider = %integration.provider,
                error = %error,
                "failed to load canonical aura-integrations secret; falling back to compatibility-only local shadow for org tool dispatch"
            );
            load_shadow_secret(state, &integration.integration_id)
        }
    }
}

fn is_canonical_outage(error: &IntegrationsError) -> bool {
    !matches!(error, IntegrationsError::Server { status: 404, .. })
}

fn integrations_service_down_error() -> (axum::http::StatusCode, axum::Json<ApiError>) {
    ApiError::service_unavailable(
        "the integrations service is unavailable; trusted tool execution was not attempted",
    )
}

fn load_platform_web_search_secret() -> ApiResult<String> {
    std::env::var(PLATFORM_BRAVE_KEY_ENV)
        .ok()
        .map(|key| key.trim().to_string())
        .filter(|key| !key.is_empty())
        .ok_or_else(|| ApiError::bad_request("platform web search is not configured"))
}

fn load_shadow_secret(state: &AppState, integration_id: &str) -> ApiResult<String> {
    state
        .org_service
        .get_integration_secret(integration_id)
        .map_err(|e| ApiError::internal(format!("loading integration secret: {e}")))?
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| ApiError::bad_request("selected integration is missing a stored secret"))
}

async fn load_canonical_org_integration(
    state: &AppState,
    org_id: &OrgId,
    provider: &str,
    user_id: Option<&str>,
    integration_id: Option<&str>,
    fail_on_canonical_outage: bool,
) -> ApiResult<Option<OrgIntegration>> {
    let Some(client) = &state.integrations_client else {
        return Ok(None);
    };

    if let Some(integration_id) = integration_id {
        return load_canonical_by_id(
            state,
            client,
            org_id,
            provider,
            user_id,
            integration_id,
            fail_on_canonical_outage,
        )
        .await;
    }

    load_canonical_by_provider(
        state,
        client,
        org_id,
        provider,
        user_id,
        fail_on_canonical_outage,
    )
    .await
}

async fn load_canonical_by_id(
    state: &AppState,
    client: &aura_os_integrations::IntegrationsClient,
    org_id: &OrgId,
    provider: &str,
    user_id: Option<&str>,
    integration_id: &str,
    fail_on_canonical_outage: bool,
) -> ApiResult<Option<OrgIntegration>> {
    match client
        .get_integration_internal(org_id, integration_id)
        .await
    {
        Ok(integration) => {
            let integration = validate_org_tool_integration(integration, provider, user_id)?;
            if let Err(error) = state
                .org_service
                .sync_integration_shadow(&integration, IntegrationSecretUpdate::Preserve)
            {
                warn!(
                    %org_id,
                    integration_id = %integration.integration_id,
                    error = %error,
                    "failed to sync compatibility-only local integration shadow after canonical org tool lookup"
                );
            }
            Ok(Some(integration))
        }
        Err(IntegrationsError::Server { status: 404, .. }) => {
            Err(ApiError::not_found("integration not found"))
        }
        Err(error) => {
            if fail_on_canonical_outage && is_canonical_outage(&error) {
                warn!(
                    %org_id,
                    integration_id,
                    provider,
                    error = %error,
                    "canonical aura-integrations metadata fetch failed for a trusted tool action; returning 503 instead of using the local shadow"
                );
                return Err(integrations_service_down_error());
            }
            warn!(
                %org_id,
                integration_id,
                provider,
                error = %error,
                "failed to load canonical aura-integrations metadata for org tool dispatch; falling back to compatibility-only local shadow"
            );
            Ok(None)
        }
    }
}

async fn load_canonical_by_provider(
    state: &AppState,
    client: &aura_os_integrations::IntegrationsClient,
    org_id: &OrgId,
    provider: &str,
    user_id: Option<&str>,
    fail_on_canonical_outage: bool,
) -> ApiResult<Option<OrgIntegration>> {
    match client.list_integrations_internal(org_id).await {
        Ok(integrations) => {
            if let Err(error) = state
                .org_service
                .sync_integrations_shadow(org_id, &integrations)
            {
                warn!(
                    %org_id,
                    error = %error,
                    "failed to sync compatibility-only local integration shadow after canonical org tool list"
                );
            }
            let integration = integrations
                .into_iter()
                .find(|integration| matches_org_tool_provider(integration, provider, user_id));
            match integration {
                Some(integration) => Ok(Some(integration)),
                // Aura-funded search does not require an org integration.
                None if provider == "brave_search" && platform_web_search_key_present() => Ok(None),
                None => Err(ApiError::bad_request(format!(
                    "no enabled `{provider}` org integration with a key is available"
                ))),
            }
        }
        Err(error) => {
            if fail_on_canonical_outage && is_canonical_outage(&error) {
                warn!(
                    %org_id,
                    provider,
                    error = %error,
                    "canonical aura-integrations list fetch failed for a trusted tool action; returning 503 instead of using the local shadow"
                );
                return Err(integrations_service_down_error());
            }
            warn!(
                %org_id,
                provider,
                error = %error,
                "failed to load canonical aura-integrations list for org tool dispatch; falling back to compatibility-only local shadow"
            );
            Ok(None)
        }
    }
}

fn load_shadow_org_integration_by_id(
    state: &AppState,
    org_id: &OrgId,
    provider: &str,
    user_id: Option<&str>,
    integration_id: &str,
) -> ApiResult<OrgIntegration> {
    let integration = state
        .org_service
        .get_integration(org_id, integration_id)
        .map_err(|e| ApiError::internal(format!("loading org integration: {e}")))?
        .ok_or_else(|| ApiError::not_found("integration not found"))?;
    validate_org_tool_integration(integration, provider, user_id)
}

fn load_shadow_org_integration_for_provider(
    state: &AppState,
    org_id: &OrgId,
    provider: &str,
    user_id: Option<&str>,
) -> ApiResult<OrgIntegration> {
    state
        .org_service
        .list_integrations(org_id)
        .map_err(|e| ApiError::internal(format!("listing org integrations: {e}")))?
        .into_iter()
        .find(|integration| matches_org_tool_provider(integration, provider, user_id))
        .ok_or_else(|| {
            ApiError::bad_request(format!(
                "no enabled `{provider}` org integration with a key is available"
            ))
        })
}

fn validate_org_tool_integration(
    integration: OrgIntegration,
    provider: &str,
    user_id: Option<&str>,
) -> ApiResult<OrgIntegration> {
    if integration.provider != provider {
        return Err(ApiError::bad_request(format!(
            "integration `{}` uses provider `{}` instead of `{provider}`",
            integration.name, integration.provider
        )));
    }
    if integration.kind != OrgIntegrationKind::WorkspaceIntegration {
        return Err(ApiError::bad_request(format!(
            "integration `{}` is not a workspace integration",
            integration.name
        )));
    }
    if !integration.enabled {
        return Err(ApiError::bad_request(format!(
            "integration `{}` is disabled",
            integration.name
        )));
    }
    if !google_integration_visible_to_user(&integration, provider, user_id) {
        return Err(ApiError::not_found("integration not found"));
    }
    Ok(integration)
}

fn validate_mcp_tool_integration(integration: OrgIntegration) -> ApiResult<OrgIntegration> {
    if integration.kind != OrgIntegrationKind::McpServer {
        return Err(ApiError::bad_request(format!(
            "integration `{}` is not an MCP server integration",
            integration.name
        )));
    }
    if !integration.enabled {
        return Err(ApiError::bad_request(format!(
            "integration `{}` is disabled",
            integration.name
        )));
    }
    Ok(integration)
}

pub(super) async fn resolve_mcp_server_integration(
    state: &AppState,
    org_id: &OrgId,
    integration_id: &str,
) -> ApiResult<ResolvedOrgIntegration> {
    let integration = load_mcp_integration_metadata(state, org_id, integration_id).await?;
    let secret = load_mcp_integration_secret(state, org_id, integration_id).await?;

    Ok(ResolvedOrgIntegration {
        metadata: integration,
        secret,
    })
}

async fn load_mcp_integration_metadata(
    state: &AppState,
    org_id: &OrgId,
    integration_id: &str,
) -> ApiResult<OrgIntegration> {
    let Some(client) = &state.integrations_client else {
        return load_local_mcp_integration(state, org_id, integration_id);
    };

    match client
        .get_integration_internal(org_id, integration_id)
        .await
    {
        Ok(integration) => {
            let integration = validate_mcp_tool_integration(integration)?;
            if let Err(error) = state
                .org_service
                .sync_integration_shadow(&integration, IntegrationSecretUpdate::Preserve)
            {
                warn!(
                    %org_id,
                    integration_id = %integration.integration_id,
                    error = %error,
                    "failed to sync compatibility-only local MCP integration shadow after canonical lookup"
                );
            }
            Ok(integration)
        }
        Err(IntegrationsError::Server { status: 404, .. }) => {
            Err(ApiError::not_found("integration not found"))
        }
        Err(error) => {
            warn!(
                %org_id,
                integration_id,
                error = %error,
                "failed to load canonical aura-integrations MCP metadata; falling back to compatibility-only local shadow"
            );
            load_local_mcp_integration(state, org_id, integration_id)
        }
    }
}

fn load_local_mcp_integration(
    state: &AppState,
    org_id: &OrgId,
    integration_id: &str,
) -> ApiResult<OrgIntegration> {
    validate_mcp_tool_integration(
        state
            .org_service
            .get_integration(org_id, integration_id)
            .map_err(|e| ApiError::internal(format!("loading org integration: {e}")))?
            .ok_or_else(|| ApiError::not_found("integration not found"))?,
    )
}

async fn load_mcp_integration_secret(
    state: &AppState,
    org_id: &OrgId,
    integration_id: &str,
) -> ApiResult<String> {
    let resolved = if let Some(client) = &state.integrations_client {
        match client.get_integration_secret(org_id, integration_id).await {
            Ok(secret) => {
                let secret = secret.filter(|value| !value.trim().is_empty());
                if secret.is_none() {
                    warn!(
                        %org_id,
                        integration_id,
                        "canonical aura-integrations MCP secret missing or empty; falling back to compatibility-only local shadow"
                    );
                }
                secret
            }
            Err(error) => {
                warn!(
                    %org_id,
                    integration_id,
                    error = %error,
                    "failed to load canonical aura-integrations MCP secret; falling back to compatibility-only local shadow"
                );
                None
            }
        }
    } else {
        None
    };
    let resolved = match resolved {
        Some(secret) => Some(secret),
        None => state
            .org_service
            .get_integration_secret(integration_id)
            .map_err(|e| ApiError::internal(format!("loading integration secret: {e}")))?
            .filter(|value| !value.trim().is_empty()),
    };
    Ok(resolved.unwrap_or_default())
}

fn matches_org_tool_provider(
    integration: &OrgIntegration,
    provider: &str,
    user_id: Option<&str>,
) -> bool {
    // The synthetic capability is selected explicitly or as a final fallback.
    integration.integration_id != PLATFORM_WEB_SEARCH_INTEGRATION_ID
        && integration.provider == provider
        && integration.has_secret
        && integration.enabled
        && integration.kind == OrgIntegrationKind::WorkspaceIntegration
        && google_integration_visible_to_user(integration, provider, user_id)
}

fn google_integration_visible_to_user(
    integration: &OrgIntegration,
    provider: &str,
    user_id: Option<&str>,
) -> bool {
    if provider != "google" {
        return true;
    }
    let Some(user_id) = user_id else {
        return false;
    };
    google_owner_user_id(integration.provider_config.as_ref())
        .map(|owner| owner == user_id)
        .unwrap_or(false)
}

fn google_owner_user_id(provider_config: Option<&Value>) -> Option<&str> {
    provider_config?
        .as_object()?
        .get("ownerUserId")?
        .as_str()
        .map(str::trim)
        .filter(|owner| !owner.is_empty())
}
