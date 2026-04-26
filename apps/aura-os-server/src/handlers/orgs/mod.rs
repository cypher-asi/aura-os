//! HTTP handlers for the org / member / invite / integration surface.
//!
//! Sub-modules group the routes by concern:
//!
//! * [`crud`] — org CRUD (list, create, get, update).
//! * [`integrations`] — `OrgIntegration` (MCP, workspace) CRUD and the
//!   provider config validation helpers.
//! * [`members`] — list/update/remove members + display-name enrichment.
//! * [`invites`] — create/list/revoke/accept invite tokens.
//! * [`settings`] — local-only billing + per-org integration config
//!   (Obsidian, web search).

mod crud;
mod integrations;
mod invites;
mod members;
mod settings;

use axum::http::StatusCode;
use axum::Json;
use serde::Serialize;

use aura_os_network::{NetworkOrg, NetworkOrgInvite, NetworkOrgMember};

use aura_os_core::OrgBilling;

use crate::error::ApiError;

pub(crate) use crud::{create_org, get_org, list_orgs, update_org};
pub(crate) use integrations::{
    create_integration, delete_integration, list_integrations, update_integration,
};
pub(crate) use invites::{accept_invite, create_invite, list_invites, revoke_invite};
pub(crate) use members::{list_members, remove_member, update_member_role};
pub(crate) use settings::{get_billing, get_integrations, set_billing, set_integrations};

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
    pub(super) fn from_network(net: &NetworkOrg, billing: Option<OrgBilling>) -> Self {
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

pub(super) fn map_org_err(e: aura_os_orgs::OrgError) -> (StatusCode, Json<ApiError>) {
    match &e {
        aura_os_orgs::OrgError::NotFound(_) => ApiError::not_found("org not found"),
        _ => ApiError::internal(format!("org operation failed: {e}")),
    }
}
