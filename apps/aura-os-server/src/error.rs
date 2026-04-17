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

    pub(crate) fn conflict_with_details(
        msg: impl Into<String>,
        details: impl Into<String>,
    ) -> (StatusCode, Json<Self>) {
        (
            StatusCode::CONFLICT,
            Json(Self {
                error: msg.into(),
                code: "conflict".to_string(),
                details: Some(details.into()),
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

/// Extracted context from a nested upstream error body of the form
/// `{"error":{"code":"...","message":"..."}}`.
#[derive(Debug, Default)]
pub(crate) struct UpstreamErrorContext {
    pub upstream_code: Option<String>,
    pub upstream_message: Option<String>,
}

impl UpstreamErrorContext {
    pub(crate) fn parse(body: &str) -> Self {
        let Ok(value) = serde_json::from_str::<serde_json::Value>(body) else {
            return Self::default();
        };
        let inner = value.get("error");
        let upstream_code = inner
            .and_then(|v| v.get("code"))
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());
        let upstream_message = inner
            .and_then(|v| v.get("message"))
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());
        Self {
            upstream_code,
            upstream_message,
        }
    }
}

/// Map a `NetworkError` to an API error response.
///
/// When the upstream body is a nested `{"error":{"code","message"}}` object,
/// the upstream `code` is surfaced in `details` so clients can disambiguate
/// opaque upstream errors (e.g. `DATABASE`) without parsing the body twice.
pub(crate) fn map_network_error(e: aura_os_network::NetworkError) -> (StatusCode, Json<ApiError>) {
    match &e {
        aura_os_network::NetworkError::Server { status, body } => {
            let code = StatusCode::from_u16(*status).unwrap_or(StatusCode::BAD_GATEWAY);
            let ctx = UpstreamErrorContext::parse(body);
            warn!(
                upstream_status = status,
                upstream_code = ?ctx.upstream_code,
                body_preview = %body.chars().take(200).collect::<String>(),
                "aura-network upstream error"
            );
            let details = ctx
                .upstream_code
                .as_ref()
                .map(|c| format!("upstream_code={c}"));
            (
                code,
                Json(ApiError {
                    error: body.clone(),
                    code: "network_error".to_string(),
                    details,
                }),
            )
        }
        _ => {
            warn!(error = %e, "aura-network request failed");
            ApiError::bad_gateway(e.to_string())
        }
    }
}

/// Map an `IntegrationsError` to an API error response, preserving the upstream HTTP status.
pub(crate) fn map_integrations_error(
    e: aura_os_integrations::IntegrationsError,
) -> (StatusCode, Json<ApiError>) {
    match &e {
        aura_os_integrations::IntegrationsError::Server { status, body } => {
            let code = StatusCode::from_u16(*status).unwrap_or(StatusCode::BAD_GATEWAY);
            warn!(
                upstream_status = status,
                body_preview = %body.chars().take(200).collect::<String>(),
                "aura-integrations upstream error"
            );
            (
                code,
                Json(ApiError {
                    error: body.clone(),
                    code: "integrations_error".to_string(),
                    details: None,
                }),
            )
        }
        _ => {
            warn!(error = %e, "aura-integrations request failed");
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn upstream_context_parses_nested_code_and_message() {
        let body = r#"{"error":{"code":"DATABASE","message":"An internal error occurred"}}"#;
        let ctx = UpstreamErrorContext::parse(body);
        assert_eq!(ctx.upstream_code.as_deref(), Some("DATABASE"));
        assert_eq!(
            ctx.upstream_message.as_deref(),
            Some("An internal error occurred")
        );
    }

    #[test]
    fn upstream_context_tolerates_non_json_bodies() {
        let ctx = UpstreamErrorContext::parse("not json");
        assert!(ctx.upstream_code.is_none());
        assert!(ctx.upstream_message.is_none());
    }

    #[test]
    fn upstream_context_tolerates_missing_error_object() {
        let ctx = UpstreamErrorContext::parse(r#"{"other":"value"}"#);
        assert!(ctx.upstream_code.is_none());
        assert!(ctx.upstream_message.is_none());
    }

    #[test]
    fn map_network_error_surfaces_upstream_code_in_details() {
        let err = aura_os_network::NetworkError::Server {
            status: 500,
            body: r#"{"error":{"code":"DATABASE","message":"boom"}}"#.to_string(),
        };
        let (status, Json(api_err)) = map_network_error(err);
        assert_eq!(status, StatusCode::INTERNAL_SERVER_ERROR);
        assert_eq!(api_err.code, "network_error");
        assert_eq!(api_err.details.as_deref(), Some("upstream_code=DATABASE"));
    }

    #[test]
    fn map_network_error_leaves_details_empty_when_body_is_opaque() {
        let err = aura_os_network::NetworkError::Server {
            status: 500,
            body: "totally not json".to_string(),
        };
        let (_, Json(api_err)) = map_network_error(err);
        assert!(api_err.details.is_none());
    }
}
