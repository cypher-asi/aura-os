use axum::extract::{Query, State};
use axum::Json;
use serde::{Deserialize, Serialize};

use crate::error::{ApiError, ApiResult};
use crate::state::AppState;

#[derive(Debug, Deserialize)]
pub struct LogEntriesQuery {
    pub limit: Option<usize>,
}

#[derive(Debug, Serialize)]
pub struct PersistedLogEntry {
    pub timestamp_ms: i64,
    pub event: serde_json::Value,
}

pub async fn list_log_entries(
    State(state): State<AppState>,
    Query(query): Query<LogEntriesQuery>,
) -> ApiResult<Json<Vec<PersistedLogEntry>>> {
    let limit = query.limit.unwrap_or(1000).min(5000);
    let raw = state
        .store
        .list_log_entries(limit)
        .map_err(|e| ApiError::internal(e.to_string()))?;

    let entries: Vec<PersistedLogEntry> = raw
        .into_iter()
        .filter_map(|(ts, bytes)| {
            let event: serde_json::Value = serde_json::from_slice(&bytes).ok()?;
            Some(PersistedLogEntry {
                timestamp_ms: ts,
                event,
            })
        })
        .collect();

    Ok(Json(entries))
}
