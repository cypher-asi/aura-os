use super::*;

pub(super) fn enforce_zero_pro(
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
