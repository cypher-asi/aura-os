use axum::extract::{Query, State};
use axum::Json;
use chrono::DateTime;
use futures_util::{stream, StreamExt};
use serde::{Deserialize, Serialize};

use crate::error::{ApiError, ApiResult};
use crate::handlers::projects;
use crate::state::{AppState, AuthJwt};

const DEFAULT_LOG_LIMIT: usize = 1000;
const MAX_LOG_LIMIT: usize = 5000;
const MAX_AGGREGATED_PROJECTS: usize = 50;
const MAX_LOG_FETCH_CONCURRENCY: usize = 8;
const PER_PROJECT_LOG_FETCH_SLACK: usize = 50;

#[derive(Debug, Deserialize)]
pub(crate) struct LogEntriesQuery {
    pub limit: Option<usize>,
    pub project_id: Option<String>,
}

#[derive(Debug, Serialize)]
pub(crate) struct PersistedLogEntry {
    pub timestamp_ms: i64,
    pub event: serde_json::Value,
}

async fn aggregate_storage_logs(
    storage: &aura_os_storage::StorageClient,
    jwt: &str,
    project_ids: &[String],
    limit: usize,
) -> Vec<PersistedLogEntry> {
    let project_count = project_ids.len().max(1);
    let per_project_limit = if project_count == 1 {
        limit
    } else {
        limit
            .div_ceil(project_count)
            .saturating_add(PER_PROJECT_LOG_FETCH_SLACK)
            .min(MAX_LOG_LIMIT)
    } as u32;

    let mut entries = Vec::new();
    let log_results = stream::iter(project_ids.iter().cloned())
        .map(|project_id| async move {
            let result = storage
                .list_log_entries(&project_id, jwt, None, Some(per_project_limit), None)
                .await;
            (project_id, result)
        })
        .buffer_unordered(MAX_LOG_FETCH_CONCURRENCY)
        .collect::<Vec<_>>()
        .await;

    for (project_id, result) in log_results {
        match result {
            Ok(storage_logs) => {
                for sl in &storage_logs {
                    let timestamp_ms = sl
                        .created_at
                        .as_deref()
                        .and_then(|s| DateTime::parse_from_rfc3339(s).ok())
                        .map(|dt| dt.timestamp_millis())
                        .unwrap_or(0);
                    let event = sl.metadata.clone().unwrap_or_else(|| {
                        serde_json::json!({
                            "type": "log_line",
                            "message": sl.message.clone().unwrap_or_default(),
                        })
                    });
                    entries.push(PersistedLogEntry {
                        timestamp_ms,
                        event,
                    });
                }
            }
            Err(e) => {
                tracing::warn!(
                    project_id = %project_id, error = %e,
                    "Failed to list log entries from storage"
                );
            }
        }
    }
    entries
}

pub(crate) async fn list_log_entries(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    Query(query): Query<LogEntriesQuery>,
) -> ApiResult<Json<Vec<PersistedLogEntry>>> {
    let limit = query.limit.unwrap_or(DEFAULT_LOG_LIMIT).min(MAX_LOG_LIMIT);

    if let Some(ref storage) = state.storage_client {
        let project_ids: Vec<String> = if let Some(ref pid) = query.project_id {
            vec![pid.clone()]
        } else {
            projects::list_all_projects_from_network(&state, &jwt)
                .await
                .unwrap_or_default()
                .iter()
                .map(|p| p.project_id.to_string())
                .collect()
        };
        if query.project_id.is_none() && project_ids.len() > MAX_AGGREGATED_PROJECTS {
            return Err(ApiError::bad_request(format!(
                "log aggregation is limited to {MAX_AGGREGATED_PROJECTS} projects; pass project_id to narrow the request"
            )));
        }

        let mut entries = aggregate_storage_logs(storage, &jwt, &project_ids, limit).await;
        entries.sort_by(|a, b| a.timestamp_ms.cmp(&b.timestamp_ms));
        if entries.len() > limit {
            entries = entries.split_off(entries.len() - limit);
        }
        return Ok(Json(entries));
    }

    Ok(Json(Vec::new()))
}
