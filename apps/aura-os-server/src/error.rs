use axum::http::StatusCode;
use axum::Json;
use serde::Serialize;
use tracing::warn;

#[derive(Debug, Serialize)]
pub(crate) struct ApiError {
    pub error: String,
    pub code: String,
    pub details: Option<String>,
}

pub(crate) type ApiResult<T> = Result<T, (StatusCode, Json<ApiError>)>;

impl ApiError {
    pub(crate) fn not_found(msg: impl Into<String>) -> (StatusCode, Json<Self>) {
        (
            StatusCode::NOT_FOUND,
            Json(Self {
                error: msg.into(),
                code: "not_found".to_string(),
                details: None,
            }),
        )
    }

    pub(crate) fn bad_request(msg: impl Into<String>) -> (StatusCode, Json<Self>) {
        (
            StatusCode::BAD_REQUEST,
            Json(Self {
                error: msg.into(),
                code: "bad_request".to_string(),
                details: None,
            }),
        )
    }

    pub(crate) fn internal(msg: impl Into<String>) -> (StatusCode, Json<Self>) {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(Self {
                error: msg.into(),
                code: "internal_error".to_string(),
                details: None,
            }),
        )
    }

    pub(crate) fn unauthorized(msg: impl Into<String>) -> (StatusCode, Json<Self>) {
        (
            StatusCode::UNAUTHORIZED,
            Json(Self {
                error: msg.into(),
                code: "unauthorized".to_string(),
                details: None,
            }),
        )
    }

    pub(crate) fn forbidden(msg: impl Into<String>) -> (StatusCode, Json<Self>) {
        (
            StatusCode::FORBIDDEN,
            Json(Self {
                error: msg.into(),
                code: "forbidden".to_string(),
                details: None,
            }),
        )
    }

    pub(crate) fn payment_required(msg: impl Into<String>) -> (StatusCode, Json<Self>) {
        (
            StatusCode::PAYMENT_REQUIRED,
            Json(Self {
                error: msg.into(),
                code: "insufficient_credits".to_string(),
                details: None,
            }),
        )
    }

    pub(crate) fn conflict(msg: impl Into<String>) -> (StatusCode, Json<Self>) {
        (
            StatusCode::CONFLICT,
            Json(Self {
                error: msg.into(),
                code: "conflict".to_string(),
                details: None,
            }),
        )
    }

    pub(crate) fn service_unavailable(msg: impl Into<String>) -> (StatusCode, Json<Self>) {
        (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(Self {
                error: msg.into(),
                code: "service_unavailable".to_string(),
                details: None,
            }),
        )
    }

    pub(crate) fn bad_gateway(msg: impl Into<String>) -> (StatusCode, Json<Self>) {
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
pub(crate) fn map_network_error(e: aura_os_network::NetworkError) -> (StatusCode, Json<ApiError>) {
    match &e {
        aura_os_network::NetworkError::Server { status, body } => {
            let code = StatusCode::from_u16(*status).unwrap_or(StatusCode::BAD_GATEWAY);
            warn!(
                upstream_status = status,
                body_preview = %body.chars().take(200).collect::<String>(),
                "aura-network upstream error"
            );
            (
                code,
                Json(ApiError {
                    error: body.clone(),
                    code: "network_error".to_string(),
                    details: None,
                }),
            )
        }
        _ => {
            warn!(error = %e, "aura-network request failed");
            ApiError::bad_gateway(e.to_string())
        }
    }
}

/// Map a `StorageError` to an API error response, preserving the upstream HTTP status.
pub(crate) fn map_storage_error(e: aura_os_storage::StorageError) -> (StatusCode, Json<ApiError>) {
    match &e {
        aura_os_storage::StorageError::Server { status, body } => {
            let code = StatusCode::from_u16(*status).unwrap_or(StatusCode::BAD_GATEWAY);
            warn!(
                upstream_status = status,
                body_preview = %body.chars().take(200).collect::<String>(),
                "aura-storage upstream error"
            );
            (
                code,
                Json(ApiError {
                    error: body.clone(),
                    code: "storage_error".to_string(),
                    details: None,
                }),
            )
        }
        _ => {
            warn!(error = %e, "aura-storage request failed");
            ApiError::bad_gateway(e.to_string())
        }
    }
}
