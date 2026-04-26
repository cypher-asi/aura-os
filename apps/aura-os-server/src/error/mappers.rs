use super::upstream::UpstreamErrorContext;
use super::*;

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
                    data: None,
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
                    data: None,
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
                    data: None,
                }),
            )
        }
        _ => {
            warn!(error = %e, "aura-storage request failed");
            ApiError::bad_gateway(e.to_string())
        }
    }
}
