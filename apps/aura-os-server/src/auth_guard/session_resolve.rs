use super::cache::{get_cached_session, get_stale_cached_session};
use super::error_map::map_auth_error;
use super::*;

/// Validate a JWT against zOS and update the cache.
pub(super) async fn validate_and_cache(
    state: &AppState,
    jwt: &str,
) -> Result<(ZeroAuthSession, Option<String>), (StatusCode, Json<ApiError>)> {
    let result = state
        .auth_service
        .validate_token(jwt)
        .await
        .map_err(map_auth_error)?;

    let zero_pro_refresh_error = result.zero_pro_refresh_error.clone();
    let session = result.session.clone();

    state.validation_cache.insert(
        jwt.to_string(),
        CachedSession {
            session: session.clone(),
            validated_at: Instant::now(),
            zero_pro_refresh_error: zero_pro_refresh_error.clone(),
        },
    );

    Ok((session, zero_pro_refresh_error))
}

/// Resolve a session from a JWT: check cache first (unless `allow_validation_cache` is false),
/// then validate with zOS. On zOS network failure, falls back to a stale cached entry if available.
pub(super) async fn resolve_session_from_jwt(
    state: &AppState,
    jwt: &str,
    allow_validation_cache: bool,
    allow_stale_fallback: bool,
) -> Result<AuthResolution, (StatusCode, Json<ApiError>)> {
    if is_capture_access_token(jwt) {
        if let Some((session, zp)) = get_cached_session(state, jwt) {
            return Ok(AuthResolution {
                session,
                zero_pro_refresh_error: zp,
                degraded: false,
            });
        }
        if let Some(session) = capture_session_from_access_token(jwt) {
            state.validation_cache.insert(
                jwt.to_string(),
                CachedSession {
                    session: session.clone(),
                    validated_at: Instant::now(),
                    zero_pro_refresh_error: None,
                },
            );
            return Ok(AuthResolution {
                session,
                zero_pro_refresh_error: None,
                degraded: false,
            });
        }
        return Err(ApiError::unauthorized("capture session expired"));
    }

    if allow_validation_cache {
        if let Some((session, zp)) = get_cached_session(state, jwt) {
            return Ok(AuthResolution {
                session,
                zero_pro_refresh_error: zp,
                degraded: false,
            });
        }
    }

    match validate_and_cache(state, jwt).await {
        Ok((session, zero_pro_refresh_error)) => Ok(AuthResolution {
            session,
            zero_pro_refresh_error,
            degraded: false,
        }),
        Err(err) if err.0 == StatusCode::UNAUTHORIZED => Err(err),
        Err(err) => {
            if !allow_stale_fallback {
                return Err(err);
            }

            // zOS unreachable -- try stale cache entry as fallback
            if let Some((session, zero_pro_refresh_error)) = get_stale_cached_session(state, jwt) {
                warn!(
                    user_id = %session.user_id,
                    "zOS unreachable, using stale cached session"
                );
                Ok(AuthResolution {
                    session,
                    zero_pro_refresh_error,
                    degraded: true,
                })
            } else {
                Err(err)
            }
        }
    }
}
