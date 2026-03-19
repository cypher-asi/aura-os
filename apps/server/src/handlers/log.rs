use axum::extract::{Query, State};
use axum::Json;
use chrono::DateTime;
use serde::{Deserialize, Serialize};

use crate::error::ApiResult;
use crate::handlers::projects;
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
            projects::list_all_projects_from_network(&state)
                .await
                .unwrap_or_default()
                .iter()
                .map(|p| p.project_id.to_string())
                .collect()
        };

        let log_futs: Vec<_> = project_ids
            .iter()
            .map(|pid| storage.list_log_entries(pid, &jwt, None, None, None))
            .collect();
        let log_results = futures_util::future::join_all(log_futs).await;

        let mut entries = Vec::new();
        for (i, result) in log_results.into_iter().enumerate() {
            match result {
                Ok(storage_logs) => {
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
                Err(e) => {
                    tracing::warn!(
                        project_id = %project_ids[i], error = %e,
                        "Failed to list log entries from storage"
                    );
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
