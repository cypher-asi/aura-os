use axum::extract::{Query, State};
use axum::Json;
use chrono::DateTime;
use serde::{Deserialize, Serialize};

use crate::error::ApiResult;
use crate::state::AppState;

#[derive(Debug, Deserialize)]
pub struct LogEntriesQuery {
    pub limit: Option<usize>,
    pub project_id: Option<String>,
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

    // Primary: aggregate log entries from aura-storage across projects
    if let (Some(ref storage), Ok(jwt)) = (&state.storage_client, state.get_jwt()) {
        let project_ids: Vec<String> = if let Some(ref pid) = query.project_id {
            vec![pid.clone()]
        } else {
            state
                .project_service
                .list_projects()
                .unwrap_or_default()
                .iter()
                .map(|p| p.project_id.to_string())
                .collect()
        };

        let mut entries = Vec::new();
        for pid in &project_ids {
            if let Ok(storage_logs) = storage
                .list_log_entries(pid, &jwt, None, Some(limit as u32), None)
                .await
            {
                for sl in &storage_logs {
                    let timestamp_ms = sl
                        .created_at
                        .as_deref()
                        .and_then(|s| DateTime::parse_from_rfc3339(s).ok())
                        .map(|dt| dt.timestamp_millis())
                        .unwrap_or(0);
                    let event = sl
                        .metadata
                        .clone()
                        .unwrap_or_else(|| serde_json::json!({
                            "type": "log_line",
                            "message": sl.message.clone().unwrap_or_default(),
                        }));
                    entries.push(PersistedLogEntry { timestamp_ms, event });
                }
            }
        }

        entries.sort_by(|a, b| a.timestamp_ms.cmp(&b.timestamp_ms));
        if entries.len() > limit {
            entries = entries.split_off(entries.len() - limit);
        }
        return Ok(Json(entries));
    }

    Ok(Json(Vec::new()))
}
