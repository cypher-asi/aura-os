use axum::extract::State;
use axum::http::StatusCode;
use axum::Json;
use base64::Engine;
use serde::Serialize;

use aura_auth::AuthError;
use aura_core::ZeroAuthSession;

use crate::dto::{AuthLoginRequest, AuthRegisterRequest, AuthSessionResponse};
use crate::error::{ApiError, ApiResult};
use crate::handlers::users::sync_user_to_network;
use crate::state::AppState;

fn map_auth_error(e: AuthError) -> (StatusCode, Json<ApiError>) {
    match &e {
        AuthError::ZosApi { status, code, message } if *status == 401 || code == "INVALID_EMAIL_PASSWORD" => {
            ApiError::unauthorized(if message.is_empty() {
                "Invalid email or password".to_string()
            } else {
                message.clone()
            })
        }
        AuthError::ZosApi { message, .. } => {
            ApiError::bad_request(if message.is_empty() {
                "Authentication request failed".to_string()
            } else {
                message.clone()
            })
        }
        _ => ApiError::internal(e.to_string()),
    }
}

pub async fn login(
    State(state): State<AppState>,
    Json(req): Json<AuthLoginRequest>,
) -> ApiResult<Json<AuthSessionResponse>> {
    let mut session = state
        .auth_service
        .login(&req.email, &req.password)
        .await
        .map_err(map_auth_error)?;

    sync_user_to_network(&state, &mut session).await;

    Ok(Json(AuthSessionResponse::from(session)))
}

pub async fn register(
    State(state): State<AppState>,
    Json(req): Json<AuthRegisterRequest>,
) -> ApiResult<Json<AuthSessionResponse>> {
    let mut session = state
        .auth_service
        .register(&req.email, &req.password)
        .await
        .map_err(map_auth_error)?;

    sync_user_to_network(&state, &mut session).await;

    Ok(Json(AuthSessionResponse::from(session)))
}

pub async fn get_session(
    State(state): State<AppState>,
) -> ApiResult<Json<AuthSessionResponse>> {
    let session = state
        .auth_service
        .get_session()
        .await
        .map_err(map_auth_error)?
        .ok_or_else(|| ApiError::unauthorized("no active session"))?;
    Ok(Json(AuthSessionResponse::from(session)))
}

pub async fn validate(
    State(state): State<AppState>,
) -> ApiResult<Json<AuthSessionResponse>> {
    let mut session = state
        .auth_service
        .validate()
        .await
        .map_err(map_auth_error)?
        .ok_or_else(|| ApiError::unauthorized("session expired or invalid"))?;

    sync_user_to_network(&state, &mut session).await;

    Ok(Json(AuthSessionResponse::from(session)))
}

pub async fn logout(State(state): State<AppState>) -> ApiResult<StatusCode> {
    state
        .auth_service
        .logout()
        .await
        .map_err(map_auth_error)?;
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Serialize)]
pub struct AccessTokenResponse {
    pub access_token: String,
}

pub async fn get_access_token(
    State(state): State<AppState>,
) -> ApiResult<Json<AccessTokenResponse>> {
    let bytes = state
        .store
        .get_setting("zero_auth_session")
        .map_err(|_| ApiError::unauthorized("no active session"))?;
    let session: ZeroAuthSession =
        serde_json::from_slice(&bytes).map_err(|e| ApiError::internal(e.to_string()))?;
    Ok(Json(AccessTokenResponse {
        access_token: session.access_token,
    }))
}

/// Payload decoded from JWT (only the claims we need for issuer discovery).
#[derive(serde::Deserialize)]
struct JwtPayloadIss {
    iss: Option<String>,
}

#[derive(Serialize)]
pub struct JwtIssuerResponse {
    pub iss: String,
    pub jwks_url: String,
}

/// GET /api/auth/jwt-issuer — return the issuer and suggested JWKS URL from the current
/// session's JWT. Used to configure Orbit's TRUSTED_JWT_* without pasting the token into jwt.io.
/// Returns only public claims (iss); the token itself is never sent.
pub async fn get_jwt_issuer(
    State(state): State<AppState>,
) -> ApiResult<Json<JwtIssuerResponse>> {
    let bytes = state
        .store
        .get_setting("zero_auth_session")
        .map_err(|_| ApiError::unauthorized("no active session"))?;
    let session: ZeroAuthSession =
        serde_json::from_slice(&bytes).map_err(|e| ApiError::internal(e.to_string()))?;
    let token = session.access_token.trim();
    let parts: Vec<&str> = token.split('.').collect();
    let payload_b64 = parts.get(1).ok_or_else(|| ApiError::bad_request("invalid token format".to_string()))?;
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
    Ok(Json(JwtIssuerResponse {
        iss,
        jwks_url,
    }))
}
