use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::Json;
use chrono::{DateTime, Utc};
use serde::Serialize;
use tracing::{warn, info};

use aura_core::*;
use aura_network::{NetworkOrg, NetworkOrgInvite, NetworkOrgMember};

use crate::dto::{OrgOrbitRepoLink, SetBillingRequest, SetOrgOrbitRepoRequest};
use crate::error::{map_network_error, ApiError, ApiResult};
use crate::state::AppState;

const ORG_ORBIT_REPO_KEY_PREFIX: &str = "org_orbit_repo:";
const USER_ORBIT_USERNAME_KEY_PREFIX: &str = "user_orbit_username:";

fn org_orbit_repo_key(org_id: &OrgId) -> String {
    format!("{}{}", ORG_ORBIT_REPO_KEY_PREFIX, org_id)
}

fn user_orbit_username_key(user_id: &str) -> String {
    format!("{}{}", USER_ORBIT_USERNAME_KEY_PREFIX, user_id)
}

/// If org has Orbit link, add the user as collaborator (by orbit_username or user_id). Does not fail on Orbit errors.
async fn sync_orbit_add_collaborator(
    state: &AppState,
    org_id: &OrgId,
    user_id: &str,
    role: &str,
) {
    let key = org_orbit_repo_key(org_id);
    let link_json = match state.settings_service.get_setting(&key) {
        Ok(Some(s)) => s,
        _ => return,
    };
    let link: OrgOrbitRepoLink = match serde_json::from_str(&link_json) {
        Ok(l) => l,
        Err(e) => {
            warn!(org_id = %org_id, error = %e, "sync_orbit_add: invalid org orbit link");
            return;
        }
    };
    let base_url = state.orbit_base_url.as_deref().unwrap_or(link.orbit_base_url.as_str());
    let jwt = match state.get_jwt() {
        Ok(j) => j,
        Err(_) => return,
    };
    let collaborator_id = state
        .settings_service
        .get_setting(&user_orbit_username_key(user_id))
        .ok()
        .flatten()
        .unwrap_or_else(|| user_id.to_string());
    let orbit_role = match role.to_lowercase().as_str() {
        "owner" | "admin" => "owner",
        _ => "writer",
    };
    if let Err(e) = state
        .orbit_client
        .add_collaborator(
            base_url,
            &link.orbit_owner,
            &link.orbit_repo,
            &collaborator_id,
            orbit_role,
            &jwt,
        )
        .await
    {
        warn!(org_id = %org_id, user_id = %user_id, error = %e, "Orbit add_collaborator failed (invite still accepted)");
    } else {
        info!(org_id = %org_id, user_id = %user_id, "Orbit collaborator added");
    }
}

/// If org has Orbit link, remove the user from repo collaborators. Does not fail on Orbit errors.
async fn sync_orbit_remove_collaborator(state: &AppState, org_id: &OrgId, user_id: &str) {
    let key = org_orbit_repo_key(org_id);
    let link_json = match state.settings_service.get_setting(&key) {
        Ok(Some(s)) => s,
        _ => return,
    };
    let link: OrgOrbitRepoLink = match serde_json::from_str(&link_json) {
        Ok(l) => l,
        Err(e) => {
            warn!(org_id = %org_id, error = %e, "sync_orbit_remove: invalid org orbit link");
            return;
        }
    };
    let base_url = state.orbit_base_url.as_deref().unwrap_or(link.orbit_base_url.as_str());
    let jwt = match state.get_jwt() {
        Ok(j) => j,
        Err(_) => return,
    };
    let collaborator_id = state
        .settings_service
        .get_setting(&user_orbit_username_key(user_id))
        .ok()
        .flatten()
        .unwrap_or_else(|| user_id.to_string());
    if let Err(e) = state
        .orbit_client
        .remove_collaborator(
            base_url,
            &link.orbit_owner,
            &link.orbit_repo,
            &collaborator_id,
            &jwt,
        )
        .await
    {
        warn!(org_id = %org_id, user_id = %user_id, error = %e, "Orbit remove_collaborator failed (member still removed)");
    } else {
        info!(org_id = %org_id, user_id = %user_id, "Orbit collaborator removed");
    }
}

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

/// Ensure the current user is the org owner or has owner/admin role. Returns Err if not.
async fn require_org_owner_or_admin(
    state: &AppState,
    org_id: &OrgId,
) -> ApiResult<()> {
    let client = state.require_network_client()?;
    let jwt = state.get_jwt()?;
    let session = state.get_session()?;
    let user_id = &session.user_id;

    let net_org = client
        .get_org(&org_id.to_string(), &jwt)
        .await
        .map_err(map_network_error)?;
    if net_org.owner_user_id == *user_id {
        return Ok(());
    }

    let members = client
        .list_org_members(&org_id.to_string(), &jwt)
        .await
        .map_err(map_network_error)?;
    let role = members
        .iter()
        .find(|m| m.user_id == *user_id)
        .map(|m| m.role.as_str());
    match role {
        Some("owner") | Some("admin") => Ok(()),
        _ => Err(ApiError::forbidden("org owner or admin only")),
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
    let role_str = format!("{:?}", req.role).to_lowercase();
    let net_req = aura_network::UpdateMemberRequest {
        role: Some(role_str.clone()),
        credit_budget: None,
    };
    let member = client
        .update_org_member(&org_id_str, &target_user_id, &jwt, &net_req)
        .await
        .map_err(map_network_error)?;

    sync_orbit_add_collaborator(&state, &org_id, &target_user_id, &role_str).await;

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

    sync_orbit_remove_collaborator(&state, &org_id, &target_user_id).await;

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

    // Sync to Orbit repo if org has link (do not fail invite on Orbit errors)
    let org_id = member.org_id.clone();
    let user_id = member.user_id.clone();
    let role = member.role.clone();
    if let Ok(oid) = org_id.parse::<OrgId>() {
        sync_orbit_add_collaborator(&state, &oid, &user_id, &role).await;
    }

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

// ---------------------------------------------------------------------------
// Org Orbit repo link (org owner/admin only)
// ---------------------------------------------------------------------------

pub async fn get_org_orbit_repo(
    State(state): State<AppState>,
    Path(org_id): Path<OrgId>,
) -> ApiResult<Json<Option<OrgOrbitRepoLink>>> {
    require_org_owner_or_admin(&state, &org_id).await?;
    let key = org_orbit_repo_key(&org_id);
    let opt = state
        .settings_service
        .get_setting(&key)
        .map_err(|e| ApiError::internal(e.to_string()))?;
    let link = opt.and_then(|s| serde_json::from_str::<OrgOrbitRepoLink>(&s).ok());
    Ok(Json(link))
}

pub async fn put_org_orbit_repo(
    State(state): State<AppState>,
    Path(org_id): Path<OrgId>,
    Json(req): Json<SetOrgOrbitRepoRequest>,
) -> ApiResult<Json<OrgOrbitRepoLink>> {
    require_org_owner_or_admin(&state, &org_id).await?;
    let link = OrgOrbitRepoLink {
        orbit_base_url: req.orbit_base_url,
        orbit_owner: req.orbit_owner,
        orbit_repo: req.orbit_repo,
    };
    let key = org_orbit_repo_key(&org_id);
    let value = serde_json::to_string(&link).map_err(|e| ApiError::internal(e.to_string()))?;
    state
        .settings_service
        .set_setting(&key, &value)
        .map_err(|e| ApiError::internal(e.to_string()))?;
    Ok(Json(link))
}

