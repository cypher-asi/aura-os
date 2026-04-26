use axum::routing::{get, post};
use axum::Router;

use crate::handlers::notes;
use crate::state::AppState;

pub(super) fn notes_routes() -> Router<AppState> {
    Router::new()
        .route(
            "/api/notes/projects/:project_id/tree",
            get(notes::list_tree),
        )
        .route(
            "/api/notes/projects/:project_id/read",
            get(notes::read_note),
        )
        .route(
            "/api/notes/projects/:project_id/write",
            post(notes::write_note),
        )
        .route(
            "/api/notes/projects/:project_id/create",
            post(notes::create_entry),
        )
        .route(
            "/api/notes/projects/:project_id/rename",
            post(notes::rename_entry),
        )
        .route(
            "/api/notes/projects/:project_id/delete",
            post(notes::delete_entry),
        )
        .route(
            "/api/notes/projects/:project_id/comments",
            get(notes::list_comments)
                .post(notes::add_comment)
                .delete(notes::delete_comment),
        )
}
