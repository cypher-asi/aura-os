use super::*;

pub(super) fn map_auth_error(e: AuthError) -> (StatusCode, Json<ApiError>) {
    match e {
        AuthError::ZosApi {
            status: 401,
            message,
            ..
        } => ApiError::unauthorized(if message.is_empty() {
            "session expired or invalid".to_string()
        } else {
            message
        }),
        AuthError::Http(err) => {
            ApiError::service_unavailable(format!("unable to reach zOS API: {err}"))
        }
        other => ApiError::bad_gateway(other.to_string()),
    }
}
