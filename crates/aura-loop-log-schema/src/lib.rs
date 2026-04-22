//! On-disk schema for dev-loop run bundles.
//!
//! This crate holds the serde types written by the server's
//! `loop_log` module and read by downstream consumers (CLI,
//! Debug UI, future `/summary` smart renderer). Keeping them in
//! a tiny shared crate avoids a circular dependency between the
//! server app and the analysis tooling.

use aura_os_core::{AgentInstanceId, ProjectId, SpecId};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

/// Debug-event kinds surfaced by the harness on the `/stream` websocket.
/// Any frame whose `type` matches one of these is routed to the matching
/// `.jsonl` file in addition to the main `events.jsonl`.
pub const DEBUG_EVENT_LLM_CALL: &str = "debug.llm_call";
pub const DEBUG_EVENT_ITERATION: &str = "debug.iteration";
pub const DEBUG_EVENT_BLOCKER: &str = "debug.blocker";
pub const DEBUG_EVENT_RETRY: &str = "debug.retry";

/// Bundle metadata written atomically after every `on_loop_started` /
/// terminal event so the HTTP layer can surface run information
/// without replaying `events.jsonl`.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct RunMetadata {
    pub run_id: String,
    pub project_id: ProjectId,
    pub agent_instance_id: AgentInstanceId,
    pub started_at: DateTime<Utc>,
    pub ended_at: Option<DateTime<Utc>>,
    pub status: RunStatus,
    /// Tasks observed in this run (populated from `task_started` /
    /// `task_completed`).
    pub tasks: Vec<RunTaskSummary>,
    /// Distinct specs that any task in this run touched, stable-sorted
    /// by `SpecId` string order.
    #[serde(default)]
    pub spec_ids: Vec<SpecId>,
    /// Counters kept in memory while the run is live so summary reads
    /// don't have to scan the full event file.
    pub counters: RunCounters,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RunStatus {
    Running,
    Completed,
    Failed,
    Interrupted,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct RunCounters {
    pub events_total: u64,
    pub llm_calls: u64,
    pub iterations: u64,
    pub blockers: u64,
    pub retries: u64,
    pub tool_calls: u64,
    pub task_completed: u64,
    pub task_failed: u64,
    pub input_tokens: u64,
    pub output_tokens: u64,
    /// Count of streamed assistant `text_delta` frames. A first-class
    /// narration signal so heuristics (e.g. zero-tool-calls /
    /// narration-bloat) don't have to re-scan `events.jsonl`.
    #[serde(default)]
    pub narration_deltas: u64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct RunTaskSummary {
    pub task_id: String,
    /// Spec the task belongs to, when it could be resolved at
    /// `on_task_started` time. `None` if the storage lookup failed.
    #[serde(default)]
    pub spec_id: Option<SpecId>,
    pub started_at: Option<DateTime<Utc>>,
    pub ended_at: Option<DateTime<Utc>>,
    pub status: Option<String>,
}

/// Return the filename (relative to the run bundle directory) that a
/// given event type should be routed to in addition to `events.jsonl`,
/// or `None` if the event only belongs in the main stream.
pub fn classify_debug_file(event_type: &str) -> Option<&'static str> {
    match event_type {
        DEBUG_EVENT_LLM_CALL => Some("llm_calls.jsonl"),
        DEBUG_EVENT_ITERATION => Some("iterations.jsonl"),
        DEBUG_EVENT_BLOCKER => Some("blockers.jsonl"),
        DEBUG_EVENT_RETRY => Some("retries.jsonl"),
        _ => None,
    }
}
