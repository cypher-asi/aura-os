use axum::extract::DefaultBodyLimit;
use axum::routing::{get, post};
use axum::Router;

use crate::handlers::{files, project_artifacts, project_stats, projects};
use crate::handlers::project_artifacts::THUMBNAIL_MAX_BYTES;
use crate::state::AppState;

pub(super) fn project_routes() -> Router<AppState> {
    Router::new()
        .route(
            "/api/projects",
            post(projects::create_project).get(projects::list_projects),
        )
        .route(
            "/api/projects/import",
            post(projects::create_imported_project),
        )
        .route(
            "/api/projects/:project_id",
            get(projects::get_project)
                .put(projects::update_project)
                .delete(projects::delete_project),
        )
        .route(
            "/api/projects/:project_id/archive",
            post(projects::archive_project),
        )
        .route(
            "/api/projects/:project_id/stats",
            get(project_stats::get_project_stats),
        )
        // Project artifacts (images, 3D models)
        .route(
            "/api/projects/:project_id/artifacts",
            get(project_artifacts::list_project_artifacts)
                .post(project_artifacts::create_project_artifact),
        )
        .route(
            "/api/artifacts/:artifact_id",
            get(project_artifacts::get_project_artifact)
                .delete(project_artifacts::delete_project_artifact),
        )
        // Captured 3D-model snapshot used as the sidekick tile thumbnail.
        // Body limit is overridden so a 2 MiB PNG can be POSTed even if
        // the global default is tighter; the handler also enforces the
        // same cap defensively.
        .route(
            "/api/artifacts/:artifact_id/thumbnail",
            get(project_artifacts::get_artifact_thumbnail)
                .post(project_artifacts::put_artifact_thumbnail)
                .layer(DefaultBodyLimit::max(THUMBNAIL_MAX_BYTES + 1024)),
        )
        .route("/api/list-directory", post(files::list_directory))
        .route("/api/read-file", post(files::read_file))
        .route("/api/file-preview", get(files::preview_file))
}
