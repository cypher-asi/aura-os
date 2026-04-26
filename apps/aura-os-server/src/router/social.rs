use axum::routing::{delete, get, post};
use axum::Router;

use crate::handlers::{feed, follows, leaderboard};
use crate::state::AppState;

pub(super) fn social_routes() -> Router<AppState> {
    Router::new()
        .route(
            "/api/follows",
            post(follows::follow).get(follows::list_follows),
        )
        .route("/api/follows/:target_profile_id", delete(follows::unfollow))
        .route(
            "/api/follows/check/:target_profile_id",
            get(follows::check_follow),
        )
        .route("/api/leaderboard", get(leaderboard::get_leaderboard))
        .route("/api/stats", get(leaderboard::get_platform_stats))
        .route("/api/users/me/usage", get(leaderboard::get_personal_usage))
        .route("/api/orgs/:org_id/usage", get(leaderboard::get_org_usage))
        .route(
            "/api/orgs/:org_id/usage/members",
            get(leaderboard::get_org_usage_members),
        )
        .route("/api/feed", get(feed::list_feed))
        .route("/api/posts", post(feed::create_post))
        .route("/api/posts/:post_id", get(feed::get_post))
        .route(
            "/api/profiles/:profile_id/posts",
            get(feed::get_profile_posts),
        )
        .route(
            "/api/posts/:post_id/comments",
            get(feed::list_comments).post(feed::add_comment),
        )
        .route("/api/comments/:comment_id", delete(feed::delete_comment))
}
