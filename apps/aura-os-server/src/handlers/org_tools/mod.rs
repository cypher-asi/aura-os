//! Org-scoped tool dispatch.
//!
//! This module replaces the previous monolithic `handlers/org_tools.rs`.
//! Public surface is intentionally tiny: the three HTTP handlers below are
//! the only entry points, and every supporting helper is internal to this
//! module tree (see the explicit submodule listing).

use aura_os_core::OrgId;
use aura_os_integrations::app_provider_contract_by_tool;
use axum::extract::{Path, Query, State};
use axum::Json;
use serde::Deserialize;
use serde_json::{json, Value};

use crate::error::{ApiError, ApiResult};
use crate::handlers::agents::workspace_tools::installed_workspace_app_tool_catalog;
use crate::handlers::permissions::require_org_role;
use crate::handlers::trusted_mcp;
use crate::state::{AppState, AuthJwt, AuthSession};

mod args;
mod http;
mod hydrate;
mod list;
mod providers;
mod resolve;

#[cfg(test)]
mod tests;

use hydrate::hydrate_canonical_integration_shadow;
use list::list_org_integrations;
use providers::dispatch_app_provider_tool;
use resolve::resolve_mcp_server_integration;

#[derive(Deserialize)]
pub(crate) struct McpToolQuery {
    tool_name: String,
}

pub(crate) async fn call_tool(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    AuthSession(session): AuthSession,
    Path((org_id, tool_name)): Path<(OrgId, String)>,
    Json(args): Json<Value>,
) -> ApiResult<Json<Value>> {
    // All tool callbacks require at least org membership.
    require_org_role(&state, &org_id.to_string(), &jwt, &session, "member").await?;

    hydrate_canonical_integration_shadow(&state, &org_id, &jwt).await;

    let result = if tool_name == "list_org_integrations" {
        list_org_integrations(&state, &org_id, &args).await?
    } else if tool_name == "generate_image" {
        crate::handlers::generation::generate_image_tool(&state, &jwt, &args).await?
    } else if tool_name == "generate_3d_model" {
        crate::handlers::generation::generate_3d_tool(&state, &jwt, &args).await?
    } else if tool_name == "generate_video" {
        crate::handlers::generation::generate_video_tool(&state, &jwt, &args).await?
    } else {
        let contract = app_provider_contract_by_tool(&tool_name)
            .ok_or_else(|| ApiError::not_found(format!("unknown org tool `{tool_name}`")))?;
        dispatch_app_provider_tool(
            contract.kind,
            &state,
            &org_id,
            &jwt,
            &session.user_id,
            &tool_name,
            &args,
        )
        .await?
    };

    Ok(Json(result))
}

pub(super) async fn enforce_platform_web_search_quota(
    state: &AppState,
    access_token: &str,
    user_id: &str,
) -> ApiResult<()> {
    let limits = web_search_limits_for_user(state, access_token).await;
    if let Err(exceeded) = state
        .web_search_rate_limiter
        .check_with_limits(user_id.to_string(), limits)
    {
        return Err(ApiError::tool_action_rate_limited(
            exceeded.max_calls,
            exceeded.window.as_secs(),
            exceeded.retry_after.as_secs().max(1),
        ));
    }
    Ok(())
}

async fn web_search_limits_for_user(
    state: &AppState,
    access_token: &str,
) -> crate::tool_action_rate_limit::WebSearchRateLimits {
    match state
        .billing_client
        .get_subscription_status_cached(access_token)
        .await
    {
        Ok(status) => web_search_limits_for_subscription(&status),
        Err(error) => {
            tracing::warn!(
                %error,
                "could not resolve z-billing subscription for Web Search; using Mortal limits"
            );
            crate::tool_action_rate_limit::MORTAL_LIMITS
        }
    }
}

fn web_search_limits_for_subscription(
    status: &aura_os_billing::SubscriptionStatus,
) -> crate::tool_action_rate_limit::WebSearchRateLimits {
    web_search_limits_for_subscription_at(status, chrono::Utc::now())
}

fn web_search_limits_for_subscription_at(
    status: &aura_os_billing::SubscriptionStatus,
    now: chrono::DateTime<chrono::Utc>,
) -> crate::tool_action_rate_limit::WebSearchRateLimits {
    let paid_through_current_period = status
        .current_period_end
        .as_deref()
        .and_then(|value| chrono::DateTime::parse_from_rfc3339(value).ok())
        .is_some_and(|period_end| period_end > now);

    if status.is_subscribed || paid_through_current_period {
        crate::tool_action_rate_limit::limits_for_billing_plan(Some(&status.plan))
    } else {
        crate::tool_action_rate_limit::MORTAL_LIMITS
    }
}

pub(crate) async fn list_tool_catalog(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    Path(org_id): Path<OrgId>,
) -> ApiResult<Json<Value>> {
    let catalog = installed_workspace_app_tool_catalog(&state, &org_id, &jwt).await;
    let tools = catalog
        .tools
        .into_iter()
        .map(|tool| {
            json!({
                "name": tool.name,
                "description": tool.description,
                "inputSchema": tool.input_schema,
                "namespace": tool.namespace,
                "endpoint": tool.endpoint,
                "sourceKind": tool.metadata.get("aura_source_kind").cloned().unwrap_or(Value::Null),
                "trustClass": tool.metadata.get("aura_trust_class").cloned().unwrap_or(Value::Null),
                "metadata": tool.metadata,
            })
        })
        .collect::<Vec<_>>();
    let warnings = catalog
        .warnings
        .into_iter()
        .map(|warning| {
            json!({
                "code": warning.code,
                "message": warning.message,
                "detail": warning.detail,
                "sourceKind": warning.source_kind,
                "trustClass": warning.trust_class,
                "integrationId": warning.integration_id,
                "integrationName": warning.integration_name,
                "provider": warning.provider,
            })
        })
        .collect::<Vec<_>>();
    Ok(Json(json!({ "tools": tools, "warnings": warnings })))
}

pub(crate) async fn call_mcp_tool(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    Path((org_id, integration_id)): Path<(OrgId, String)>,
    Query(query): Query<McpToolQuery>,
    Json(args): Json<Value>,
) -> ApiResult<Json<Value>> {
    hydrate_canonical_integration_shadow(&state, &org_id, &jwt).await;
    let integration = resolve_mcp_server_integration(&state, &org_id, &integration_id).await?;
    let result = trusted_mcp::call_tool(
        &integration.metadata,
        Some(&integration.secret),
        &query.tool_name,
        &args,
    )
    .await
    .map_err(ApiError::bad_gateway)?;
    Ok(Json(result))
}
