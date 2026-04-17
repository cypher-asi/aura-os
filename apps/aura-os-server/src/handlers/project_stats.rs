use axum::extract::{Path, State};
use axum::Json;
use serde::Serialize;
use tracing::info;

use aura_os_core::ProjectId;
use aura_os_storage::ProjectStats;

use crate::error::{map_storage_error, ApiResult};
use crate::state::{AppState, AuthJwt};

#[derive(Debug, Serialize)]
pub(crate) struct ProjectStatsResponse {
    pub total_tasks: u64,
    pub pending_tasks: u64,
    pub ready_tasks: u64,
    pub in_progress_tasks: u64,
    pub blocked_tasks: u64,
    pub done_tasks: u64,
    pub failed_tasks: u64,
    pub completion_percentage: f64,
    pub total_tokens: u64,
    pub total_events: u64,
    pub total_agents: u64,
    pub total_sessions: u64,
    pub total_time_seconds: f64,
    pub lines_changed: u64,
    pub total_specs: u64,
    pub contributors: u64,
    pub estimated_cost_usd: f64,
}

impl From<ProjectStats> for ProjectStatsResponse {
    fn from(s: ProjectStats) -> Self {
        // Some aura-storage deployments leave the aggregate `total_tokens`
        // column at 0 while still populating `total_input_tokens` /
        // `total_output_tokens` (and `estimated_cost_usd`). Fall back to the
        // component columns so the UI stays consistent with the displayed
        // cost instead of showing 0 tokens next to $0.11.
        let summed_storage_tokens = s
            .total_input_tokens
            .unwrap_or(0)
            .saturating_add(s.total_output_tokens.unwrap_or(0));
        let total_tokens = if s.total_tokens > 0 {
            s.total_tokens
        } else {
            summed_storage_tokens
        };

        Self {
            total_tasks: s.total_tasks,
            pending_tasks: s.pending_tasks,
            ready_tasks: s.ready_tasks,
            in_progress_tasks: s.in_progress_tasks,
            blocked_tasks: s.blocked_tasks,
            done_tasks: s.done_tasks,
            failed_tasks: s.failed_tasks,
            completion_percentage: s.completion_percentage,
            total_tokens,
            total_events: s.total_events,
            total_agents: s.total_agents,
            total_sessions: s.total_sessions,
            total_time_seconds: s.total_time_seconds,
            lines_changed: s.lines_changed,
            total_specs: s.total_specs,
            contributors: s.contributors,
            estimated_cost_usd: s.estimated_cost_usd,
        }
    }
}

pub(crate) async fn get_project_stats(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    Path(project_id): Path<ProjectId>,
) -> ApiResult<Json<ProjectStatsResponse>> {
    let client = state.require_storage_client()?;
    let stats = client
        .get_project_stats(&project_id.to_string(), &jwt)
        .await
        .map_err(map_storage_error)?;
    info!(
        %project_id,
        storage_total_tokens = stats.total_tokens,
        storage_total_input_tokens = ?stats.total_input_tokens,
        storage_total_output_tokens = ?stats.total_output_tokens,
        storage_estimated_cost_usd = stats.estimated_cost_usd,
        "aura-storage project stats fetched"
    );
    Ok(Json(ProjectStatsResponse::from(stats)))
}
