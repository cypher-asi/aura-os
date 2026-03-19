use axum::http::StatusCode;
use axum::Json;
use serde::Serialize;

#[derive(Debug, Serialize)]
pub struct ApiError {
    pub error: String,
    pub code: String,
    pub details: Option<String>,
}

pub type ApiResult<T> = Result<T, (StatusCode, Json<ApiError>)>;

impl ApiError {
    pub fn not_found(msg: impl Into<String>) -> (StatusCode, Json<Self>) {
        (
            StatusCode::NOT_FOUND,
            Json(Self {
                error: msg.into(),
                code: "not_found".to_string(),
                details: None,
            }),
        )
    }

    pub fn bad_request(msg: impl Into<String>) -> (StatusCode, Json<Self>) {
        (
            StatusCode::BAD_REQUEST,
            Json(Self {
                error: msg.into(),
                code: "bad_request".to_string(),
                details: None,
            }),
        )
    }

    pub fn internal(msg: impl Into<String>) -> (StatusCode, Json<Self>) {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(Self {
                error: msg.into(),
                code: "internal_error".to_string(),
                details: None,
            }),
        )
    }

    pub fn unauthorized(msg: impl Into<String>) -> (StatusCode, Json<Self>) {
        (
            StatusCode::UNAUTHORIZED,
            Json(Self {
                error: msg.into(),
                code: "unauthorized".to_string(),
                details: None,
            }),
        )
    }

    pub fn forbidden(msg: impl Into<String>) -> (StatusCode, Json<Self>) {
        (
            StatusCode::FORBIDDEN,
            Json(Self {
                error: msg.into(),
                code: "forbidden".to_string(),
                details: None,
            }),
        )
    }

    pub fn payment_required(msg: impl Into<String>) -> (StatusCode, Json<Self>) {
        (
            StatusCode::PAYMENT_REQUIRED,
            Json(Self {
                error: msg.into(),
                code: "insufficient_credits".to_string(),
                details: None,
            }),
        )
    }

    pub fn conflict(msg: impl Into<String>) -> (StatusCode, Json<Self>) {
        (
            StatusCode::CONFLICT,
            Json(Self {
                error: msg.into(),
                code: "conflict".to_string(),
                details: None,
            }),
        )
    }

    pub fn service_unavailable(msg: impl Into<String>) -> (StatusCode, Json<Self>) {
        (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(Self {
                error: msg.into(),
                code: "service_unavailable".to_string(),
                details: None,
            }),
        )
    }

    pub fn bad_gateway(msg: impl Into<String>) -> (StatusCode, Json<Self>) {
        (
            StatusCode::BAD_GATEWAY,
            Json(Self {
                error: msg.into(),
                code: "bad_gateway".to_string(),
                details: None,
            }),
        )
    }
}

/// Map a `NetworkError` to an API error response.
pub fn map_network_error(e: aura_network::NetworkError) -> (StatusCode, Json<ApiError>) {
    match &e {
        aura_network::NetworkError::Server { status, body } => {
            let code = StatusCode::from_u16(*status).unwrap_or(StatusCode::BAD_GATEWAY);
            (
                code,
                Json(ApiError {
                    error: body.clone(),
                    code: "network_error".to_string(),
                    details: None,
                }),
            )
        }
        _ => ApiError::bad_gateway(e.to_string()),
    }
}

/// Map a `StorageError` to an API error response, preserving the upstream HTTP status.
pub fn map_storage_error(e: aura_storage::StorageError) -> (StatusCode, Json<ApiError>) {
    match &e {
        aura_storage::StorageError::Server { status, body } => {
            let code = StatusCode::from_u16(*status).unwrap_or(StatusCode::BAD_GATEWAY);
            (
                code,
                Json(ApiError {
                    error: body.clone(),
                    code: "storage_error".to_string(),
                    details: None,
                }),
            )
        }
        _ => ApiError::bad_gateway(e.to_string()),
    }
}
