//! Org-integration metadata + secret resolution.
//!
//! Extracted from the previous monolithic `org_tools.rs`. The behaviour of
//! every helper is unchanged; the original [`resolve_org_integration`] body
//! has been split into a few focused helpers to stay under the per-function
//! line limit.

use aura_os_core::{OrgId, OrgIntegration, OrgIntegrationKind};
use aura_os_integrations::IntegrationsError;
use aura_os_orgs::IntegrationSecretUpdate;
use serde_json::Value;
use tracing::warn;

use super::args::optional_string;
use crate::error::{ApiError, ApiResult};
use crate::state::AppState;

pub(crate) struct ResolvedOrgIntegration {
    pub(super) metadata: OrgIntegration,
    pub(super) secret: String,
}

pub(super) async fn resolve_org_integration(
    state: &AppState,
    org_id: &OrgId,
    provider: &str,
    args: &Value,
) -> ApiResult<ResolvedOrgIntegration> {
    let integration_id = optional_string(args, &["integration_id", "integrationId"]);
    let integration =
        pick_org_integration_metadata(state, org_id, provider, integration_id).await?;
    let secret = load_org_integration_secret(state, org_id, &integration).await?;

    Ok(ResolvedOrgIntegration {
        metadata: integration,
        secret,
    })
}

async fn pick_org_integration_metadata(
    state: &AppState,
    org_id: &OrgId,
    provider: &str,
    integration_id: Option<String>,
) -> ApiResult<OrgIntegration> {
    if let Some(integration) =
        load_canonical_org_integration(state, org_id, provider, integration_id.as_deref()).await?
    {
        return Ok(integration);
    }
    if let Some(integration_id) = integration_id {
        return load_shadow_org_integration_by_id(state, org_id, provider, &integration_id);
    }
    load_shadow_org_integration_for_provider(state, org_id, provider)
}

async fn load_org_integration_secret(
    state: &AppState,
    org_id: &OrgId,
    integration: &OrgIntegration,
) -> ApiResult<String> {
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
    integration_id: Option<&str>,
) -> ApiResult<Option<OrgIntegration>> {
    let Some(client) = &state.integrations_client else {
        return Ok(None);
    };

    if let Some(integration_id) = integration_id {
        return load_canonical_by_id(state, client, org_id, provider, integration_id).await;
    }

    load_canonical_by_provider(state, client, org_id, provider).await
}

async fn load_canonical_by_id(
    state: &AppState,
    client: &aura_os_integrations::IntegrationsClient,
    org_id: &OrgId,
    provider: &str,
    integration_id: &str,
) -> ApiResult<Option<OrgIntegration>> {
    match client
        .get_integration_internal(org_id, integration_id)
        .await
    {
        Ok(integration) => {
            let integration = validate_org_tool_integration(integration, provider)?;
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
                .find(|integration| matches_org_tool_provider(integration, provider))
                .ok_or_else(|| {
                    ApiError::bad_request(format!(
                        "no enabled `{provider}` org integration with a key is available"
                    ))
                })?;
            Ok(Some(integration))
        }
        Err(error) => {
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
    integration_id: &str,
) -> ApiResult<OrgIntegration> {
    let integration = state
        .org_service
        .get_integration(org_id, integration_id)
        .map_err(|e| ApiError::internal(format!("loading org integration: {e}")))?
        .ok_or_else(|| ApiError::not_found("integration not found"))?;
    validate_org_tool_integration(integration, provider)
}

fn load_shadow_org_integration_for_provider(
    state: &AppState,
    org_id: &OrgId,
    provider: &str,
) -> ApiResult<OrgIntegration> {
    state
        .org_service
        .list_integrations(org_id)
        .map_err(|e| ApiError::internal(format!("listing org integrations: {e}")))?
        .into_iter()
        .find(|integration| matches_org_tool_provider(integration, provider))
        .ok_or_else(|| {
            ApiError::bad_request(format!(
                "no enabled `{provider}` org integration with a key is available"
            ))
        })
}

fn validate_org_tool_integration(
    integration: OrgIntegration,
    provider: &str,
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
            Ok(secret) => secret.filter(|value| !value.trim().is_empty()),
            Err(error) => {
                warn!(
                    %org_id,
                    integration_id,
                    error = %error,
                    "failed to load canonical aura-integrations MCP secret"
                );
                None
            }
        }
    } else {
        state
            .org_service
            .get_integration_secret(integration_id)
            .map_err(|e| ApiError::internal(format!("loading integration secret: {e}")))?
            .filter(|value| !value.trim().is_empty())
    };
    Ok(resolved.unwrap_or_default())
}

fn matches_org_tool_provider(integration: &OrgIntegration, provider: &str) -> bool {
    integration.provider == provider
        && integration.has_secret
        && integration.enabled
        && integration.kind == OrgIntegrationKind::WorkspaceIntegration
}
