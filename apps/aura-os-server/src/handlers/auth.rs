use std::time::Instant;

use axum::extract::State;
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
use crate::state::{AppState, AuthJwt, AuthSession, CachedSession};

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

    // Seed the validation cache so the first authenticated request is instant.
    state.validation_cache.insert(
        result.session.access_token.clone(),
        CachedSession {
            session: result.session.clone(),
            validated_at: Instant::now(),
        },
    );

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

    state.validation_cache.insert(
        result.session.access_token.clone(),
        CachedSession {
            session: result.session.clone(),
            validated_at: Instant::now(),
        },
    );

    Ok(Json(AuthSessionResponse::from_auth_result(result)))
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

    // Persist to RocksDB for network bridge and desktop session persistence
    if let Ok(bytes) = serde_json::to_vec(&result.session) {
        let _ = state.store.put_setting("zero_auth_session", &bytes);
    }

    sync_user_to_network(&state, &mut result.session).await;

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

/// GET /api/auth/session — return the current session from the middleware-validated auth.
pub(crate) async fn get_session(
    AuthSession(session): AuthSession,
) -> ApiResult<Json<AuthSessionResponse>> {
    Ok(Json(AuthSessionResponse::from(session)))
}

/// POST /api/auth/validate — force-refresh the session against zOS and update the cache.
pub(crate) async fn validate(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
) -> ApiResult<Json<AuthSessionResponse>> {
    let mut result = state
        .auth_service
        .validate_token(&jwt)
        .await
        .map_err(map_auth_error)?;

    sync_user_to_network(&state, &mut result.session).await;

    // Update validation cache with the refreshed session.
    state.validation_cache.insert(
        jwt,
        CachedSession {
            session: result.session.clone(),
            validated_at: Instant::now(),
        },
    );

    Ok(Json(AuthSessionResponse::from_auth_result(result)))
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
