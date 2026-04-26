use axum::routing::get;
use axum::Router;

use crate::handlers::{debug_runs, loops as loops_handler};
use crate::state::AppState;

pub(super) fn debug_routes() -> Router<AppState> {
    Router::new()
        .route("/api/debug/projects", get(debug_runs::list_projects))
        .route(
            "/api/debug/projects/:project_id/runs",
            get(debug_runs::list_runs),
        )
        .route(
            "/api/debug/projects/:project_id/runs/:run_id",
            get(debug_runs::get_run_metadata),
        )
        .route(
            "/api/debug/projects/:project_id/runs/:run_id/summary",
            get(debug_runs::get_run_summary),
        )
        .route(
            "/api/debug/projects/:project_id/runs/:run_id/logs",
            get(debug_runs::get_run_logs),
        )
        .route(
            "/api/debug/projects/:project_id/runs/:run_id/export",
            get(debug_runs::export_run),
        )
}

pub(super) fn loops_routes() -> Router<AppState> {
    Router::new().route("/api/loops", get(loops_handler::list_loops))
}
