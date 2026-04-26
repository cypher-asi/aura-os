use axum::routing::{get, post};
use axum::Router;

use crate::handlers::feedback;
use crate::state::AppState;

pub(super) fn feedback_routes() -> Router<AppState> {
    Router::new()
        .route(
            "/api/feedback",
            get(feedback::list_feedback).post(feedback::create_feedback),
        )
        .route("/api/feedback/:post_id", get(feedback::get_feedback))
        .route(
            "/api/feedback/:post_id/status",
            axum::routing::patch(feedback::update_feedback_status),
        )
        .route(
            "/api/feedback/:post_id/comments",
            get(feedback::list_feedback_comments).post(feedback::add_feedback_comment),
        )
        .route(
            "/api/feedback/:post_id/vote",
            post(feedback::cast_feedback_vote),
        )
}
