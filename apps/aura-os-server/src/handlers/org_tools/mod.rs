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
use crate::handlers::trusted_mcp;
use crate::state::{AppState, AuthJwt};

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
    Path((org_id, tool_name)): Path<(OrgId, String)>,
    Json(args): Json<Value>,
) -> ApiResult<Json<Value>> {
    hydrate_canonical_integration_shadow(&state, &org_id, &jwt).await;
    let result = if tool_name == "list_org_integrations" {
        list_org_integrations(&state, &org_id, &args).await?
    } else if tool_name == "generate_image" {
        crate::handlers::generation::generate_image_tool(&state, &jwt, &args).await?
    } else if tool_name == "generate_3d_model" {
        crate::handlers::generation::generate_3d_tool(&state, &jwt, &args).await?
    } else {
        let contract = app_provider_contract_by_tool(&tool_name)
            .ok_or_else(|| ApiError::not_found(format!("unknown org tool `{tool_name}`")))?;
        dispatch_app_provider_tool(contract.kind, &state, &org_id, &tool_name, &args).await?
    };

    Ok(Json(result))
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
