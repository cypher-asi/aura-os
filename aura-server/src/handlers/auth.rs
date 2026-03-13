use axum::extract::State;
use axum::http::StatusCode;
use axum::Json;

use aura_auth::AuthError;

use crate::dto::{AuthLoginRequest, AuthRegisterRequest, AuthSessionResponse};
use crate::error::{ApiError, ApiResult};
use crate::state::AppState;

fn map_auth_error(e: AuthError) -> (StatusCode, Json<ApiError>) {
    match e {
        AuthError::InvalidCredentials => ApiError::unauthorized("invalid email or password"),
        AuthError::NoSession | AuthError::SessionExpired => {
            ApiError::unauthorized("no active session")
        }
        AuthError::RegistrationFailed(msg) => ApiError::bad_request(msg),
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
        .map_err(map_auth_error)?;
    Ok(Json(AuthSessionResponse::from(session)))
}

pub async fn validate(
    State(state): State<AppState>,
) -> ApiResult<Json<AuthSessionResponse>> {
    let session = state
        .auth_service
        .validate()
        .await
        .map_err(map_auth_error)?;
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
