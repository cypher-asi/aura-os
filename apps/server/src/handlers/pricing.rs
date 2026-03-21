use axum::extract::State;
use axum::Json;

use aura_core::FeeScheduleEntry;

use crate::error::{ApiError, ApiResult};
use crate::state::AppState;

pub async fn get_fee_schedule(
    State(state): State<AppState>,
) -> ApiResult<Json<Vec<FeeScheduleEntry>>> {
    Ok(Json(state.pricing_service.get_fee_schedule()))
}

pub async fn set_fee_schedule(
    State(state): State<AppState>,
    Json(entries): Json<Vec<FeeScheduleEntry>>,
) -> ApiResult<Json<Vec<FeeScheduleEntry>>> {
    let saved = state
        .pricing_service
        .set_fee_schedule(entries)
        .map_err(ApiError::bad_request)?;
    Ok(Json(saved))
}
