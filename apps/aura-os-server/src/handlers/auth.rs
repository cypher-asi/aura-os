use std::time::Instant;

use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::Json;
use base64::Engine;
use serde::Serialize;

use aura_os_auth::AuthError;

use crate::dto::{
    AuthLoginRequest, AuthRegisterRequest, AuthSessionResponse, ImportAccessTokenRequest,
    PasswordResetRequest,
};
use crate::error::{ApiError, ApiResult};
use crate::handlers::users::sync_user_to_network;
use crate::state::{
    clear_zero_auth_session, persist_zero_auth_session, AppState, AuthJwt, AuthSession,
    AuthZeroProMeta, CachedSession,
};

fn auth_token_import_enabled_from_var(value: Option<&str>) -> bool {
    matches!(value, Some("1" | "true" | "TRUE"))
}

pub(crate) fn auth_token_import_enabled() -> bool {
    auth_token_import_enabled_from_var(
        std::env::var("AURA_ALLOW_AUTH_TOKEN_IMPORT")
            .ok()
            .as_deref(),
    )
}

fn map_auth_error(e: AuthError) -> (StatusCode, Json<ApiError>) {
    match &e {
        AuthError::ZosApi {
            status,
            code,
            message,
        } if *status == 401 || code == "INVALID_EMAIL_PASSWORD" => {
            ApiError::unauthorized(if message.is_empty() {
                "Invalid email or password".to_string()
            } else {
                message.clone()
            })
        }
        AuthError::ZosApi { message, .. } => ApiError::bad_request(if message.is_empty() {
            "Authentication request failed".to_string()
        } else {
            message.clone()
        }),
        _ => ApiError::internal(format!("authentication failed: {e}")),
    }
}

pub(crate) async fn login(
    State(state): State<AppState>,
    Json(req): Json<AuthLoginRequest>,
) -> ApiResult<Json<AuthSessionResponse>> {
    let mut result = state
        .auth_service
        .login(&req.email, &req.password)
        .await
        .map_err(map_auth_error)?;

    sync_user_to_network(&state, &mut result.session).await;
    persist_zero_auth_session(&state.store, &result.session);

    // Seed the validation cache so the first authenticated request is instant.
    state.validation_cache.insert(
        result.session.access_token.clone(),
        CachedSession {
            session: result.session.clone(),
            validated_at: Instant::now(),
            zero_pro_refresh_error: result.zero_pro_refresh_error.clone(),
        },
    );

    // Fire-and-forget: grant signup credits on first AURA login.
    // Idempotent — only grants once per user (signup_grant_at check).
    let user_id = result.session.user_id.clone();
    let is_zero_pro = result.session.is_zero_pro;
    tokio::spawn(async move {
        grant_signup_credits(&user_id, is_zero_pro, None).await;
    });

    Ok(Json(AuthSessionResponse::from_auth_result(result)))
}

pub(crate) async fn register(
    State(state): State<AppState>,
    Json(req): Json<AuthRegisterRequest>,
) -> ApiResult<Json<AuthSessionResponse>> {
    let mut result = state
        .auth_service
        .register(&req.email, &req.password, &req.name, &req.invite_code)
        .await
        .map_err(map_auth_error)?;

    sync_user_to_network(&state, &mut result.session).await;
    persist_zero_auth_session(&state.store, &result.session);

    state.validation_cache.insert(
        result.session.access_token.clone(),
        CachedSession {
            session: result.session.clone(),
            validated_at: Instant::now(),
            zero_pro_refresh_error: result.zero_pro_refresh_error.clone(),
        },
    );

    // Fire-and-forget: grant signup credits on first AURA login.
    // If user entered a real invite code, store the inviter so referral
    // credits fire when this user subscribes to a paid plan (not on signup).
    let user_id = result.session.user_id.clone();
    let is_zero_pro = result.session.is_zero_pro;
    let referred_by = if !is_default_invite_code(&req.invite_code) {
        result.inviter_user_id.clone()
    } else {
        None
    };
    tokio::spawn(async move {
        grant_signup_credits(&user_id, is_zero_pro, referred_by.as_deref()).await;
    });

    Ok(Json(AuthSessionResponse::from_auth_result(result)))
}

/// Get the zOS API base URL from env var or use the default.
fn zos_api_url() -> String {
    std::env::var("ZOS_API_URL")
        .unwrap_or_else(|_| "https://zosapi.zero.tech".to_string())
}

/// Check if the invite code is the system default (organic signup, no referral).
fn is_default_invite_code(code: &str) -> bool {
    let default = std::env::var("DEFAULT_INVITE_CODE")
        .unwrap_or_else(|_| "domw-jh4cz8".to_string());
    code.eq_ignore_ascii_case(&default)
}

/// Grant one-time signup credits on first AURA login. Idempotent — z-billing
/// checks `signup_grant_at` and only grants once per user.
/// If `referred_by` is set, stores the inviter ID on the account for
/// deferred referral credits (triggered when user subscribes).
async fn grant_signup_credits(user_id: &str, is_zero_pro: bool, referred_by: Option<&str>) {
    let (billing_url, api_key) = match billing_service_config() {
        Some(config) => config,
        None => return,
    };

    let client = reqwest::Client::new();
    match client
        .post(format!("{billing_url}/v1/credits/signup-grant"))
        .header("x-api-key", &api_key)
        .header("x-service-name", "aura-os-server")
        .json(&serde_json::json!({ "user_id": user_id, "is_zero_pro": is_zero_pro, "referred_by": referred_by }))
        .send()
        .await
    {
        Ok(resp) if resp.status().is_success() => {
            tracing::info!(user_id = %user_id, "Signup credit grant issued");
        }
        Ok(resp) => {
            tracing::warn!(user_id = %user_id, status = %resp.status(), "Signup grant response");
        }
        Err(e) => {
            tracing::warn!(user_id = %user_id, error = %e, "Failed to reach z-billing for signup grant");
        }
    }
}



/// Get z-billing service URL and API key. Returns None if not configured.
fn billing_service_config() -> Option<(String, String)> {
    let billing_url = std::env::var("Z_BILLING_URL")
        .unwrap_or_else(|_| "https://z-billing.onrender.com".to_string());
    match std::env::var("Z_BILLING_API_KEY") {
        Ok(key) => Some((billing_url, key)),
        Err(_) => {
            tracing::warn!("Z_BILLING_API_KEY not set, skipping credit grant");
            None
        }
    }
}

pub(crate) async fn validate_invite_code(
    Path(code): Path<String>,
) -> ApiResult<Json<serde_json::Value>> {
    // Sanitize: invite codes are alphanumeric + hyphens only (e.g. "domw-jh4cz8")
    if code.is_empty() || code.len() > 50 || !code.chars().all(|c| c.is_alphanumeric() || c == '-') {
        return Ok(Json(serde_json::json!({ "valid": false })));
    }

    let client = reqwest::Client::new();
    let resp = client
        .post(format!("{}/invite/{code}/validate", zos_api_url()))
        .send()
        .await
        .map_err(|e| ApiError::bad_gateway(format!("invite validation failed: {e}")))?;

    if !resp.status().is_success() {
        return Ok(Json(serde_json::json!({ "valid": false })));
    }

    let body: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| ApiError::bad_gateway(format!("invite response parse failed: {e}")))?;

    // Normalize: zos-api currently returns a plain boolean.
    // Wrap it so the frontend always receives { valid, inviterUserId? }.
    if body.is_boolean() {
        return Ok(Json(serde_json::json!({ "valid": body.as_bool().unwrap_or(false) })));
    }

    Ok(Json(body))
}

pub(crate) async fn get_my_invite_code(
    AuthJwt(jwt): AuthJwt,
) -> ApiResult<Json<serde_json::Value>> {
    let client = reqwest::Client::new();
    let resp = client
        .post(format!("{}/invite", zos_api_url()))
        .bearer_auth(&jwt)
        .send()
        .await
        .map_err(|e| ApiError::bad_gateway(format!("invite fetch failed: {e}")))?;

    if !resp.status().is_success() {
        return Err(ApiError::bad_gateway("Failed to fetch invite code"));
    }

    let body: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| ApiError::bad_gateway(format!("invite response parse failed: {e}")))?;

    Ok(Json(body))
}

pub(crate) async fn import_access_token(
    State(state): State<AppState>,
    Json(req): Json<ImportAccessTokenRequest>,
) -> ApiResult<Json<AuthSessionResponse>> {
    if !auth_token_import_enabled() {
        return Err(ApiError::forbidden(
            "auth token import is disabled for this Aura server",
        ));
    }

    if req.access_token.trim().is_empty() {
        return Err(ApiError::bad_request("access_token is required"));
    }

    let mut result = state
        .auth_service
        .import_access_token(req.access_token.trim())
        .await
        .map_err(map_auth_error)?;

    sync_user_to_network(&state, &mut result.session).await;
    persist_zero_auth_session(&state.store, &result.session);

    Ok(Json(AuthSessionResponse::from_auth_result(result)))
}

#[cfg(test)]
mod tests {
    use super::auth_token_import_enabled_from_var;

    #[test]
    fn auth_token_import_enablement_only_accepts_explicit_truthy_values() {
        for value in [Some("1"), Some("true"), Some("TRUE")] {
            assert!(auth_token_import_enabled_from_var(value));
        }

        for value in [
            None,
            Some(""),
            Some("0"),
            Some("false"),
            Some("True"),
            Some("yes"),
        ] {
            assert!(!auth_token_import_enabled_from_var(value));
        }
    }
}

/// POST /api/auth/request-password-reset — proxy to zOS password reset (no auth required).
pub(crate) async fn request_password_reset(
    State(state): State<AppState>,
    Json(req): Json<PasswordResetRequest>,
) -> ApiResult<StatusCode> {
    state
        .auth_service
        .request_password_reset(&req.email)
        .await
        .map_err(map_auth_error)?;

    Ok(StatusCode::NO_CONTENT)
}

// Access code handlers disabled for launch — Zero Pro is the only entry path.
// Uncomment when access codes are re-enabled.
//
// pub(crate) async fn redeem_access_code(
//     State(state): State<AppState>,
//     AuthJwt(jwt): AuthJwt,
//     Json(req): Json<serde_json::Value>,
// ) -> ApiResult<Json<serde_json::Value>> {
//     let client = state
//         .network_client
//         .as_ref()
//         .ok_or_else(|| ApiError::internal("network service not configured"))?;
//     let code = req["code"]
//         .as_str()
//         .ok_or_else(|| ApiError::bad_request("code is required".to_string()))?;
//     let result = client
//         .redeem_access_code(&jwt, code)
//         .await
//         .map_err(map_network_error)?;
//     Ok(Json(result))
// }
//
// pub(crate) async fn get_access_code(
//     State(state): State<AppState>,
//     AuthJwt(jwt): AuthJwt,
// ) -> ApiResult<Json<serde_json::Value>> {
//     let client = state
//         .network_client
//         .as_ref()
//         .ok_or_else(|| ApiError::internal("network service not configured"))?;
//     let code = client
//         .get_access_code(&jwt)
//         .await
//         .map_err(map_network_error)?;
//     Ok(Json(code))
// }

/// GET /api/auth/session — return the middleware-resolved session and best-effort aura-network sync.
/// zOS validation runs only in the auth middleware (no second `validate_token` here).
pub(crate) async fn get_session(
    State(state): State<AppState>,
    AuthSession(mut session): AuthSession,
    AuthZeroProMeta {
        zero_pro_refresh_error,
    }: AuthZeroProMeta,
) -> ApiResult<Json<AuthSessionResponse>> {
    sync_user_to_network(&state, &mut session).await;
    let mut response = AuthSessionResponse::from(session);
    response.zero_pro_refresh_error = zero_pro_refresh_error;
    Ok(Json(response))
}

/// POST /api/auth/validate — force-refresh the session against zOS (middleware bypasses TTL cache)
/// and sync aura-network profile fields. zOS validation runs once in the auth middleware.
pub(crate) async fn validate(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    AuthSession(mut session): AuthSession,
    AuthZeroProMeta {
        zero_pro_refresh_error,
    }: AuthZeroProMeta,
) -> ApiResult<Json<AuthSessionResponse>> {
    sync_user_to_network(&state, &mut session).await;

    state.validation_cache.insert(
        jwt,
        CachedSession {
            session: session.clone(),
            validated_at: Instant::now(),
            zero_pro_refresh_error: zero_pro_refresh_error.clone(),
        },
    );

    persist_zero_auth_session(&state.store, &session);

    let mut response = AuthSessionResponse::from(session);
    response.zero_pro_refresh_error = zero_pro_refresh_error;
    Ok(Json(response))
}

pub(crate) async fn logout(
    State(state): State<AppState>,
    req: axum::extract::Request,
) -> ApiResult<StatusCode> {
    // Best-effort: extract JWT from header for zOS session invalidation.
    // Logout is unprotected so the token may be absent or expired.
    let token = req
        .headers()
        .get(axum::http::header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "))
        .map(|s| s.to_string());

    if let Some(ref jwt) = token {
        state.validation_cache.remove(jwt);
    }

    clear_zero_auth_session(&state.store);

    state
        .auth_service
        .logout(token.as_deref())
        .await
        .map_err(map_auth_error)?;

    Ok(StatusCode::NO_CONTENT)
}

/// Payload decoded from JWT (only the claims we need for issuer discovery).
#[derive(serde::Deserialize)]
struct JwtPayloadIss {
    iss: Option<String>,
}

#[derive(Serialize)]
pub(crate) struct JwtIssuerResponse {
    pub iss: String,
    pub jwks_url: String,
}

/// GET /api/auth/jwt-issuer — return the issuer and suggested JWKS URL from the current
/// session's JWT. Used to configure Orbit's TRUSTED_JWT_* without pasting the token into jwt.io.
/// Returns only public claims (iss); the token itself is never sent.
pub(crate) async fn get_jwt_issuer(AuthJwt(jwt): AuthJwt) -> ApiResult<Json<JwtIssuerResponse>> {
    let token = jwt.trim();
    let parts: Vec<&str> = token.split('.').collect();
    let payload_b64 = parts
        .get(1)
        .ok_or_else(|| ApiError::bad_request("invalid token format".to_string()))?;
    let payload_bytes = base64::engine::general_purpose::URL_SAFE_NO_PAD
        .decode(payload_b64.as_bytes())
        .map_err(|_| ApiError::bad_request("invalid token payload".to_string()))?;
    let payload: JwtPayloadIss = serde_json::from_slice(&payload_bytes)
        .map_err(|_| ApiError::bad_request("invalid token claims".to_string()))?;
    let iss = payload
        .iss
        .filter(|s| !s.is_empty())
        .ok_or_else(|| ApiError::bad_request("token has no issuer claim".to_string()))?;
    let jwks_url = if iss.ends_with('/') {
        format!("{}.well-known/jwks.json", iss)
    } else {
        format!("{}/.well-known/jwks.json", iss)
    };
    Ok(Json(JwtIssuerResponse { iss, jwks_url }))
}
