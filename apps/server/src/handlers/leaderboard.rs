use axum::extract::{Path, Query, State};
use axum::Json;
use serde::{Deserialize, Serialize};

use aura_network::{LeaderboardEntry, MemberUsageStats, UsageStats};

use crate::error::{map_network_error, ApiResult};
use crate::state::AppState;

// ---------------------------------------------------------------------------
// Leaderboard
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
pub struct LeaderboardQuery {
    pub period: Option<String>,
    pub org_id: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct LeaderboardEntryResponse {
    pub profile_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub display_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub avatar_url: Option<String>,
    pub tokens_used: u64,
    pub rank: u32,
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
            rank: e.rank,
            profile_type: e.profile_type,
        }
    }
}

pub async fn get_leaderboard(
    State(state): State<AppState>,
    Query(query): Query<LeaderboardQuery>,
) -> ApiResult<Json<Vec<LeaderboardEntryResponse>>> {
    let client = state.require_network_client()?;
    let jwt = state.get_jwt()?;
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
pub struct UsageQuery {
    pub period: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct UsageResponse {
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
pub struct MemberUsageResponse {
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

pub async fn get_personal_usage(
    State(state): State<AppState>,
    Query(query): Query<UsageQuery>,
) -> ApiResult<Json<UsageResponse>> {
    let client = state.require_network_client()?;
    let jwt = state.get_jwt()?;
    let period = query.period.as_deref().unwrap_or("all");
    let usage = client
        .get_personal_usage(period, &jwt)
        .await
        .map_err(map_network_error)?;
    Ok(Json(UsageResponse::from(usage)))
}

pub async fn get_org_usage(
    State(state): State<AppState>,
    Path(org_id): Path<String>,
    Query(query): Query<UsageQuery>,
) -> ApiResult<Json<UsageResponse>> {
    let client = state.require_network_client()?;
    let jwt = state.get_jwt()?;
    let period = query.period.as_deref().unwrap_or("all");
    let usage = client
        .get_org_usage(&org_id, period, &jwt)
        .await
        .map_err(map_network_error)?;
    Ok(Json(UsageResponse::from(usage)))
}

pub async fn get_org_usage_members(
    State(state): State<AppState>,
    Path(org_id): Path<String>,
) -> ApiResult<Json<Vec<MemberUsageResponse>>> {
    let client = state.require_network_client()?;
    let jwt = state.get_jwt()?;
    let members = client
        .get_org_usage_members(&org_id, &jwt)
        .await
        .map_err(map_network_error)?;
    Ok(Json(
        members
            .into_iter()
            .map(MemberUsageResponse::from)
            .collect(),
    ))
}
