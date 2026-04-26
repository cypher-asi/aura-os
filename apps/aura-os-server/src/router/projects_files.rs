use axum::routing::{get, post};
use axum::Router;

use crate::handlers::{files, project_artifacts, project_stats, projects};
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
        .route("/api/list-directory", post(files::list_directory))
        .route("/api/read-file", post(files::read_file))
        .route("/api/file-preview", get(files::preview_file))
}
