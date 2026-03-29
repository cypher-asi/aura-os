use axum::extract::{Path, Query, State};
use axum::Json;
use serde::{Deserialize, Serialize};

use aura_os_core::OrgId;
use aura_os_network::{LeaderboardEntry, MemberUsageStats, PlatformStats, UsageStats};

use crate::error::{map_network_error, ApiResult};
use crate::state::{AppState, AuthJwt};

// ---------------------------------------------------------------------------
// Leaderboard
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
pub(crate) struct LeaderboardQuery {
    pub period: Option<String>,
    pub org_id: Option<String>,
}

#[derive(Debug, Serialize)]
pub(crate) struct LeaderboardEntryResponse {
    pub profile_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub display_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub avatar_url: Option<String>,
    pub tokens_used: u64,
    pub estimated_cost_usd: f64,
    pub event_count: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub profile_type: Option<String>,
}

impl From<LeaderboardEntry> for LeaderboardEntryResponse {
    fn from(e: LeaderboardEntry) -> Self {
        Self {
            profile_id: e.profile_id,
            display_name: e.display_name,
            avatar_url: e.avatar_url,
            tokens_used: e.tokens_used,
            estimated_cost_usd: e.estimated_cost_usd,
            event_count: e.event_count,
            profile_type: e.profile_type,
        }
    }
}

pub(crate) async fn get_leaderboard(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    Query(query): Query<LeaderboardQuery>,
) -> ApiResult<Json<Vec<LeaderboardEntryResponse>>> {
    let client = state.require_network_client()?;
    let period = query.period.as_deref().unwrap_or("all");
    let entries = client
        .get_leaderboard(period, query.org_id.as_deref(), &jwt)
        .await
        .map_err(map_network_error)?;
    Ok(Json(
        entries
            .into_iter()
            .map(LeaderboardEntryResponse::from)
            .collect(),
    ))
}

// ---------------------------------------------------------------------------
// Usage
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
pub(crate) struct UsageQuery {
    pub period: Option<String>,
}

#[derive(Debug, Serialize)]
pub(crate) struct UsageResponse {
    pub total_tokens: u64,
    pub total_input_tokens: u64,
    pub total_output_tokens: u64,
    pub total_cost_usd: f64,
}

impl From<UsageStats> for UsageResponse {
    fn from(u: UsageStats) -> Self {
        Self {
            total_tokens: u.total_tokens,
            total_input_tokens: u.total_input_tokens,
            total_output_tokens: u.total_output_tokens,
            total_cost_usd: u.total_cost_usd,
        }
    }
}

#[derive(Debug, Serialize)]
pub(crate) struct MemberUsageResponse {
    pub user_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub display_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub avatar_url: Option<String>,
    pub total_tokens: u64,
    pub total_cost_usd: f64,
}

impl From<MemberUsageStats> for MemberUsageResponse {
    fn from(m: MemberUsageStats) -> Self {
        Self {
            user_id: m.user_id,
            display_name: m.display_name,
            avatar_url: m.avatar_url,
            total_tokens: m.total_tokens,
            total_cost_usd: m.total_cost_usd,
        }
    }
}

pub(crate) async fn get_personal_usage(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    Query(query): Query<UsageQuery>,
) -> ApiResult<Json<UsageResponse>> {
    let client = state.require_network_client()?;
    let period = query.period.as_deref().unwrap_or("all");
    let usage = client
        .get_personal_usage(period, &jwt)
        .await
        .map_err(map_network_error)?;
    Ok(Json(UsageResponse::from(usage)))
}

pub(crate) async fn get_org_usage(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    Path(org_id): Path<OrgId>,
    Query(query): Query<UsageQuery>,
) -> ApiResult<Json<UsageResponse>> {
    let client = state.require_network_client()?;
    let org_id_str = org_id.to_string();
    let period = query.period.as_deref().unwrap_or("all");
    let usage = client
        .get_org_usage(&org_id_str, period, &jwt)
        .await
        .map_err(map_network_error)?;
    Ok(Json(UsageResponse::from(usage)))
}

pub(crate) async fn get_org_usage_members(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    Path(org_id): Path<OrgId>,
) -> ApiResult<Json<Vec<MemberUsageResponse>>> {
    let client = state.require_network_client()?;
    let org_id_str = org_id.to_string();
    let members = client
        .get_org_usage_members(&org_id_str, &jwt)
        .await
        .map_err(map_network_error)?;
    Ok(Json(
        members.into_iter().map(MemberUsageResponse::from).collect(),
    ))
}

// ---------------------------------------------------------------------------
// Platform Stats
// ---------------------------------------------------------------------------

#[derive(Debug, Serialize)]
pub(crate) struct PlatformStatsResponse {
    pub id: String,
    pub date: String,
    pub daily_active_users: i32,
    pub total_users: i32,
    pub new_signups: i32,
    pub projects_created: i32,
    pub total_input_tokens: i64,
    pub total_output_tokens: i64,
    pub total_revenue_usd: f64,
    pub created_at: String,
}

impl From<PlatformStats> for PlatformStatsResponse {
    fn from(s: PlatformStats) -> Self {
        Self {
            id: s.id,
            date: s.date,
            daily_active_users: s.daily_active_users,
            total_users: s.total_users,
            new_signups: s.new_signups,
            projects_created: s.projects_created,
            total_input_tokens: s.total_input_tokens,
            total_output_tokens: s.total_output_tokens,
            total_revenue_usd: s.total_revenue_usd,
            created_at: s.created_at,
        }
    }
}

pub(crate) async fn get_platform_stats(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
) -> ApiResult<Json<Option<PlatformStatsResponse>>> {
    let client = state.require_network_client()?;
    let stats = client
        .get_platform_stats(&jwt)
        .await
        .map_err(map_network_error)?;
    Ok(Json(stats.map(PlatformStatsResponse::from)))
}
