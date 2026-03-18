use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::Json;
use chrono::{DateTime, Utc};
use serde::Serialize;
use tracing::warn;

use aura_core::*;
use aura_network::{NetworkOrg, NetworkOrgInvite, NetworkOrgMember};

use crate::dto::SetBillingRequest;
use crate::error::{map_network_error, ApiError, ApiResult};
use crate::state::AppState;

// ---------------------------------------------------------------------------
// Response types — match the frontend's expected shapes
// ---------------------------------------------------------------------------

#[derive(Debug, Serialize)]
pub struct OrgResponse {
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
pub struct MemberResponse {
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
pub struct InviteResponse {
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

fn map_org_err(e: aura_orgs::OrgError) -> (StatusCode, Json<ApiError>) {
    match &e {
        aura_orgs::OrgError::NotFound(_) => ApiError::not_found("org not found"),
        _ => ApiError::internal(e.to_string()),
    }
}

/// Ensure a local shadow org exists in RocksDB so billing handlers work.
fn ensure_local_shadow(state: &AppState, net: &NetworkOrg) {
    let org_id: OrgId = match net.id.parse() {
        Ok(id) => id,
        Err(_) => return,
    };
    let owner_user_id: UserId = match net.owner_user_id.parse() {
        Ok(id) => id,
        Err(_) => return,
    };
    if state.store.get_org(&org_id).is_ok() {
        return;
    }
    let now = net
        .created_at
        .as_deref()
        .and_then(|s| DateTime::parse_from_rfc3339(s).ok())
        .map(|dt| dt.with_timezone(&Utc))
        .unwrap_or_else(Utc::now);
    let local = Org {
        org_id,
        name: net.name.clone(),
        owner_user_id,
        billing: None,
        created_at: now,
        updated_at: now,
    };
    if let Err(e) = state.store.put_org(&local) {
        warn!(org_id = %net.id, error = %e, "Failed to create local org shadow");
    }
}

/// Look up local billing data for a network org.
fn local_billing(state: &AppState, net_id: &str) -> Option<OrgBilling> {
    net_id
        .parse::<OrgId>()
        .ok()
        .and_then(|id| state.store.get_org(&id).ok())
        .and_then(|org| org.billing)
}

// ---------------------------------------------------------------------------
// Org CRUD — proxied to aura-network
// ---------------------------------------------------------------------------

pub async fn list_orgs(State(state): State<AppState>) -> ApiResult<Json<Vec<OrgResponse>>> {
    let client = state.require_network_client()?;
    let jwt = state.get_jwt()?;
    let net_orgs = client.list_orgs(&jwt).await.map_err(map_network_error)?;

    for net in &net_orgs {
        ensure_local_shadow(&state, net);
    }

    let responses = net_orgs
        .iter()
        .map(|net| {
            let billing = local_billing(&state, &net.id);
            OrgResponse::from_network(net, billing)
        })
        .collect();

    Ok(Json(responses))
}

pub async fn create_org(
    State(state): State<AppState>,
    Json(req): Json<crate::dto::CreateOrgRequest>,
) -> ApiResult<(StatusCode, Json<OrgResponse>)> {
    let client = state.require_network_client()?;
    let jwt = state.get_jwt()?;

    let net_req = aura_network::CreateOrgRequest {
        name: req.name,
        description: None,
        avatar_url: None,
    };
    let net_org = client
        .create_org(&jwt, &net_req)
        .await
        .map_err(map_network_error)?;

    ensure_local_shadow(&state, &net_org);

    Ok((StatusCode::CREATED, Json(OrgResponse::from_network(&net_org, None))))
}

pub async fn get_org(
    State(state): State<AppState>,
    Path(org_id): Path<OrgId>,
) -> ApiResult<Json<OrgResponse>> {
    let client = state.require_network_client()?;
    let jwt = state.get_jwt()?;
    let org_id_str = org_id.to_string();
    let net_org = client
        .get_org(&org_id_str, &jwt)
        .await
        .map_err(map_network_error)?;

    ensure_local_shadow(&state, &net_org);
    let billing = local_billing(&state, &net_org.id);

    Ok(Json(OrgResponse::from_network(&net_org, billing)))
}

pub async fn update_org(
    State(state): State<AppState>,
    Path(org_id): Path<OrgId>,
    Json(req): Json<crate::dto::UpdateOrgRequest>,
) -> ApiResult<Json<OrgResponse>> {
    let client = state.require_network_client()?;
    let jwt = state.get_jwt()?;
    let org_id_str = org_id.to_string();
    let net_req = aura_network::UpdateOrgRequest {
        name: Some(req.name),
        description: None,
        avatar_url: None,
    };
    let net_org = client
        .update_org(&org_id_str, &jwt, &net_req)
        .await
        .map_err(map_network_error)?;

    if let Ok(mut local) = state.store.get_org(&org_id) {
        local.name = net_org.name.clone();
        local.updated_at = Utc::now();
        let _ = state.store.put_org(&local);
    }

    let billing = local_billing(&state, &net_org.id);
    Ok(Json(OrgResponse::from_network(&net_org, billing)))
}

// ---------------------------------------------------------------------------
// Members — proxied to aura-network
// ---------------------------------------------------------------------------

pub async fn list_members(
    State(state): State<AppState>,
    Path(org_id): Path<OrgId>,
) -> ApiResult<Json<Vec<MemberResponse>>> {
    let client = state.require_network_client()?;
    let session = state.get_session()?;
    let jwt = session.access_token.clone();
    let org_id_str = org_id.to_string();
    let members = client
        .list_org_members(&org_id_str, &jwt)
        .await
        .map_err(map_network_error)?;

    let mut responses: Vec<MemberResponse> = members.into_iter().map(MemberResponse::from).collect();
    enrich_member_display_names(&mut responses, &session, client.as_ref(), &jwt).await;
    Ok(Json(responses))
}

fn looks_like_uuid(s: &str) -> bool {
    s.len() == 36 && s.chars().filter(|c| *c == '-').count() == 4
}

async fn enrich_member_display_names(
    responses: &mut [MemberResponse],
    session: &ZeroAuthSession,
    client: &aura_network::NetworkClient,
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
    if resp.avatar_url.is_none() && !session.profile_image.is_empty() {
        resp.avatar_url = Some(session.profile_image.clone());
    }
    true
}

async fn try_fill_from_network(
    resp: &mut MemberResponse,
    client: &aura_network::NetworkClient,
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

pub async fn update_member_role(
    State(state): State<AppState>,
    Path((org_id, target_user_id)): Path<(OrgId, String)>,
    Json(req): Json<crate::dto::UpdateMemberRoleRequest>,
) -> ApiResult<Json<MemberResponse>> {
    let client = state.require_network_client()?;
    let jwt = state.get_jwt()?;
    let org_id_str = org_id.to_string();
    let net_req = aura_network::UpdateMemberRequest {
        role: Some(format!("{:?}", req.role).to_lowercase()),
        credit_budget: None,
    };
    let member = client
        .update_org_member(&org_id_str, &target_user_id, &jwt, &net_req)
        .await
        .map_err(map_network_error)?;
    Ok(Json(MemberResponse::from(member)))
}

pub async fn remove_member(
    State(state): State<AppState>,
    Path((org_id, target_user_id)): Path<(OrgId, String)>,
) -> ApiResult<StatusCode> {
    let client = state.require_network_client()?;
    let jwt = state.get_jwt()?;
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

pub async fn create_invite(
    State(state): State<AppState>,
    Path(org_id): Path<OrgId>,
) -> ApiResult<(StatusCode, Json<InviteResponse>)> {
    let client = state.require_network_client()?;
    let jwt = state.get_jwt()?;
    let org_id_str = org_id.to_string();
    let net_req = aura_network::CreateInviteRequest {
        email: None,
        role: None,
    };
    let invite = client
        .create_invite(&org_id_str, &jwt, &net_req)
        .await
        .map_err(map_network_error)?;
    Ok((StatusCode::CREATED, Json(InviteResponse::from(invite))))
}

pub async fn list_invites(
    State(state): State<AppState>,
    Path(org_id): Path<OrgId>,
) -> ApiResult<Json<Vec<InviteResponse>>> {
    let client = state.require_network_client()?;
    let jwt = state.get_jwt()?;
    let org_id_str = org_id.to_string();
    let invites = client
        .list_invites(&org_id_str, &jwt)
        .await
        .map_err(map_network_error)?;
    Ok(Json(invites.into_iter().map(InviteResponse::from).collect()))
}

pub async fn revoke_invite(
    State(state): State<AppState>,
    Path((org_id, invite_id)): Path<(OrgId, String)>,
) -> ApiResult<StatusCode> {
    let client = state.require_network_client()?;
    let jwt = state.get_jwt()?;
    let org_id_str = org_id.to_string();
    client
        .revoke_invite(&org_id_str, &invite_id, &jwt)
        .await
        .map_err(map_network_error)?;
    Ok(StatusCode::NO_CONTENT)
}

pub async fn accept_invite(
    State(state): State<AppState>,
    Path(token): Path<String>,
) -> ApiResult<Json<MemberResponse>> {
    let client = state.require_network_client()?;
    let jwt = state.get_jwt()?;
    let member = client
        .accept_invite(&token, &jwt)
        .await
        .map_err(map_network_error)?;

    Ok(Json(MemberResponse::from(member)))
}

// ---------------------------------------------------------------------------
// Billing — stays local
// ---------------------------------------------------------------------------

pub async fn set_billing(
    State(state): State<AppState>,
    Path(org_id): Path<OrgId>,
    Json(req): Json<SetBillingRequest>,
) -> ApiResult<Json<Org>> {
    let billing = OrgBilling {
        billing_email: req.billing_email,
        plan: req.plan,
    };
    let org = state
        .org_service
        .set_billing(&org_id, billing)
        .map_err(map_org_err)?;
    Ok(Json(org))
}

pub async fn get_billing(
    State(state): State<AppState>,
    Path(org_id): Path<OrgId>,
) -> ApiResult<Json<Option<OrgBilling>>> {
    let billing = state.org_service.get_billing(&org_id).map_err(map_org_err)?;
    Ok(Json(billing))
}

