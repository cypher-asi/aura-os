use axum::routing::{delete, get, post, put};
use axum::Router;

use crate::handlers::{billing, org_tools, orgs, users};
use crate::state::AppState;

pub(super) fn user_routes() -> Router<AppState> {
    Router::new()
        .route("/api/users/me", get(users::get_me).put(users::update_me))
        .route("/api/users/:user_id", get(users::get_user))
        .route("/api/users/:user_id/profile", get(users::get_user_profile))
        .route("/api/profiles/:profile_id", get(users::get_profile))
}

pub(super) fn org_routes() -> Router<AppState> {
    Router::new()
        .route("/api/orgs", get(orgs::list_orgs).post(orgs::create_org))
        .route(
            "/api/orgs/:org_id",
            get(orgs::get_org).put(orgs::update_org),
        )
        .route("/api/orgs/:org_id/members", get(orgs::list_members))
        .route(
            "/api/orgs/:org_id/members/:user_id",
            put(orgs::update_member_role).delete(orgs::remove_member),
        )
        .route(
            "/api/orgs/:org_id/invites",
            post(orgs::create_invite).get(orgs::list_invites),
        )
        .route(
            "/api/orgs/:org_id/invites/:invite_id",
            delete(orgs::revoke_invite),
        )
        .route(
            "/api/orgs/:org_id/integrations",
            get(orgs::list_integrations).post(orgs::create_integration),
        )
        .route(
            "/api/orgs/:org_id/integrations/:integration_id",
            put(orgs::update_integration).delete(orgs::delete_integration),
        )
        .route(
            "/api/orgs/:org_id/tool-actions/:tool_name",
            post(org_tools::call_tool),
        )
        .route(
            "/api/orgs/:org_id/tool-actions",
            get(org_tools::list_tool_catalog),
        )
        .route(
            "/api/orgs/:org_id/tool-actions/mcp/:integration_id",
            post(org_tools::call_mcp_tool),
        )
        .route("/api/invites/:token/accept", post(orgs::accept_invite))
        .route(
            "/api/orgs/:org_id/billing",
            put(orgs::set_billing).get(orgs::get_billing),
        )
        .route(
            "/api/orgs/:org_id/integration-config",
            get(orgs::get_integrations).put(orgs::set_integrations),
        )
}

pub(super) fn billing_routes() -> Router<AppState> {
    Router::new()
        .route(
            "/api/orgs/:org_id/credits/balance",
            get(billing::get_credit_balance),
        )
        .route(
            "/api/orgs/:org_id/credits/checkout",
            post(billing::create_credit_checkout),
        )
        .route(
            "/api/orgs/:org_id/credits/transactions",
            get(billing::get_transactions),
        )
        .route("/api/orgs/:org_id/account", get(billing::get_account))
}
