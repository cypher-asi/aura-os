use axum::extract::State;
use axum::Json;

use aura_os_core::ApiKeyInfo;

use crate::error::{ApiError, ApiResult};
use crate::state::AppState;

pub async fn get_api_key_info(State(state): State<AppState>) -> ApiResult<Json<ApiKeyInfo>> {
    let info = state
        .settings_service
        .get_api_key_info()
        .map_err(|e| ApiError::internal(format!("fetching api key info: {e}")))?;
    Ok(Json(info))
}
