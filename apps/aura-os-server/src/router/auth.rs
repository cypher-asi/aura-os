use axum::routing::{get, post};
use axum::Router;

use crate::capture_auth;
use crate::handlers::auth;
use crate::state::AppState;

pub(super) fn auth_routes() -> Router<AppState> {
    let routes = Router::new()
        .route("/api/auth/login", post(auth::login))
        .route("/api/auth/register", post(auth::register))
        .route("/api/auth/logout", post(auth::logout))
        .route(
            "/api/capture/session",
            post(capture_auth::create_capture_session),
        )
        .route(
            "/api/auth/request-password-reset",
            post(auth::request_password_reset),
        );

    if auth::auth_token_import_enabled() {
        routes.route(
            "/api/auth/import-access-token",
            post(auth::import_access_token),
        )
    } else {
        routes
    }
}

pub(super) fn protected_auth_routes() -> Router<AppState> {
    Router::new()
        .route("/api/auth/session", get(auth::get_session))
        .route("/api/auth/validate", post(auth::validate))
        .route("/api/auth/jwt-issuer", get(auth::get_jwt_issuer))
    // Access code endpoints disabled for launch — Zero Pro is the only entry path.
    // .route("/api/auth/redeem-access-code", post(auth::redeem_access_code))
    // .route("/api/auth/access-codes", get(auth::get_access_code))
}
