use axum::routing::{get, post};
use axum::Router;

use crate::handlers::{agent_bootstrap, marketplace};
use crate::state::AppState;

pub(super) fn marketplace_routes() -> Router<AppState> {
    Router::new()
        .route(
            "/api/marketplace/agents",
            get(marketplace::list_marketplace_agents),
        )
        .route(
            "/api/marketplace/agents/:agent_id",
            get(marketplace::get_marketplace_agent),
        )
}

pub(super) fn agent_bootstrap_routes() -> Router<AppState> {
    Router::new()
        .route(
            "/api/agents/harness/setup",
            post(agent_bootstrap::setup_ceo_agent),
        )
        // DEPRECATED: renamed to /api/agents/harness/setup; keep alias for rollout compat
        .route(
            "/api/super-agent/setup",
            post(agent_bootstrap::setup_ceo_agent),
        )
        .route(
            "/api/agents/harness/cleanup",
            post(agent_bootstrap::cleanup_ceo_agents),
        )
        // DEPRECATED: renamed to /api/agents/harness/cleanup; keep alias for rollout compat
        .route(
            "/api/super-agent/cleanup",
            post(agent_bootstrap::cleanup_ceo_agents),
        )
        .route(
            "/api/agent-orchestrations",
            get(agent_bootstrap::list_orchestrations),
        )
        .route(
            "/api/agent-orchestrations/:orchestration_id",
            get(agent_bootstrap::get_orchestration),
        )
        .route(
            "/api/agents/harness/events",
            get(agent_bootstrap::list_pending_events),
        )
        // DEPRECATED: renamed to /api/agents/harness/events; keep alias for rollout compat
        .route(
            "/api/super-agent/events",
            get(agent_bootstrap::list_pending_events),
        )
        // Non-blocking harness reachability probe for the agent
        // editor's Local/Cloud toggle.
        .route(
            "/api/agents/harness/health",
            get(agent_bootstrap::harness_health),
        )
        // DEPRECATED: renamed to /api/agents/harness/health; keep alias for rollout compat
        .route(
            "/api/super_agent/harness/health",
            get(agent_bootstrap::harness_health),
        )
}
