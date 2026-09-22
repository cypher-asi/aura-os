use axum::routing::post;
use axum::Router;

use crate::handlers::push_notifications;
use crate::state::AppState;

pub(super) fn notification_routes() -> Router<AppState> {
    Router::new().route(
        "/api/notifications/devices",
        post(push_notifications::register_device).delete(push_notifications::unregister_device),
    )
}
