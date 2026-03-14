use std::path::Path;

use chrono::Utc;
use serde::Serialize;
use tracing::warn;

use crate::events::PhaseTimingEntry;

const METRICS_DIR: &str = ".aura";
const LAST_RUN_FILE: &str = "last_run_metrics.json";
const HISTORY_FILE: &str = "run_history.jsonl";

#[derive(Debug, Clone, Serialize)]
pub struct TaskMetrics {
    pub task_id: String,
    pub title: String,
    pub outcome: String,
    pub duration_ms: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub llm_duration_ms: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub build_verify_duration_ms: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub file_ops_duration_ms: Option<u64>,
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub files_changed: u32,
    pub parse_retries: u32,
    pub build_fix_attempts: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub failure_phase: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub failure_reason: Option<String>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub phase_timings: Vec<PhaseTimingEntry>,
}

#[derive(Debug, Clone, Serialize)]
pub struct LoopRunMetrics {
    pub timestamp: String,
    pub project_id: String,
    pub outcome: String,
    pub total_duration_ms: u64,
    pub tasks_completed: usize,
    pub tasks_failed: usize,
    pub tasks_retried: usize,
    pub total_input_tokens: u64,
    pub total_output_tokens: u64,
    pub estimated_cost_usd: f64,
    pub sessions_used: usize,
    pub total_parse_retries: u32,
    pub total_build_fix_attempts: u32,
    pub duplicate_error_bailouts: u32,
    pub tasks: Vec<TaskMetrics>,
}

impl LoopRunMetrics {
    pub fn new(project_id: String) -> Self {
        Self {
            timestamp: Utc::now().to_rfc3339(),
            project_id,
            outcome: String::new(),
            total_duration_ms: 0,
            tasks_completed: 0,
            tasks_failed: 0,
            tasks_retried: 0,
            total_input_tokens: 0,
            total_output_tokens: 0,
            estimated_cost_usd: 0.0,
            sessions_used: 1,
            total_parse_retries: 0,
            total_build_fix_attempts: 0,
            duplicate_error_bailouts: 0,
            tasks: Vec::new(),
        }
    }

    #[allow(clippy::too_many_arguments)]
    pub fn finalize(
        &mut self,
        outcome: &str,
        total_duration_ms: u64,
        completed: usize,
        failed: usize,
        retried: usize,
        input_tokens: u64,
        output_tokens: u64,
        sessions: usize,
        parse_retries: u32,
        build_fix_attempts: u32,
        dup_bailouts: u32,
    ) {
        self.outcome = outcome.to_string();
        self.total_duration_ms = total_duration_ms;
        self.tasks_completed = completed;
        self.tasks_failed = failed;
        self.tasks_retried = retried;
        self.total_input_tokens = input_tokens;
        self.total_output_tokens = output_tokens;
        self.sessions_used = sessions;
        self.total_parse_retries = parse_retries;
        self.total_build_fix_attempts = build_fix_attempts;
        self.duplicate_error_bailouts = dup_bailouts;
        // Sonnet pricing: $3/M input, $15/M output
        self.estimated_cost_usd = (input_tokens as f64 * 3.0
            + output_tokens as f64 * 15.0)
            / 1_000_000.0;
    }
}

/// Write metrics to `<project_root>/.aura/last_run_metrics.json` (overwrite)
/// and append to `<project_root>/.aura/run_history.jsonl`.
pub fn write_run_metrics(project_root: &Path, metrics: &LoopRunMetrics) {
    let dir = project_root.join(METRICS_DIR);
    if let Err(e) = std::fs::create_dir_all(&dir) {
        warn!("Failed to create {}: {e}", dir.display());
        return;
    }

    // last_run_metrics.json -- always overwritten
    let last_run_path = dir.join(LAST_RUN_FILE);
    match serde_json::to_string_pretty(metrics) {
        Ok(json) => {
            if let Err(e) = std::fs::write(&last_run_path, json.as_bytes()) {
                warn!("Failed to write {}: {e}", last_run_path.display());
            }
        }
        Err(e) => warn!("Failed to serialize metrics: {e}"),
    }

    // run_history.jsonl -- append one line per run
    let history_path = dir.join(HISTORY_FILE);
    match serde_json::to_string(metrics) {
        Ok(line) => {
            use std::io::Write;
            match std::fs::OpenOptions::new()
                .create(true)
                .append(true)
                .open(&history_path)
            {
                Ok(mut f) => {
                    if let Err(e) = writeln!(f, "{line}") {
                        warn!("Failed to append to {}: {e}", history_path.display());
                    }
                }
                Err(e) => warn!("Failed to open {}: {e}", history_path.display()),
            }
        }
        Err(e) => warn!("Failed to serialize metrics for history: {e}"),
    }
}
