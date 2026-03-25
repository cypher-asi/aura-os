use axum::extract::{Request, State};
use axum::http::StatusCode;
use axum::middleware::Next;
use axum::response::Response;
use axum::Json;
use chrono::{Duration, Utc};
use tracing::warn;

use aura_os_auth::AuthError;
use aura_os_core::ZeroAuthSession;

use crate::error::ApiError;
use crate::state::AppState;

const AUTH_REFRESH_TTL: Duration = Duration::minutes(5);

fn auth_status_is_fresh(session: &ZeroAuthSession) -> bool {
    (Utc::now() - session.validated_at) < AUTH_REFRESH_TTL
}

fn should_refresh_session(session: &ZeroAuthSession) -> bool {
    !auth_status_is_fresh(session)
}

fn map_auth_error(e: AuthError) -> (StatusCode, Json<ApiError>) {
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

async fn load_cached_session(
    state: &AppState,
) -> Result<ZeroAuthSession, (StatusCode, Json<ApiError>)> {
    state
        .auth_service
        .get_session()
        .await
        .map_err(map_auth_error)?
        .ok_or_else(|| ApiError::unauthorized("no active session"))
}

async fn refresh_session(
    state: &AppState,
) -> Result<ZeroAuthSession, (StatusCode, Json<ApiError>)> {
    state
        .auth_service
        .validate()
        .await
        .map_err(map_auth_error)?
        .map(|result| result.session)
        .ok_or_else(|| ApiError::unauthorized("session expired or invalid"))
}

fn enforce_zero_pro(
    state: &AppState,
    session: &ZeroAuthSession,
) -> Result<(), (StatusCode, Json<ApiError>)> {
    if !state.require_zero_pro {
        return Ok(());
    }

    if session.is_zero_pro {
        Ok(())
    } else {
        Err(ApiError::forbidden("ZERO Pro subscription required"))
    }
}

fn cached_session_can_cover_refresh_failure(
    state: &AppState,
    session: &ZeroAuthSession,
    auth_fresh: bool,
) -> bool {
    if !auth_fresh {
        return false;
    }

    if !state.require_zero_pro {
        return true;
    }

    session.is_zero_pro
}

pub(crate) async fn require_verified_session(
    State(state): State<AppState>,
    req: Request,
    next: Next,
) -> Result<Response, (StatusCode, Json<ApiError>)> {
    let session = load_cached_session(&state).await?;

    if !should_refresh_session(&session) {
        enforce_zero_pro(&state, &session)?;
        return Ok(next.run(req).await);
    }

    let auth_fresh = auth_status_is_fresh(&session);

    match refresh_session(&state).await {
        Ok(refreshed) => {
            enforce_zero_pro(&state, &refreshed)?;
            Ok(next.run(req).await)
        }
        Err(err) if err.0 == StatusCode::UNAUTHORIZED => Err(err),
        Err(err) => {
            warn!(
                error = ?err,
                user_id = %session.user_id,
                validated_at = %session.validated_at,
                is_zero_pro = session.is_zero_pro,
                "failed to refresh zOS session before protected request"
            );

            if cached_session_can_cover_refresh_failure(&state, &session, auth_fresh) {
                Ok(next.run(req).await)
            } else if auth_fresh {
                Err(ApiError::service_unavailable(
                    "Unable to verify ZERO Pro subscription right now",
                ))
            } else {
                Err(ApiError::service_unavailable(
                    "Unable to verify your session right now",
                ))
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{auth_status_is_fresh, should_refresh_session};
    use aura_os_core::ZeroAuthSession;
    use chrono::{Duration, Utc};

    fn session(is_zero_pro: bool, validated_at: chrono::DateTime<Utc>) -> ZeroAuthSession {
        ZeroAuthSession {
            user_id: "u1".into(),
            network_user_id: None,
            profile_id: None,
            display_name: "Test User".into(),
            profile_image: String::new(),
            primary_zid: "0://tester".into(),
            zero_wallet: "0xabc".into(),
            wallets: vec![],
            access_token: "tok".into(),
            is_zero_pro,
            created_at: validated_at,
            validated_at,
        }
    }

    #[test]
    fn auth_refreshes_when_stale() {
        let stale_auth = Utc::now() - Duration::minutes(6);
        let session = session(true, stale_auth);

        assert!(!auth_status_is_fresh(&session));
        assert!(should_refresh_session(&session));
    }

    #[test]
    fn auth_does_not_refresh_when_fresh() {
        let now = Utc::now();
        let session = session(false, now - Duration::minutes(1));
        assert!(auth_status_is_fresh(&session));
        assert!(!should_refresh_session(&session));
    }
}
