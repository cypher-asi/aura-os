use axum::extract::State;
use axum::http::StatusCode;
use axum::Json;
use serde::Serialize;

use aura_auth::AuthError;
use aura_core::ZeroAuthSession;

use crate::dto::{AuthLoginRequest, AuthRegisterRequest, AuthSessionResponse};
use crate::error::{ApiError, ApiResult};
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
    let session = state
        .auth_service
        .login(&req.email, &req.password)
        .await
        .map_err(map_auth_error)?;
    Ok(Json(AuthSessionResponse::from(session)))
}

pub async fn register(
    State(state): State<AppState>,
    Json(req): Json<AuthRegisterRequest>,
) -> ApiResult<Json<AuthSessionResponse>> {
    let session = state
        .auth_service
        .register(&req.email, &req.password)
        .await
        .map_err(map_auth_error)?;
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
    let session = state
        .auth_service
        .validate()
        .await
        .map_err(map_auth_error)?
        .ok_or_else(|| ApiError::unauthorized("session expired or invalid"))?;
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
