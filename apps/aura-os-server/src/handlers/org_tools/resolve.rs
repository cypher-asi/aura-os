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

/// Reserved integration id for the gating-only synthetic platform Brave
/// integration (Spec 02). It carries no stored secret in canonical/shadow
/// storage; its secret is resolved cloud-side from the
/// `BRAVE_SEARCH_PLATFORM_KEY` environment variable as a *fallback* only.
///
/// Shared with Task 2.1 (synthetic injection/advertising). Kept here so the
/// soft-fallback precedence and the synthetic injection use a single source of
/// truth.
pub(crate) const PLATFORM_BRAVE_INTEGRATION_ID: &str = "platform-brave-search";

/// Environment variable that carries the platform-provided Brave Search key.
/// Cloud-only: it must never be written into a session payload or shipped to
/// desktop. Used solely as a soft fallback when no real org brave integration
/// resolves.
const PLATFORM_BRAVE_KEY_ENV: &str = "BRAVE_SEARCH_PLATFORM_KEY";

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

/// Resolve an org integration for a **trusted, cost-incurring** tool action.
///
/// A-H2: unlike [`resolve_org_integration`], this refuses to silently fall
/// back to a possibly-stale local shadow when the canonical aura-integrations
/// service is *configured but degraded* (transport failure / timeout / 5xx).
/// In that case it returns a 503 so a paid call is never executed with
/// possibly-stale credentials. A healthy "not found" (404) still yields the
/// existing 4xx, and the deliberate no-canonical-client local/dev mode still
/// resolves via shadow.
pub(super) async fn resolve_org_integration_fail_loud(
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
    fail_loud_on_service_down: bool,
) -> ApiResult<ResolvedOrgIntegration> {
    let integration_id = optional_string(args, &["integration_id", "integrationId"]);
    let integration = pick_org_integration_metadata(
        state,
        org_id,
        provider,
        user_id,
        integration_id,
        fail_loud_on_service_down,
    )
    .await?;
    let secret =
        load_org_integration_secret(state, org_id, &integration, fail_loud_on_service_down).await?;

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
    fail_loud_on_service_down: bool,
) -> ApiResult<OrgIntegration> {
    if let Some(integration) = load_canonical_org_integration(
        state,
        org_id,
        provider,
        user_id,
        integration_id.as_deref(),
        fail_loud_on_service_down,
    )
    .await?
    {
        return Ok(integration);
    }
    if let Some(integration_id) = integration_id {
        return load_shadow_org_integration_by_id(
            state,
            org_id,
            provider,
            user_id,
            &integration_id,
        );
    }
    load_shadow_org_integration_for_provider(state, org_id, provider, user_id)
}

async fn load_org_integration_secret(
    state: &AppState,
    org_id: &OrgId,
    integration: &OrgIntegration,
    fail_loud_on_service_down: bool,
) -> ApiResult<String> {
    // Soft-fallback (Spec 02 §9): the reserved synthetic platform brave
    // integration carries no stored credential in canonical/shadow storage.
    // Its key is resolved cloud-side from the platform env var, and only ever
    // reached when no *real* org brave integration resolved first — a real
    // `enabled && has_secret` brave provider match always wins the selection
    // in `pick_org_integration_metadata`/`load_canonical_by_provider`, so this
    // branch is a fallback, never an override.
    if integration.integration_id == PLATFORM_BRAVE_INTEGRATION_ID {
        return load_platform_brave_secret();
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
            // A-H2: a degraded canonical service must not silently fall back to
            // a possibly-stale shadow on the trusted cost-incurring path.
            if fail_loud_on_service_down
                && classify_integrations_error(&error) == CanonicalFetchFailure::ServiceDown
            {
                warn!(
                    %org_id,
                    integration_id = %integration.integration_id,
                    provider = %integration.provider,
                    error = %error,
                    "canonical aura-integrations secret fetch failed for a trusted tool action; failing loud (503) instead of using a possibly-stale local shadow"
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

/// Classification of a canonical aura-integrations fetch failure.
///
/// A-H2: for cost-incurring trusted tool actions we must distinguish a
/// degraded canonical service (transport failure / timeout / 5xx) from a
/// genuine "not found" so we can fail loud (503) instead of silently
/// executing a paid call with possibly-stale local-shadow credentials.
#[derive(Clone, Copy, PartialEq, Eq)]
enum CanonicalFetchFailure {
    /// 404 / not-found — a definite negative answer from a healthy service.
    NotFound,
    /// Transport error, timeout, or 5xx — the service itself is degraded.
    ServiceDown,
}

fn classify_integrations_error(error: &IntegrationsError) -> CanonicalFetchFailure {
    match error {
        IntegrationsError::Server { status, .. } if *status == 404 => {
            CanonicalFetchFailure::NotFound
        }
        // Any non-404 server status (notably 5xx) is treated as a degraded
        // service for the fail-loud path. Other client errors (e.g. 4xx other
        // than 404) are rare here and erring toward fail-loud is the safe
        // choice for a cost-incurring trusted call.
        IntegrationsError::Server { .. } => CanonicalFetchFailure::ServiceDown,
        // Transport errors, timeouts, decode failures, etc.
        _ => CanonicalFetchFailure::ServiceDown,
    }
}

fn integrations_service_down_error() -> (axum::http::StatusCode, axum::Json<ApiError>) {
    ApiError::service_unavailable(
        "the integrations service is unavailable; refusing to run a trusted tool action with possibly-stale credentials",
    )
}

/// Resolve the platform-provided Brave Search key from the environment.
///
/// Cloud-only soft fallback for the reserved synthetic platform brave
/// integration (Spec 02). When `BRAVE_SEARCH_PLATFORM_KEY` is unset or empty
/// the feature is effectively off, so we return a clean `ApiError` rather than
/// panicking — behaviour elsewhere is unchanged.
fn load_platform_brave_secret() -> ApiResult<String> {
    match std::env::var(PLATFORM_BRAVE_KEY_ENV) {
        Ok(key) if !key.trim().is_empty() => Ok(key),
        _ => Err(ApiError::bad_request(
            "platform brave search is not configured",
        )),
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
    user_id: Option<&str>,
    integration_id: Option<&str>,
    fail_loud_on_service_down: bool,
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
            fail_loud_on_service_down,
        )
        .await;
    }

    load_canonical_by_provider(
        state,
        client,
        org_id,
        provider,
        user_id,
        fail_loud_on_service_down,
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
    fail_loud_on_service_down: bool,
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
            // A-H2: degraded canonical service → fail loud on the trusted path.
            if fail_loud_on_service_down
                && classify_integrations_error(&error) == CanonicalFetchFailure::ServiceDown
            {
                warn!(
                    %org_id,
                    integration_id,
                    provider,
                    error = %error,
                    "canonical aura-integrations metadata fetch failed for a trusted tool action; failing loud (503) instead of using a possibly-stale local shadow"
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
    fail_loud_on_service_down: bool,
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
                .find(|integration| matches_org_tool_provider(integration, provider, user_id))
                .ok_or_else(|| {
                    ApiError::bad_request(format!(
                        "no enabled `{provider}` org integration with a key is available"
                    ))
                })?;
            Ok(Some(integration))
        }
        Err(error) => {
            // A-H2: degraded canonical service → fail loud on the trusted path.
            if fail_loud_on_service_down
                && classify_integrations_error(&error) == CanonicalFetchFailure::ServiceDown
            {
                warn!(
                    %org_id,
                    provider,
                    error = %error,
                    "canonical aura-integrations list fetch failed for a trusted tool action; failing loud (503) instead of using a possibly-stale local shadow"
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
    // Soft-fallback precedence (Spec 02 §9): the gating-only synthetic platform
    // brave integration must never win provider-based first-match selection, so
    // a real BYOK integration is always chosen when one exists. The synthetic
    // id is only resolved when selected explicitly by its reserved id, and even
    // then its key is a *fallback*, never an override of a real org key.
    integration.integration_id != PLATFORM_BRAVE_INTEGRATION_ID
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
