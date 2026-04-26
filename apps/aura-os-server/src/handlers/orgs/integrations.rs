//! `OrgIntegration` handlers (LLM providers + MCP servers + workspace
//! integrations) plus the per-provider validation helpers.
//!
//! These handlers prefer the canonical aura-integrations service when
//! available and fall back to the local org service in standalone
//! deployments.

use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::Json;
use reqwest::Url;
use serde_json::Value;
use tracing::warn;

use aura_os_core::{OrgId, OrgIntegration, OrgIntegrationKind};
use aura_os_orgs::IntegrationSecretUpdate;

use crate::capture_auth::is_capture_access_token;
use crate::dto::{CreateOrgIntegrationRequest, UpdateOrgIntegrationRequest};
use crate::error::{map_integrations_error, ApiError, ApiResult};
use crate::handlers::permissions::require_org_role;
use crate::state::{AppState, AuthJwt, AuthSession};

use super::map_org_err;

fn validate_mcp_server_config(
    kind: &OrgIntegrationKind,
    provider: &str,
    provider_config: Option<&Value>,
) -> ApiResult<()> {
    if *kind != OrgIntegrationKind::McpServer {
        return Ok(());
    }
    if provider.trim() != "mcp_server" {
        return Err(ApiError::bad_request(
            "MCP server integrations must use the `mcp_server` provider.",
        ));
    }
    let config = provider_config.and_then(Value::as_object).ok_or_else(|| {
        ApiError::bad_request("MCP server integrations require an object provider_config.")
    })?;
    let transport = config
        .get("transport")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| ApiError::bad_request("MCP server integrations require a `transport`."))?;

    validate_mcp_transport(transport, config)?;
    validate_mcp_env(config)?;
    validate_mcp_optional_string(config, "secretEnvVar")?;
    validate_mcp_optional_string(config, "cwd")?;
    Ok(())
}

fn validate_mcp_transport(
    transport: &str,
    config: &serde_json::Map<String, Value>,
) -> ApiResult<()> {
    match transport {
        "stdio" => {
            let command = config.get("command").and_then(Value::as_str).map(str::trim);
            if command.filter(|value| !value.is_empty()).is_none() {
                return Err(ApiError::bad_request(
                    "Stdio MCP servers require a non-empty `command`.",
                ));
            }
            Ok(())
        }
        "http" | "streamable_http" => {
            let url = config.get("url").and_then(Value::as_str).map(str::trim);
            let url = url.filter(|value| !value.is_empty()).ok_or_else(|| {
                ApiError::bad_request("HTTP MCP servers require a non-empty `url`.")
            })?;
            if Url::parse(url).is_err() {
                return Err(ApiError::bad_request(
                    "HTTP MCP servers require a valid absolute `url`.",
                ));
            }
            Ok(())
        }
        other => Err(ApiError::bad_request(format!(
            "Unsupported MCP transport `{other}`. Expected `stdio` or `http`."
        ))),
    }
}

fn validate_mcp_env(config: &serde_json::Map<String, Value>) -> ApiResult<()> {
    let Some(env) = config.get("env") else {
        return Ok(());
    };
    let env = env.as_object().ok_or_else(|| {
        ApiError::bad_request("MCP server `env` must be a JSON object of string values.")
    })?;
    if env.values().any(|value| !value.is_string()) {
        return Err(ApiError::bad_request(
            "MCP server `env` must only contain string values.",
        ));
    }
    Ok(())
}

fn validate_mcp_optional_string(
    config: &serde_json::Map<String, Value>,
    key: &str,
) -> ApiResult<()> {
    let Some(raw) = config.get(key) else {
        return Ok(());
    };
    let value = raw.as_str().map(str::trim).ok_or_else(|| {
        ApiError::bad_request(format!(
            "MCP server `{key}` must be a string when provided."
        ))
    })?;
    if value.is_empty() {
        return Err(ApiError::bad_request(format!(
            "MCP server `{key}` cannot be empty when provided."
        )));
    }
    Ok(())
}

fn validate_workspace_integration_config(
    kind: &OrgIntegrationKind,
    provider: &str,
    provider_config: Option<&Value>,
) -> ApiResult<()> {
    if *kind != OrgIntegrationKind::WorkspaceIntegration {
        return Ok(());
    }

    match provider.trim() {
        "metricool" => {
            let config = provider_config.and_then(Value::as_object).ok_or_else(|| {
                ApiError::bad_request(
                    "Metricool integrations require provider_config with `userId` and `blogId`.",
                )
            })?;
            for key in ["userId", "blogId"] {
                let value = config.get(key).and_then(Value::as_str).map(str::trim);
                if value.filter(|value| !value.is_empty()).is_none() {
                    return Err(ApiError::bad_request(format!(
                        "Metricool integrations require a non-empty `{key}` config field."
                    )));
                }
            }
        }
        "mailchimp" => {
            if let Some(config) = provider_config {
                let config = config.as_object().ok_or_else(|| {
                    ApiError::bad_request(
                        "Mailchimp provider_config must be a JSON object when provided.",
                    )
                })?;
                if let Some(server_prefix) = config.get("serverPrefix") {
                    let server_prefix = server_prefix.as_str().map(str::trim).ok_or_else(|| {
                        ApiError::bad_request(
                            "Mailchimp `serverPrefix` must be a string when provided.",
                        )
                    })?;
                    if server_prefix.is_empty() {
                        return Err(ApiError::bad_request(
                            "Mailchimp `serverPrefix` cannot be empty when provided.",
                        ));
                    }
                }
            }
        }
        _ => {}
    }

    Ok(())
}

fn validate_org_integration_config(
    kind: &OrgIntegrationKind,
    provider: &str,
    provider_config: Option<&Value>,
) -> ApiResult<()> {
    validate_mcp_server_config(kind, provider, provider_config)?;
    validate_workspace_integration_config(kind, provider, provider_config)?;
    Ok(())
}

pub(crate) async fn list_integrations(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    Path(org_id): Path<OrgId>,
) -> ApiResult<Json<Vec<OrgIntegration>>> {
    if is_capture_access_token(&jwt) {
        return Ok(Json(Vec::new()));
    }

    if let Some(client) = &state.integrations_client {
        let integrations = client
            .list_integrations(&org_id, &jwt)
            .await
            .map_err(map_integrations_error)?;
        if let Err(error) = state
            .org_service
            .sync_integrations_shadow(&org_id, &integrations)
        {
            warn!(
                %org_id,
                error = %error,
                "failed to sync compatibility-only local integration shadow after canonical list"
            );
        }
        return Ok(Json(integrations));
    }
    let integrations = state
        .org_service
        .list_integrations(&org_id)
        .map_err(map_org_err)?;
    Ok(Json(integrations))
}

pub(crate) async fn create_integration(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    AuthSession(session): AuthSession,
    Path(org_id): Path<OrgId>,
    Json(req): Json<CreateOrgIntegrationRequest>,
) -> ApiResult<(StatusCode, Json<OrgIntegration>)> {
    if let Some(client) = &state.integrations_client {
        require_org_role(&state, &org_id.to_string(), &jwt, &session, "admin").await?;
        let body = serde_json::to_value(&req).map_err(|e| ApiError::internal(e.to_string()))?;
        let integration = client
            .create_integration(&org_id, &jwt, &body)
            .await
            .map_err(map_integrations_error)?;
        if let Err(error) = state
            .org_service
            .sync_integration_shadow(&integration, IntegrationSecretUpdate::Clear)
        {
            warn!(
                integration_id = %integration.integration_id,
                error = %error,
                "failed to sync compatibility-only local integration shadow after canonical create"
            );
        }
        return Ok((StatusCode::CREATED, Json(integration)));
    }
    validate_org_integration_config(&req.kind, &req.provider, req.provider_config.as_ref())?;
    let integration = state
        .org_service
        .upsert_integration(
            &org_id,
            None,
            req.name,
            req.provider,
            req.kind,
            req.default_model,
            req.provider_config,
            req.enabled,
            match req.api_key {
                Some(secret) => IntegrationSecretUpdate::Set(secret),
                None => IntegrationSecretUpdate::Preserve,
            },
        )
        .map_err(map_org_err)?;
    Ok((StatusCode::CREATED, Json(integration)))
}

pub(crate) async fn update_integration(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    AuthSession(session): AuthSession,
    Path((org_id, integration_id)): Path<(OrgId, String)>,
    Json(req): Json<UpdateOrgIntegrationRequest>,
) -> ApiResult<Json<OrgIntegration>> {
    if let Some(client) = &state.integrations_client {
        require_org_role(&state, &org_id.to_string(), &jwt, &session, "admin").await?;
        let body = serde_json::to_value(&req).map_err(|e| ApiError::internal(e.to_string()))?;
        let integration = client
            .update_integration(&org_id, &integration_id, &jwt, &body)
            .await
            .map_err(map_integrations_error)?;
        if let Err(error) = state
            .org_service
            .sync_integration_shadow(&integration, IntegrationSecretUpdate::Clear)
        {
            warn!(
                integration_id = %integration.integration_id,
                error = %error,
                "failed to sync compatibility-only local integration shadow after canonical update"
            );
        }
        return Ok(Json(integration));
    }
    update_integration_local(&state, &org_id, &integration_id, req)
}

fn update_integration_local(
    state: &AppState,
    org_id: &OrgId,
    integration_id: &str,
    req: UpdateOrgIntegrationRequest,
) -> ApiResult<Json<OrgIntegration>> {
    let existing = state
        .org_service
        .get_integration(org_id, integration_id)
        .map_err(map_org_err)?
        .ok_or_else(|| ApiError::not_found("integration not found"))?;
    let provider = req
        .provider
        .clone()
        .unwrap_or_else(|| existing.provider.clone());
    let kind = req.kind.clone().unwrap_or_else(|| existing.kind.clone());
    let provider_config = match req.provider_config.clone() {
        Some(value) => value,
        None => existing.provider_config.clone(),
    };
    let enabled = match req.enabled {
        Some(value) => value,
        None => Some(existing.enabled),
    };
    validate_org_integration_config(&kind, &provider, provider_config.as_ref())?;
    let integration = state
        .org_service
        .upsert_integration(
            org_id,
            Some(integration_id),
            req.name.unwrap_or(existing.name),
            provider,
            kind,
            match req.default_model {
                Some(value) => value,
                None => existing.default_model,
            },
            provider_config,
            enabled,
            match req.api_key {
                Some(Some(value)) => IntegrationSecretUpdate::Set(value),
                Some(None) => IntegrationSecretUpdate::Clear,
                None => IntegrationSecretUpdate::Preserve,
            },
        )
        .map_err(map_org_err)?;
    Ok(Json(integration))
}

pub(crate) async fn delete_integration(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    AuthSession(session): AuthSession,
    Path((org_id, integration_id)): Path<(OrgId, String)>,
) -> ApiResult<Json<()>> {
    if let Some(client) = &state.integrations_client {
        require_org_role(&state, &org_id.to_string(), &jwt, &session, "admin").await?;
        client
            .delete_integration(&org_id, &integration_id, &jwt)
            .await
            .map_err(map_integrations_error)?;
        if let Err(error) = state
            .org_service
            .delete_integration(&org_id, &integration_id)
        {
            warn!(
                %integration_id,
                error = %error,
                "failed to prune compatibility-only local integration shadow after canonical delete"
            );
        }
        return Ok(Json(()));
    }
    state
        .org_service
        .delete_integration(&org_id, &integration_id)
        .map_err(map_org_err)?;
    Ok(Json(()))
}
