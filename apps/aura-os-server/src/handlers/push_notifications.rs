use axum::extract::State;
use axum::http::StatusCode;
use axum::Json;
use serde::{Deserialize, Serialize};

use crate::error::{ApiError, ApiResult};
use crate::push_notifications::PushDeviceRegistration;
use crate::state::{AppState, AuthSession};

#[derive(Serialize)]
pub(crate) struct PushRegistrationResponse {
    registered: bool,
    delivery_configured: bool,
}

#[derive(Deserialize)]
pub(crate) struct DeletePushRegistration {
    token: String,
}

pub(crate) async fn register_device(
    State(state): State<AppState>,
    AuthSession(session): AuthSession,
    Json(registration): Json<PushDeviceRegistration>,
) -> ApiResult<Json<PushRegistrationResponse>> {
    state
        .push_notifications
        .register(&session.user_id, registration)
        .map_err(ApiError::bad_request)?;
    Ok(Json(PushRegistrationResponse {
        registered: true,
        delivery_configured: state.push_notifications.delivery_configured(),
    }))
}

pub(crate) async fn unregister_device(
    State(state): State<AppState>,
    AuthSession(session): AuthSession,
    Json(request): Json<DeletePushRegistration>,
) -> ApiResult<StatusCode> {
    state
        .push_notifications
        .unregister(&session.user_id, &request.token)
        .map_err(ApiError::internal)?;
    Ok(StatusCode::NO_CONTENT)
}
