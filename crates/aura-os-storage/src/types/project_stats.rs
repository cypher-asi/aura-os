//! Aggregated project statistics returned by aura-storage.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectStats {
    #[serde(default)]
    pub total_tasks: u64,
    #[serde(default)]
    pub pending_tasks: u64,
    #[serde(default)]
    pub ready_tasks: u64,
    #[serde(default)]
    pub in_progress_tasks: u64,
    #[serde(default)]
    pub blocked_tasks: u64,
    #[serde(default)]
    pub done_tasks: u64,
    #[serde(default)]
    pub failed_tasks: u64,
    #[serde(default)]
    pub completion_percentage: f64,
    #[serde(default)]
    pub total_tokens: u64,
    /// Sum of input tokens across all sessions. Some aura-storage deployments
    /// populate this (and `total_output_tokens`) alongside a zero or stale
    /// `total_tokens`; read them too so callers can fall back when needed.
    #[serde(default)]
    pub total_input_tokens: Option<u64>,
    #[serde(default)]
    pub total_output_tokens: Option<u64>,
    #[serde(default)]
    pub total_events: u64,
    #[serde(default)]
    pub total_agents: u64,
    #[serde(default)]
    pub total_sessions: u64,
    #[serde(default)]
    pub total_time_seconds: f64,
    #[serde(default)]
    pub lines_changed: u64,
    #[serde(default)]
    pub total_specs: u64,
    #[serde(default)]
    pub contributors: u64,
    #[serde(default)]
    pub estimated_cost_usd: f64,
}
