//! Org invite handlers — create / list / revoke / accept. All
//! handlers proxy directly to the network client; no local
//! persistence is involved.

use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::Json;

use aura_os_core::OrgId;

use crate::error::{map_network_error, ApiResult};
use crate::state::{AppState, AuthJwt, AuthSession};

use super::{InviteResponse, MemberResponse};

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
