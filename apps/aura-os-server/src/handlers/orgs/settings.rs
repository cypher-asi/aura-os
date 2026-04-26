//! Local-only org settings: billing plan/email plus the per-org
//! integration config (Obsidian, web search). These are stored by the
//! local org service rather than proxied to the network.

use axum::extract::{Path, State};
use axum::Json;

use aura_os_core::{IntegrationConfig, ObsidianConfig, OrgBilling, OrgId, WebSearchConfig};

use crate::dto::SetBillingRequest;
use crate::error::ApiResult;
use crate::state::AppState;

use super::map_org_err;

pub(crate) async fn set_billing(
    State(state): State<AppState>,
    Path(org_id): Path<OrgId>,
    Json(req): Json<SetBillingRequest>,
) -> ApiResult<Json<OrgBilling>> {
    let existing = state
        .org_service
        .get_billing(&org_id)
        .map_err(map_org_err)?;
    let billing = OrgBilling {
        billing_email: existing.and_then(|b| b.billing_email),
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

#[derive(serde::Deserialize)]
pub(crate) struct UpdateIntegrationRequest {
    pub obsidian: Option<ObsidianConfig>,
    pub web_search: Option<WebSearchConfig>,
}

pub(crate) async fn get_integrations(
    State(state): State<AppState>,
    Path(org_id): Path<OrgId>,
) -> ApiResult<Json<Option<IntegrationConfig>>> {
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
) -> ApiResult<Json<IntegrationConfig>> {
    let existing = state
        .org_service
        .get_integration_config(&org_id)
        .map_err(map_org_err)?
        .unwrap_or(IntegrationConfig {
            org_id,
            obsidian: None,
            web_search: None,
            updated_at: chrono::Utc::now(),
        });

    let config = IntegrationConfig {
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
