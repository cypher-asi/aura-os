use super::*;

/// Check the validation cache for a fresh session. Returns the session if
/// cached and within the refresh TTL.
pub(super) fn get_cached_session(
    state: &AppState,
    jwt: &str,
) -> Option<(ZeroAuthSession, Option<String>)> {
    let entry = state.validation_cache.get(jwt)?;
    if entry.validated_at.elapsed() < AUTH_REFRESH_TTL {
        Some((entry.session.clone(), entry.zero_pro_refresh_error.clone()))
    } else {
        None
    }
}

pub(super) fn get_stale_cached_session(
    state: &AppState,
    jwt: &str,
) -> Option<(ZeroAuthSession, Option<String>)> {
    let entry = state.validation_cache.get(jwt)?;
    if entry.validated_at.elapsed() <= AUTH_STALE_FALLBACK_MAX_AGE {
        Some((entry.session.clone(), entry.zero_pro_refresh_error.clone()))
    } else {
        None
    }
}
