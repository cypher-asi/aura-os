use axum::routing::{delete, get, post};
use axum::Router;

use crate::handlers::harness_proxy;
use crate::state::AppState;

pub(super) fn harness_proxy_routes() -> Router<AppState> {
    Router::new()
        // Memory – Facts
        .route(
            "/api/harness/agents/:agent_id/memory/facts",
            get(harness_proxy::list_facts).post(harness_proxy::create_fact),
        )
        .route(
            "/api/harness/agents/:agent_id/memory/facts/by-key/:key",
            get(harness_proxy::get_fact_by_key),
        )
        .route(
            "/api/harness/agents/:agent_id/memory/facts/:fact_id",
            get(harness_proxy::get_fact)
                .put(harness_proxy::update_fact)
                .delete(harness_proxy::delete_fact),
        )
        // Memory – Events
        .route(
            "/api/harness/agents/:agent_id/memory/events",
            get(harness_proxy::list_events).post(harness_proxy::create_event),
        )
        .route(
            "/api/harness/agents/:agent_id/memory/events/:event_id",
            delete(harness_proxy::delete_event),
        )
        // Memory – Procedures
        .route(
            "/api/harness/agents/:agent_id/memory/procedures",
            get(harness_proxy::list_procedures).post(harness_proxy::create_procedure),
        )
        .route(
            "/api/harness/agents/:agent_id/memory/procedures/by-skill/:skill_name",
            get(harness_proxy::list_procedures_by_skill),
        )
        .route(
            "/api/harness/agents/:agent_id/memory/procedures/:proc_id",
            get(harness_proxy::get_procedure)
                .put(harness_proxy::update_procedure)
                .delete(harness_proxy::delete_procedure),
        )
        // Memory – Aggregate
        .route(
            "/api/harness/agents/:agent_id/memory",
            get(harness_proxy::get_memory_snapshot).delete(harness_proxy::wipe_memory),
        )
        .route(
            "/api/harness/agents/:agent_id/memory/stats",
            get(harness_proxy::get_memory_stats),
        )
        .route(
            "/api/harness/agents/:agent_id/memory/consolidate",
            post(harness_proxy::trigger_consolidation),
        )
        // Skills
        .route(
            "/api/harness/skills",
            get(harness_proxy::list_skills).post(harness_proxy::create_skill),
        )
        // `/skills/mine` is registered before `/skills/:name` so the static path
        // wins over the dynamic param route. (Axum prefers static segments, but
        // keeping them ordered makes the intent obvious.)
        .route(
            "/api/harness/skills/mine",
            get(harness_proxy::list_my_skills),
        )
        .route(
            "/api/harness/skills/mine/:name",
            delete(harness_proxy::delete_my_skill),
        )
        .route("/api/harness/skills/:name", get(harness_proxy::get_skill))
        .route(
            "/api/harness/skills/:name/activate",
            post(harness_proxy::activate_skill),
        )
        .route(
            "/api/harness/skills/install-from-shop",
            post(harness_proxy::install_from_shop),
        )
        // Per-agent skill installations
        .route(
            "/api/harness/agents/:agent_id/skills",
            get(harness_proxy::list_agent_skills).post(harness_proxy::install_agent_skill),
        )
        .route(
            "/api/harness/agents/:agent_id/skills/:name",
            delete(harness_proxy::uninstall_agent_skill),
        )
        // Skill path discovery
        .route(
            "/api/skills/:name/discover-paths",
            get(harness_proxy::discover_skill_paths),
        )
        // Local skill content
        .route(
            "/api/skills/:category/:name/content",
            get(harness_proxy::get_skill_content),
        )
}
