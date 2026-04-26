//! Org member CRUD handlers and the display-name enrichment helpers
//! used to fall back from the network's UUID-only payload to the
//! current session's name and finally to a per-user network lookup.

use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::Json;

use aura_os_core::{OrgId, ZeroAuthSession};

use crate::capture_auth::{demo_org_id, is_capture_access_token};
use crate::error::{map_network_error, ApiResult};
use crate::state::{AppState, AuthJwt, AuthSession};

use super::MemberResponse;

pub(crate) async fn list_members(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    AuthSession(session): AuthSession,
    Path(org_id): Path<OrgId>,
) -> ApiResult<Json<Vec<MemberResponse>>> {
    if is_capture_access_token(&jwt) && org_id != demo_org_id() {
        return Ok(Json(Vec::new()));
    }

    if is_capture_access_token(&jwt) {
        return Ok(Json(vec![MemberResponse {
            org_id: org_id.to_string(),
            user_id: session.user_id,
            display_name: session.display_name,
            role: "owner".into(),
            avatar_url: None,
            credit_budget: None,
            joined_at: chrono::Utc::now().to_rfc3339(),
        }]));
    }

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
