use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::Json;
use reqwest::Url;
use serde::Serialize;
use serde_json::Value;
use tracing::warn;

use aura_os_core::*;
use aura_os_network::{NetworkOrg, NetworkOrgInvite, NetworkOrgMember};
use aura_os_orgs::IntegrationSecretUpdate;

use crate::dto::SetBillingRequest;
use crate::dto::{CreateOrgIntegrationRequest, UpdateOrgIntegrationRequest};
use crate::error::{map_integrations_error, map_network_error, ApiError, ApiResult};
use crate::handlers::permissions::require_org_role;
use crate::state::{AppState, AuthJwt, AuthSession};

// ---------------------------------------------------------------------------
// Response types — match the interface's expected shapes
// ---------------------------------------------------------------------------

#[derive(Debug, Serialize)]
pub(crate) struct OrgResponse {
    pub org_id: String,
    pub name: String,
    pub owner_user_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub slug: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub avatar_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub billing_email: Option<String>,
    pub billing: Option<OrgBilling>,
    pub created_at: String,
    pub updated_at: String,
}

impl OrgResponse {
    fn from_network(net: &NetworkOrg, billing: Option<OrgBilling>) -> Self {
        Self {
            org_id: net.id.clone(),
            name: net.name.clone(),
            owner_user_id: net.owner_user_id.clone(),
            slug: net.slug.clone(),
            description: net.description.clone(),
            avatar_url: net.avatar_url.clone(),
            billing_email: net.billing_email.clone(),
            billing,
            created_at: net.created_at.clone().unwrap_or_default(),
            updated_at: net.updated_at.clone().unwrap_or_default(),
        }
    }
}

#[derive(Debug, Serialize)]
pub(crate) struct MemberResponse {
    pub org_id: String,
    pub user_id: String,
    pub display_name: String,
    pub role: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub avatar_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub credit_budget: Option<u64>,
    pub joined_at: String,
}

impl From<NetworkOrgMember> for MemberResponse {
    fn from(m: NetworkOrgMember) -> Self {
        Self {
            org_id: m.org_id,
            user_id: m.user_id,
            display_name: m.display_name.unwrap_or_default(),
            role: m.role,
            avatar_url: m.avatar_url,
            credit_budget: m.credit_budget,
            joined_at: m.joined_at.unwrap_or_default(),
        }
    }
}

#[derive(Debug, Serialize)]
pub(crate) struct InviteResponse {
    pub invite_id: String,
    pub org_id: String,
    pub token: String,
    pub created_by: String,
    pub status: String,
    pub accepted_by: Option<String>,
    pub created_at: String,
    pub expires_at: String,
    pub accepted_at: Option<String>,
}

impl From<NetworkOrgInvite> for InviteResponse {
    fn from(inv: NetworkOrgInvite) -> Self {
        Self {
            invite_id: inv.id,
            org_id: inv.org_id,
            token: inv.token,
            created_by: inv.created_by.unwrap_or_default(),
            status: inv.status.unwrap_or_else(|| "pending".to_string()),
            accepted_by: inv.accepted_by,
            created_at: inv.created_at.unwrap_or_default(),
            expires_at: inv.expires_at.unwrap_or_default(),
            accepted_at: inv.accepted_at,
        }
    }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn map_org_err(e: aura_os_orgs::OrgError) -> (StatusCode, Json<ApiError>) {
    match &e {
        aura_os_orgs::OrgError::NotFound(_) => ApiError::not_found("org not found"),
        _ => ApiError::internal(format!("org operation failed: {e}")),
    }
}

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

    match transport {
        "stdio" => {
            let command = config.get("command").and_then(Value::as_str).map(str::trim);
            if command.filter(|value| !value.is_empty()).is_none() {
                return Err(ApiError::bad_request(
                    "Stdio MCP servers require a non-empty `command`.",
                ));
            }
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
        }
        other => {
            return Err(ApiError::bad_request(format!(
                "Unsupported MCP transport `{other}`. Expected `stdio` or `http`."
            )));
        }
    }

    if let Some(env) = config.get("env") {
        let env = env.as_object().ok_or_else(|| {
            ApiError::bad_request("MCP server `env` must be a JSON object of string values.")
        })?;
        if env.values().any(|value| !value.is_string()) {
            return Err(ApiError::bad_request(
                "MCP server `env` must only contain string values.",
            ));
        }
    }

    if let Some(secret_env_var) = config.get("secretEnvVar") {
        let secret_env_var = secret_env_var.as_str().map(str::trim).ok_or_else(|| {
            ApiError::bad_request("MCP server `secretEnvVar` must be a string when provided.")
        })?;
        if secret_env_var.is_empty() {
            return Err(ApiError::bad_request(
                "MCP server `secretEnvVar` cannot be empty when provided.",
            ));
        }
    }

    if let Some(cwd) = config.get("cwd") {
        let cwd = cwd.as_str().map(str::trim).ok_or_else(|| {
            ApiError::bad_request("MCP server `cwd` must be a string when provided.")
        })?;
        if cwd.is_empty() {
            return Err(ApiError::bad_request(
                "MCP server `cwd` cannot be empty when provided.",
            ));
        }
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

// ---------------------------------------------------------------------------
// Org CRUD — network only; billing from settings
// ---------------------------------------------------------------------------

pub(crate) async fn list_orgs(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
) -> ApiResult<Json<Vec<OrgResponse>>> {
    let client = state.require_network_client()?;
    let net_orgs = client.list_orgs(&jwt).await.map_err(map_network_error)?;

    let responses = net_orgs
        .iter()
        .map(|net| {
            let billing = net
                .id
                .parse::<OrgId>()
                .ok()
                .and_then(|id| state.org_service.get_billing(&id).ok().flatten());
            OrgResponse::from_network(net, billing)
        })
        .collect();

    Ok(Json(responses))
}

pub(crate) async fn create_org(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    Json(req): Json<crate::dto::CreateOrgRequest>,
) -> ApiResult<(StatusCode, Json<OrgResponse>)> {
    let client = state.require_network_client()?;

    let net_req = aura_os_network::CreateOrgRequest {
        name: req.name,
        description: None,
        avatar_url: None,
    };
    let net_org = client
        .create_org(&jwt, &net_req)
        .await
        .map_err(map_network_error)?;

    let billing = net_org
        .id
        .parse::<OrgId>()
        .ok()
        .and_then(|id| state.org_service.get_billing(&id).ok().flatten());
    Ok((
        StatusCode::CREATED,
        Json(OrgResponse::from_network(&net_org, billing)),
    ))
}

pub(crate) async fn get_org(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    Path(org_id): Path<OrgId>,
) -> ApiResult<Json<OrgResponse>> {
    let client = state.require_network_client()?;
    let org_id_str = org_id.to_string();
    let net_org = client
        .get_org(&org_id_str, &jwt)
        .await
        .map_err(map_network_error)?;

    let billing = state.org_service.get_billing(&org_id).ok().flatten();
    Ok(Json(OrgResponse::from_network(&net_org, billing)))
}

pub(crate) async fn update_org(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    Path(org_id): Path<OrgId>,
    Json(req): Json<crate::dto::UpdateOrgRequest>,
) -> ApiResult<Json<OrgResponse>> {
    let client = state.require_network_client()?;
    let org_id_str = org_id.to_string();
    let net_req = aura_os_network::UpdateOrgRequest {
        name: Some(req.name),
        description: None,
        avatar_url: None,
    };
    let net_org = client
        .update_org(&org_id_str, &jwt, &net_req)
        .await
        .map_err(map_network_error)?;

    let billing = state.org_service.get_billing(&org_id).ok().flatten();
    Ok(Json(OrgResponse::from_network(&net_org, billing)))
}

pub(crate) async fn list_integrations(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    Path(org_id): Path<OrgId>,
) -> ApiResult<Json<Vec<OrgIntegration>>> {
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
        if let Err(error) = state.org_service.sync_integration_shadow(
            &integration,
            IntegrationSecretUpdate::Clear,
        ) {
            warn!(
                integration_id = %integration.integration_id,
                error = %error,
                "failed to sync compatibility-only local integration shadow after canonical create"
            );
        }
        return Ok((StatusCode::CREATED, Json(integration)));
    }
    if req.api_key.is_some() {
        return Err(ApiError::service_unavailable(
            "aura-integrations is required for storing integration secrets",
        ));
    }
    // Local-only mode: no network client for role verification
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
        if let Err(error) = state.org_service.sync_integration_shadow(
            &integration,
            IntegrationSecretUpdate::Clear,
        ) {
            warn!(
                integration_id = %integration.integration_id,
                error = %error,
                "failed to sync compatibility-only local integration shadow after canonical update"
            );
        }
        return Ok(Json(integration));
    }
    if req.api_key.is_some() {
        return Err(ApiError::service_unavailable(
            "aura-integrations is required for storing integration secrets",
        ));
    }
    // Local-only mode: no network client for role verification
    let existing = state
        .org_service
        .get_integration(&org_id, &integration_id)
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
            &org_id,
            Some(&integration_id),
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
    // Local-only mode: no network client for role verification
    state
        .org_service
        .delete_integration(&org_id, &integration_id)
        .map_err(map_org_err)?;
    Ok(Json(()))
}

// ---------------------------------------------------------------------------
// Members — proxied to aura-network
// ---------------------------------------------------------------------------

pub(crate) async fn list_members(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    AuthSession(session): AuthSession,
    Path(org_id): Path<OrgId>,
) -> ApiResult<Json<Vec<MemberResponse>>> {
    let client = state.require_network_client()?;
    let org_id_str = org_id.to_string();
    let members = client
        .list_org_members(&org_id_str, &jwt)
        .await
        .map_err(map_network_error)?;

    let mut responses: Vec<MemberResponse> =
        members.into_iter().map(MemberResponse::from).collect();
    enrich_member_display_names(&mut responses, &session, client.as_ref(), &jwt).await;
    Ok(Json(responses))
}

fn looks_like_uuid(s: &str) -> bool {
    s.len() == 36 && s.chars().filter(|c| *c == '-').count() == 4
}

async fn enrich_member_display_names(
    responses: &mut [MemberResponse],
    session: &ZeroAuthSession,
    client: &aura_os_network::NetworkClient,
    jwt: &str,
) {
    let current_network_id = session.network_user_id.map(|id| id.to_string());

    for resp in responses.iter_mut() {
        let name_missing = resp.display_name.is_empty() || looks_like_uuid(&resp.display_name);
        if !name_missing {
            continue;
        }

        if try_fill_from_session(resp, session, current_network_id.as_deref()) {
            continue;
        }
        try_fill_from_network(resp, client, jwt).await;
    }
}

fn try_fill_from_session(
    resp: &mut MemberResponse,
    session: &ZeroAuthSession,
    current_network_id: Option<&str>,
) -> bool {
    let is_current_user =
        current_network_id == Some(&resp.user_id) || resp.display_name == session.user_id;
    if !is_current_user || session.display_name.is_empty() {
        return false;
    }
    resp.display_name = session.display_name.clone();
    true
}

async fn try_fill_from_network(
    resp: &mut MemberResponse,
    client: &aura_os_network::NetworkClient,
    jwt: &str,
) {
    if let Ok(user) = client.get_user(&resp.user_id, jwt).await {
        if let Some(name) = user.display_name.filter(|n| !n.is_empty()) {
            if !looks_like_uuid(&name) {
                resp.display_name = name;
            }
        }
        if resp.avatar_url.is_none() {
            resp.avatar_url = user.avatar_url;
        }
    }
}

pub(crate) async fn update_member_role(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    Path((org_id, target_user_id)): Path<(OrgId, String)>,
    Json(req): Json<crate::dto::UpdateMemberRoleRequest>,
) -> ApiResult<Json<MemberResponse>> {
    let client = state.require_network_client()?;
    let org_id_str = org_id.to_string();
    let role_str = format!("{:?}", req.role).to_lowercase();
    let net_req = aura_os_network::UpdateMemberRequest {
        role: Some(role_str.clone()),
        credit_budget: None,
    };
    let member = client
        .update_org_member(&org_id_str, &target_user_id, &jwt, &net_req)
        .await
        .map_err(map_network_error)?;

    Ok(Json(MemberResponse::from(member)))
}

pub(crate) async fn remove_member(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    Path((org_id, target_user_id)): Path<(OrgId, String)>,
) -> ApiResult<StatusCode> {
    let client = state.require_network_client()?;
    let org_id_str = org_id.to_string();
    client
        .remove_org_member(&org_id_str, &target_user_id, &jwt)
        .await
        .map_err(map_network_error)?;

    Ok(StatusCode::NO_CONTENT)
}

// ---------------------------------------------------------------------------
// Invites — proxied to aura-network
// ---------------------------------------------------------------------------

pub(crate) async fn create_invite(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    Path(org_id): Path<OrgId>,
) -> ApiResult<(StatusCode, Json<InviteResponse>)> {
    let client = state.require_network_client()?;
    let org_id_str = org_id.to_string();
    let net_req = aura_os_network::CreateInviteRequest {
        email: None,
        role: None,
    };
    let invite = client
        .create_invite(&org_id_str, &jwt, &net_req)
        .await
        .map_err(map_network_error)?;
    Ok((StatusCode::CREATED, Json(InviteResponse::from(invite))))
}

pub(crate) async fn list_invites(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    Path(org_id): Path<OrgId>,
) -> ApiResult<Json<Vec<InviteResponse>>> {
    let client = state.require_network_client()?;
    let org_id_str = org_id.to_string();
    let invites = client
        .list_invites(&org_id_str, &jwt)
        .await
        .map_err(map_network_error)?;
    Ok(Json(
        invites.into_iter().map(InviteResponse::from).collect(),
    ))
}

pub(crate) async fn revoke_invite(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    Path((org_id, invite_id)): Path<(OrgId, String)>,
) -> ApiResult<StatusCode> {
    let client = state.require_network_client()?;
    let org_id_str = org_id.to_string();
    client
        .revoke_invite(&org_id_str, &invite_id, &jwt)
        .await
        .map_err(map_network_error)?;
    Ok(StatusCode::NO_CONTENT)
}

pub(crate) async fn accept_invite(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    AuthSession(session): AuthSession,
    Path(token): Path<String>,
) -> ApiResult<Json<MemberResponse>> {
    let client = state.require_network_client()?;
    let member = client
        .accept_invite(&token, &jwt, &session.display_name)
        .await
        .map_err(map_network_error)?;

    Ok(Json(MemberResponse::from(member)))
}

// ---------------------------------------------------------------------------
// Billing — stays local
// ---------------------------------------------------------------------------

pub(crate) async fn set_billing(
    State(state): State<AppState>,
    Path(org_id): Path<OrgId>,
    Json(req): Json<SetBillingRequest>,
) -> ApiResult<Json<OrgBilling>> {
    let billing = OrgBilling {
        billing_email: req.billing_email,
        plan: req.plan,
    };
    let billing = state
        .org_service
        .set_billing(&org_id, billing)
        .map_err(map_org_err)?;
    Ok(Json(billing))
}

pub(crate) async fn get_billing(
    State(state): State<AppState>,
    Path(org_id): Path<OrgId>,
) -> ApiResult<Json<Option<OrgBilling>>> {
    let billing = state
        .org_service
        .get_billing(&org_id)
        .map_err(map_org_err)?;
    Ok(Json(billing))
}

// ---------------------------------------------------------------------------
// Integration config
// ---------------------------------------------------------------------------

#[derive(serde::Deserialize)]
pub(crate) struct UpdateIntegrationRequest {
    pub obsidian: Option<aura_os_core::ObsidianConfig>,
    pub web_search: Option<aura_os_core::WebSearchConfig>,
}

pub(crate) async fn get_integrations(
    State(state): State<AppState>,
    Path(org_id): Path<OrgId>,
) -> ApiResult<Json<Option<aura_os_core::IntegrationConfig>>> {
    let config = state
        .org_service
        .get_integration_config(&org_id)
        .map_err(map_org_err)?;
    Ok(Json(config))
}

pub(crate) async fn set_integrations(
    State(state): State<AppState>,
    Path(org_id): Path<OrgId>,
    Json(req): Json<UpdateIntegrationRequest>,
) -> ApiResult<Json<aura_os_core::IntegrationConfig>> {
    let existing = state
        .org_service
        .get_integration_config(&org_id)
        .map_err(map_org_err)?
        .unwrap_or(aura_os_core::IntegrationConfig {
            org_id,
            obsidian: None,
            web_search: None,
            updated_at: chrono::Utc::now(),
        });

    let config = aura_os_core::IntegrationConfig {
        org_id,
        obsidian: req.obsidian.or(existing.obsidian),
        web_search: req.web_search.or(existing.web_search),
        updated_at: chrono::Utc::now(),
    };

    let config = state
        .org_service
        .set_integration_config(&org_id, config)
        .map_err(map_org_err)?;

    Ok(Json(config))
}
