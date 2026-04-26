use std::time::{Duration, Instant};

use axum::extract::{Request, State};
use axum::http::{HeaderValue, Method, StatusCode};
use axum::middleware::Next;
use axum::response::Response;
use axum::Json;
use tracing::warn;

use aura_os_auth::AuthError;
use aura_os_core::ZeroAuthSession;

use crate::capture_auth::{capture_session_from_access_token, is_capture_access_token};
use crate::error::ApiError;
use crate::state::{
    persist_zero_auth_session, AppState, AuthJwt, AuthSession, AuthZeroProMeta, CachedSession,
};

const AUTH_REFRESH_TTL: Duration = Duration::from_secs(5 * 60);
const AUTH_STALE_FALLBACK_MAX_AGE: Duration = Duration::from_secs(30 * 60);
const AUTH_DEGRADED_HEADER: &str = "X-Aura-Auth-Degraded";

#[derive(Debug, Clone, Copy)]
pub(crate) struct AuthDegraded;

struct AuthResolution {
    session: ZeroAuthSession,
    zero_pro_refresh_error: Option<String>,
    degraded: bool,
}

mod cache;
mod error_map;
mod pro;
mod sensitive_paths;
mod session_resolve;
mod token;

use pro::enforce_zero_pro;
use sensitive_paths::is_sensitive_auth_path;
use session_resolve::resolve_session_from_jwt;
use token::extract_request_token;

pub(crate) async fn require_verified_session(
    State(state): State<AppState>,
    mut req: Request,
    next: Next,
) -> Result<Response, (StatusCode, Json<ApiError>)> {
    let token = extract_request_token(&req)
        .ok_or_else(|| ApiError::unauthorized("missing authorization token"))?;
    // POST /api/auth/validate skips the in-memory TTL cache so explicit refresh always hits zOS once.
    let allow_validation_cache =
        !(req.method() == axum::http::Method::POST && req.uri().path() == "/api/auth/validate");
    let allow_stale_fallback = !is_sensitive_auth_path(req.method(), req.uri().path());
    let AuthResolution {
        session,
        zero_pro_refresh_error,
        degraded,
    } = resolve_session_from_jwt(&state, &token, allow_validation_cache, allow_stale_fallback)
        .await?;
    if !is_capture_access_token(&token) {
        persist_zero_auth_session(&state.store, &session);
    }

    enforce_zero_pro(&state, &session)?;

    req.extensions_mut().insert(AuthJwt(token));
    req.extensions_mut().insert(AuthSession(session));
    req.extensions_mut().insert(AuthZeroProMeta {
        zero_pro_refresh_error,
    });
    if degraded {
        req.extensions_mut().insert(AuthDegraded);
    }

    let mut response = next.run(req).await;
    if degraded {
        response
            .headers_mut()
            .insert(AUTH_DEGRADED_HEADER, HeaderValue::from_static("true"));
    }
    Ok(response)
}

#[cfg(test)]
mod tests;
