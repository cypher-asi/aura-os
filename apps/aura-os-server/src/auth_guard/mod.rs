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
use token::{extract_request_token, extract_ws_ticket, redeem_ws_ticket};

pub(crate) async fn require_verified_session(
    State(state): State<AppState>,
    mut req: Request,
    next: Next,
) -> Result<Response, (StatusCode, Json<ApiError>)> {
    // Primary: `Authorization: Bearer` header. Fallback for URL-based
    // clients that can't set headers (native `WebSocket`, `<img>`): a
    // short-lived, single-use `?ticket=` minted via
    // `POST /api/auth/ws-ticket`, redeemed (and burned) here for the
    // bound JWT. The long-lived token never travels in a URL.
    let token = match extract_request_token(&req) {
        Some(token) => token,
        None => {
            let ticket = extract_ws_ticket(&req)
                .ok_or_else(|| ApiError::unauthorized("missing authorization token"))?;
            redeem_ws_ticket(&state.ws_ticket_store, &ticket)
                .ok_or_else(|| ApiError::unauthorized("invalid or expired connect ticket"))?
        }
    };
    // Defense-in-depth: guest tokens are valid only on `/api/public/*`
    // routes. Reject them up front so the zOS validator never sees a
    // token it would refuse for the wrong reason (and so the
    // authenticated metrics aren't polluted with public-mode noise).
    // The check is local — `is_guest_token` decodes the bearer with
    // the guest signing secret and verifies `role == "guest"`.
    if crate::handlers::public::is_guest_token(&token) {
        return Err(ApiError::unauthorized(
            "guest tokens cannot be used on authenticated routes",
        ));
    }
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

    // Fire server-side session_active for True DAU tracking. Forward the
    // client's app version / platform (set by the `X-App-Version` /
    // `X-App-Platform` headers) so these events carry the same
    // `app_version` the client SDK reports — without them Mixpanel shows
    // server-emitted events as `app_version = "(not set)"`. Also forward
    // the end-user's IP (from `X-Forwarded-For` / `X-Real-IP`) so Mixpanel
    // geolocates the event to the user's country rather than the server's,
    // and the `User-Agent` so the server can derive the same `$os` the
    // client SDK reports instead of `$os = "(not set)"`.
    //
    // Capture-mode tokens resolve to a synthetic `capture-demo-user`
    // session used only to render changelog media. The headless renderer
    // sends no `X-App-Version`, so counting it would inject a fake DAU
    // user and a guaranteed `app_version = "(not set)"` slice — skip it.
    if let Some(ref mp) = state.mixpanel {
        if !is_capture_access_token(&token) {
            let app_version = req
                .headers()
                .get("x-app-version")
                .and_then(|v| v.to_str().ok());
            let platform = req
                .headers()
                .get("x-app-platform")
                .and_then(|v| v.to_str().ok());
            let user_agent = req
                .headers()
                .get("user-agent")
                .and_then(|v| v.to_str().ok());
            let client_ip = client_ip_from_headers(req.headers());
            mp.track_session_active(
                &session.user_id,
                app_version,
                platform,
                client_ip.as_deref(),
                user_agent,
            );
        }
    }

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

/// Best-effort end-user IP for Mixpanel geolocation. Reads
/// `X-Forwarded-For` (first hop) then `X-Real-IP`. Returns `None` when no
/// usable public IP is present (including loopback), so we never ask
/// Mixpanel to geolocate the server itself — those events should simply
/// carry no geo rather than a misleading one.
pub(crate) fn client_ip_from_headers(headers: &axum::http::HeaderMap) -> Option<String> {
    let parse = |raw: &str| raw.trim().parse::<std::net::IpAddr>().ok();

    let candidate = headers
        .get("x-forwarded-for")
        .and_then(|v| v.to_str().ok())
        .and_then(|s| s.split(',').next())
        .and_then(parse)
        .or_else(|| {
            headers
                .get("x-real-ip")
                .and_then(|v| v.to_str().ok())
                .and_then(parse)
        })?;

    if candidate.is_loopback() {
        return None;
    }
    Some(candidate.to_string())
}

#[cfg(test)]
mod tests;
