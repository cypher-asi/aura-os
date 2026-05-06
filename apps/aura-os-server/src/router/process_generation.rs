use axum::extract::DefaultBodyLimit;
use axum::routing::{delete, get, post, put};
use axum::Router;

use super::ATTACHMENT_REQUEST_MAX_BYTES;
use crate::handlers::{generation, process};
use crate::state::AppState;

pub(super) fn process_routes() -> Router<AppState> {
    Router::new()
        .route(
            "/api/processes",
            get(process::list_processes).post(process::create_process),
        )
        .route(
            "/api/processes/:id",
            get(process::get_process)
                .put(process::update_process)
                .delete(process::delete_process),
        )
        .route("/api/processes/:id/trigger", post(process::trigger_process))
        .route(
            "/api/processes/:id/nodes",
            get(process::list_nodes).post(process::create_node),
        )
        .route(
            "/api/processes/:id/nodes/:node_id",
            put(process::update_node).delete(process::delete_node),
        )
        .route(
            "/api/processes/:id/connections",
            get(process::list_connections).post(process::create_connection),
        )
        .route(
            "/api/processes/:id/connections/:connection_id",
            delete(process::delete_connection),
        )
        .route("/api/processes/:id/runs", get(process::list_runs))
        .route("/api/processes/:id/runs/:run_id", get(process::get_run))
        .route(
            "/api/processes/:id/runs/:run_id/cancel",
            post(process::cancel_run),
        )
        .route(
            "/api/processes/:id/runs/:run_id/events",
            get(process::list_run_events),
        )
        .route(
            "/api/processes/:id/runs/:run_id/artifacts",
            get(process::list_run_artifacts),
        )
        .route("/api/process-artifacts/:id", get(process::get_artifact))
        .route(
            "/api/process-folders",
            get(process::list_folders).post(process::create_folder),
        )
        .route(
            "/api/process-folders/:id",
            put(process::update_folder).delete(process::delete_folder),
        )
}

pub(super) fn generation_routes() -> Router<AppState> {
    // Both routes accept JSON bodies that inline base64 image data
    // (image-mode attachments / chat 3D's `image_data` field). Without
    // this override Axum's default 2 MiB cap rejects any pasted image
    // larger than ~1.5 MB, and the connection close mid-upload surfaces
    // in the browser as `TypeError: Failed to fetch` rather than 413.
    Router::new()
        .route(
            "/api/generate/image/stream",
            post(generation::generate_image_stream)
                .layer(DefaultBodyLimit::max(ATTACHMENT_REQUEST_MAX_BYTES)),
        )
        .route(
            "/api/generate/3d/stream",
            post(generation::generate_3d_stream)
                .layer(DefaultBodyLimit::max(ATTACHMENT_REQUEST_MAX_BYTES)),
        )
}
