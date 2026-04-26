//! Org CRUD handlers — list/create/get/update.
//!
//! Each handler proxies to the network client for the canonical record
//! and then folds in the locally-stored billing record (if any) before
//! responding.

use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::Json;

use aura_os_core::OrgId;

use crate::capture_auth::{demo_org_id, is_capture_access_token};
use crate::error::{map_network_error, ApiResult};
use crate::state::{AppState, AuthJwt};

use super::OrgResponse;

pub(crate) async fn list_orgs(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
) -> ApiResult<Json<Vec<OrgResponse>>> {
    if is_capture_access_token(&jwt) {
        let now = chrono::Utc::now().to_rfc3339();
        return Ok(Json(vec![OrgResponse {
            org_id: demo_org_id().to_string(),
            name: "Aura Capture Team".into(),
            owner_user_id: "capture-demo-user".into(),
            slug: Some("aura-capture".into()),
            description: Some("Demo organization for changelog media capture.".into()),
            avatar_url: None,
            billing_email: None,
            billing: None,
            created_at: now.clone(),
            updated_at: now,
        }]));
    }

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
        name: req.name,
        description: None,
        avatar_url: req.avatar_url.flatten(),
    };
    let net_org = client
        .update_org(&org_id_str, &jwt, &net_req)
        .await
        .map_err(map_network_error)?;

    let billing = state.org_service.get_billing(&org_id).ok().flatten();
    Ok(Json(OrgResponse::from_network(&net_org, billing)))
}
