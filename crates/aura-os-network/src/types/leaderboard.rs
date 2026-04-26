use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LeaderboardEntry {
    #[serde(alias = "profile_id")]
    pub profile_id: String,
    #[serde(default, alias = "display_name", alias = "name")]
    pub display_name: Option<String>,
    #[serde(default, alias = "avatar_url")]
    pub avatar_url: Option<String>,
    #[serde(default, alias = "tokens_used")]
    pub tokens_used: u64,
    #[serde(default, alias = "estimated_cost_usd")]
    pub estimated_cost_usd: f64,
    #[serde(default, alias = "event_count")]
    pub event_count: u64,
    #[serde(default, alias = "profile_type")]
    pub profile_type: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlatformStats {
    #[serde(default)]
    pub id: Option<String>,
    #[serde(default)]
    pub date: Option<String>,
    #[serde(default, alias = "daily_active_users", alias = "dau")]
    pub daily_active_users: i32,
    #[serde(
        default,
        alias = "total_users",
        alias = "user_count",
        alias = "userCount"
    )]
    pub total_users: i32,
    #[serde(
        default,
        alias = "new_signups",
        alias = "new_users",
        alias = "newUsers",
        alias = "signups",
        alias = "newSignupsToday",
        alias = "new_signups_today",
        alias = "signups_today",
        alias = "signupsToday"
    )]
    pub new_signups: i32,
    #[serde(
        default,
        alias = "projects_created",
        alias = "project_count",
        alias = "projectCount",
        alias = "projects_count",
        alias = "projectsCount",
        alias = "total_projects",
        alias = "totalProjects",
        alias = "projects"
    )]
    pub projects_created: i32,
    #[serde(
        default,
        alias = "total_input_tokens",
        alias = "input_tokens",
        alias = "inputTokens"
    )]
    pub total_input_tokens: i64,
    #[serde(
        default,
        alias = "total_output_tokens",
        alias = "output_tokens",
        alias = "outputTokens"
    )]
    pub total_output_tokens: i64,
    #[serde(
        default,
        alias = "total_revenue_usd",
        alias = "revenue_usd",
        alias = "revenueUsd",
        alias = "total_revenue",
        alias = "totalRevenue",
        alias = "revenue",
        alias = "totalCostUsd",
        alias = "total_cost_usd",
        alias = "cost_usd",
        alias = "costUsd",
        alias = "total_cost",
        alias = "totalCost"
    )]
    pub total_revenue_usd: f64,
    #[serde(default, alias = "created_at")]
    pub created_at: Option<String>,
}
