use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::Json;

use aura_core::*;

use crate::dto::{
    CreateOrgRequest, SetBillingRequest, SetGithubRequest, UpdateMemberRoleRequest, UpdateOrgRequest,
};
use crate::error::{ApiError, ApiResult};
use crate::state::AppState;

fn map_org_err(e: aura_orgs::OrgError) -> (StatusCode, Json<ApiError>) {
    match &e {
        aura_orgs::OrgError::NotFound(_) => ApiError::not_found("org not found"),
        aura_orgs::OrgError::Forbidden(msg) => ApiError::unauthorized(msg.clone()),
        aura_orgs::OrgError::InvalidInput(msg) => ApiError::bad_request(msg.clone()),
        aura_orgs::OrgError::InviteNotFound => ApiError::not_found("invite not found"),
        aura_orgs::OrgError::InviteInvalid => ApiError::bad_request("invite expired or revoked"),
        aura_orgs::OrgError::AlreadyMember => ApiError::conflict("already a member"),
        _ => ApiError::internal(e.to_string()),
    }
}

fn get_user_id(state: &AppState) -> Result<(String, String), (StatusCode, Json<ApiError>)> {
    let session_bytes = state
        .store
        .get_setting("zero_auth_session")
        .map_err(|_| ApiError::unauthorized("not authenticated"))?;
    let session: ZeroAuthSession =
        serde_json::from_slice(&session_bytes).map_err(|e| ApiError::internal(e.to_string()))?;
    Ok((session.user_id, session.display_name))
}

pub async fn list_orgs(State(state): State<AppState>) -> ApiResult<Json<Vec<Org>>> {
    let (user_id, _) = get_user_id(&state)?;
    let orgs = state.org_service.list_user_orgs(&user_id).map_err(map_org_err)?;
    Ok(Json(orgs))
}

pub async fn create_org(
    State(state): State<AppState>,
    Json(req): Json<CreateOrgRequest>,
) -> ApiResult<(StatusCode, Json<Org>)> {
    let (user_id, display_name) = get_user_id(&state)?;
    let org = state
        .org_service
        .create_org(&user_id, &req.name, &display_name)
        .map_err(map_org_err)?;
    Ok((StatusCode::CREATED, Json(org)))
}

pub async fn get_org(
    State(state): State<AppState>,
    Path(org_id): Path<OrgId>,
) -> ApiResult<Json<Org>> {
    let org = state.org_service.get_org(&org_id).map_err(map_org_err)?;
    Ok(Json(org))
}

pub async fn update_org(
    State(state): State<AppState>,
    Path(org_id): Path<OrgId>,
    Json(req): Json<UpdateOrgRequest>,
) -> ApiResult<Json<Org>> {
    let (user_id, _) = get_user_id(&state)?;
    let org = state
        .org_service
        .update_org(&org_id, &user_id, &req.name)
        .map_err(map_org_err)?;
    Ok(Json(org))
}

pub async fn list_members(
    State(state): State<AppState>,
    Path(org_id): Path<OrgId>,
) -> ApiResult<Json<Vec<OrgMember>>> {
    let members = state.org_service.list_members(&org_id).map_err(map_org_err)?;
    Ok(Json(members))
}

pub async fn update_member_role(
    State(state): State<AppState>,
    Path((org_id, target_user_id)): Path<(OrgId, String)>,
    Json(req): Json<UpdateMemberRoleRequest>,
) -> ApiResult<Json<OrgMember>> {
    let (actor_user_id, _) = get_user_id(&state)?;
    let member = state
        .org_service
        .set_role(&org_id, &actor_user_id, &target_user_id, req.role)
        .map_err(map_org_err)?;
    Ok(Json(member))
}

pub async fn remove_member(
    State(state): State<AppState>,
    Path((org_id, target_user_id)): Path<(OrgId, String)>,
) -> ApiResult<StatusCode> {
    let (actor_user_id, _) = get_user_id(&state)?;
    state
        .org_service
        .remove_member(&org_id, &actor_user_id, &target_user_id)
        .map_err(map_org_err)?;
    Ok(StatusCode::NO_CONTENT)
}

pub async fn create_invite(
    State(state): State<AppState>,
    Path(org_id): Path<OrgId>,
) -> ApiResult<(StatusCode, Json<OrgInvite>)> {
    let (user_id, _) = get_user_id(&state)?;
    let invite = state
        .org_service
        .create_invite(&org_id, &user_id)
        .map_err(map_org_err)?;
    Ok((StatusCode::CREATED, Json(invite)))
}

pub async fn list_invites(
    State(state): State<AppState>,
    Path(org_id): Path<OrgId>,
) -> ApiResult<Json<Vec<OrgInvite>>> {
    let invites = state.org_service.list_invites(&org_id).map_err(map_org_err)?;
    Ok(Json(invites))
}

pub async fn revoke_invite(
    State(state): State<AppState>,
    Path((org_id, invite_id)): Path<(OrgId, InviteId)>,
) -> ApiResult<Json<OrgInvite>> {
    let (user_id, _) = get_user_id(&state)?;
    let invite = state
        .org_service
        .revoke_invite(&org_id, &invite_id, &user_id)
        .map_err(map_org_err)?;
    Ok(Json(invite))
}

pub async fn accept_invite(
    State(state): State<AppState>,
    Path(token): Path<String>,
) -> ApiResult<Json<OrgMember>> {
    let (user_id, display_name) = get_user_id(&state)?;
    let member = state
        .org_service
        .accept_invite(&token, &user_id, &display_name)
        .map_err(map_org_err)?;
    Ok(Json(member))
}

pub async fn set_billing(
    State(state): State<AppState>,
    Path(org_id): Path<OrgId>,
    Json(req): Json<SetBillingRequest>,
) -> ApiResult<Json<Org>> {
    let (user_id, _) = get_user_id(&state)?;
    let billing = OrgBilling {
        billing_email: req.billing_email,
        plan: req.plan,
    };
    let org = state
        .org_service
        .set_billing(&org_id, &user_id, billing)
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

pub async fn set_github(
    State(state): State<AppState>,
    Path(org_id): Path<OrgId>,
    Json(req): Json<SetGithubRequest>,
) -> ApiResult<Json<Org>> {
    let (user_id, _) = get_user_id(&state)?;
    let org = state
        .org_service
        .set_github(&org_id, &user_id, &req.github_org)
        .map_err(map_org_err)?;
    Ok(Json(org))
}

pub async fn remove_github(
    State(state): State<AppState>,
    Path(org_id): Path<OrgId>,
) -> ApiResult<StatusCode> {
    let (user_id, _) = get_user_id(&state)?;
    state
        .org_service
        .remove_github(&org_id, &user_id)
        .map_err(map_org_err)?;
    Ok(StatusCode::NO_CONTENT)
}

pub async fn get_github(
    State(state): State<AppState>,
    Path(org_id): Path<OrgId>,
) -> ApiResult<Json<Option<OrgGithub>>> {
    let github = state.org_service.get_github(&org_id).map_err(map_org_err)?;
    Ok(Json(github))
}
