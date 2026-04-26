use axum::routing::{get, post};
use axum::Router;

use crate::handlers::specs;
use crate::state::AppState;

pub(super) fn spec_routes() -> Router<AppState> {
    Router::new()
        .route(
            "/api/projects/:project_id/specs",
            get(specs::list_specs).post(specs::create_spec),
        )
        .route(
            "/api/projects/:project_id/specs/generate",
            post(specs::generate_specs),
        )
        .route(
            "/api/projects/:project_id/specs/generate/stream",
            post(specs::generate_specs_stream),
        )
        .route(
            "/api/projects/:project_id/specs/summary",
            post(specs::generate_specs_summary),
        )
        .route(
            "/api/projects/:project_id/specs/:spec_id",
            get(specs::get_spec)
                .put(specs::update_spec)
                .delete(specs::delete_spec),
        )
        // Flat aliases that mirror aura-storage's `/api/specs/:id` route.
        // The harness's `HttpDomainApi` calls these directly when
        // `AURA_OS_SERVER_URL` is configured, so without these the
        // dev loop's `get_spec` lookups 404 immediately.
        .route(
            "/api/specs/:spec_id",
            get(specs::get_spec_flat)
                .put(specs::update_spec_flat)
                .delete(specs::delete_spec_flat),
        )
}
