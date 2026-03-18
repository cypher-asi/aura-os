use std::path::Path;

use chrono::Utc;
use serde::Serialize;
use tracing::warn;

use aura_core::FeeScheduleEntry;
use aura_billing::{compute_cost_with_rates, lookup_rate_in};
use crate::engine::types::{TaskOutcome, TaskTimings};
use crate::events::PhaseTimingEntry;

const METRICS_DIR: &str = ".aura";
const LAST_RUN_FILE: &str = "last_run_metrics.json";
const HISTORY_FILE: &str = "run_history.jsonl";
const TASK_HISTORY_FILE: &str = "task_history.jsonl";

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

impl TaskMetrics {
    fn base(task_id: String, title: String, outcome: &str, duration_ms: u64, model: Option<String>) -> Self {
        Self {
            task_id, title, outcome: outcome.into(), duration_ms, model,
            llm_duration_ms: None, build_verify_duration_ms: None, file_ops_duration_ms: None,
            input_tokens: 0, output_tokens: 0,
            files_changed: 0, parse_retries: 0, build_fix_attempts: 0,
            failure_phase: None, failure_reason: None,
            phase_timings: vec![],
        }
    }

    pub fn completed(task_id: String, title: String, duration_ms: u64, model: Option<String>) -> Self {
        Self::base(task_id, title, "completed", duration_ms, model)
    }

    pub fn failed(
        task_id: String, title: String, duration_ms: u64, model: Option<String>,
        phase: &str, reason: String,
    ) -> Self {
        let mut m = Self::base(task_id, title, "failed", duration_ms, model);
        m.failure_phase = Some(phase.into());
        m.failure_reason = Some(reason);
        m
    }

    pub fn with_tokens(mut self, input: u64, output: u64) -> Self {
        self.input_tokens = input; self.output_tokens = output; self
    }

    pub fn with_llm_duration(mut self, ms: u64) -> Self {
        self.llm_duration_ms = Some(ms); self
    }

    pub fn with_build_verify_duration(mut self, ms: u64) -> Self {
        self.build_verify_duration_ms = Some(ms); self
    }

    pub fn with_file_ops_duration(mut self, ms: u64) -> Self {
        self.file_ops_duration_ms = Some(ms); self
    }

    pub fn with_files_changed(mut self, count: u32) -> Self {
        self.files_changed = count; self
    }

    pub fn with_parse_retries(mut self, count: u32) -> Self {
        self.parse_retries = count; self
    }

    pub fn with_build_fix_attempts(mut self, count: u32) -> Self {
        self.build_fix_attempts = count; self
    }

    pub fn with_phase_timings(mut self, timings: Vec<PhaseTimingEntry>) -> Self {
        self.phase_timings = timings; self
    }

    fn from_timings(task_id: String, title: String, model: Option<String>, t: &TaskTimings) -> Self {
        Self::base(task_id, title, "completed", t.task_duration_ms, model)
            .with_tokens(t.total_input(), t.total_output())
            .with_llm_duration(t.llm_duration_ms)
            .with_file_ops_duration(t.file_ops_duration_ms)
            .with_build_verify_duration(t.build_verify_duration_ms)
            .with_files_changed(t.files_changed)
            .with_parse_retries(t.parse_retries)
            .with_build_fix_attempts(t.build_fix_attempts)
            .with_phase_timings(vec![
                PhaseTimingEntry { phase: "llm_call".into(), duration_ms: t.llm_duration_ms },
                PhaseTimingEntry { phase: "file_ops".into(), duration_ms: t.file_ops_duration_ms },
                PhaseTimingEntry { phase: "build_verify".into(), duration_ms: t.build_verify_duration_ms },
            ])
    }

    pub(crate) fn from_outcome(task_id: String, title: String, model: Option<String>, outcome: &TaskOutcome) -> Self {
        match outcome {
            TaskOutcome::Completed { timings, .. } => {
                Self::from_timings(task_id, title, model, timings)
            }
            TaskOutcome::Failed { reason, phase, timings, .. } => {
                let mut m = Self::from_timings(task_id, title, model, timings);
                m.outcome = "failed".into();
                m.failure_phase = Some(phase.clone());
                m.failure_reason = Some(reason.clone());
                m
            }
        }
    }
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

    /// Recompute aggregate counters from the tasks vec and current loop state.
    /// Call this before writing a live snapshot so the file stays accurate.
    pub fn snapshot(
        &mut self,
        total_duration_ms: u64,
        sessions: usize,
        tasks_retried: usize,
        duplicate_error_bailouts: u32,
        fee_schedule: &[FeeScheduleEntry],
    ) {
        self.outcome = "in_progress".to_string();
        self.total_duration_ms = total_duration_ms;
        self.sessions_used = sessions;
        self.tasks_retried = tasks_retried;
        self.duplicate_error_bailouts = duplicate_error_bailouts;
        self.recompute_aggregates(fee_schedule);
    }

    pub fn finalize(
        &mut self,
        outcome: &str,
        total_duration_ms: u64,
        sessions: usize,
        tasks_retried: usize,
        duplicate_error_bailouts: u32,
        fee_schedule: &[FeeScheduleEntry],
    ) {
        self.outcome = outcome.to_string();
        self.total_duration_ms = total_duration_ms;
        self.sessions_used = sessions;
        self.tasks_retried = tasks_retried;
        self.duplicate_error_bailouts = duplicate_error_bailouts;
        self.recompute_aggregates(fee_schedule);
    }

    fn recompute_aggregates(&mut self, fee_schedule: &[FeeScheduleEntry]) {
        self.tasks_completed = self.tasks.iter().filter(|t| t.outcome == "completed").count();
        self.tasks_failed = self.tasks.iter().filter(|t| t.outcome == "failed").count();
        self.total_input_tokens = self.tasks.iter().map(|t| t.input_tokens).sum();
        self.total_output_tokens = self.tasks.iter().map(|t| t.output_tokens).sum();
        self.total_parse_retries = self.tasks.iter().map(|t| t.parse_retries).sum();
        self.total_build_fix_attempts = self.tasks.iter().map(|t| t.build_fix_attempts).sum();
        self.estimated_cost_usd = self.tasks.iter().map(|t| {
            let model = t.model.as_deref().unwrap_or("claude-opus-4-6");
            let (inp_rate, out_rate) = lookup_rate_in(fee_schedule, model);
            compute_cost_with_rates(t.input_tokens, t.output_tokens, inp_rate, out_rate)
        }).sum();
    }
}

/// Ensure the `.aura` directory exists under `project_root`, returning
/// the path on success or `None` if creation failed.
fn ensure_metrics_dir(project_root: &Path) -> Option<std::path::PathBuf> {
    let dir = project_root.join(METRICS_DIR);
    if let Err(e) = std::fs::create_dir_all(&dir) {
        warn!("Failed to create {}: {e}", dir.display());
        return None;
    }
    Some(dir)
}

/// Overwrite `last_run_metrics.json` with the current snapshot.
fn write_snapshot_file(dir: &Path, metrics: &LoopRunMetrics) {
    let path = dir.join(LAST_RUN_FILE);
    match serde_json::to_string_pretty(metrics) {
        Ok(json) => {
            if let Err(e) = std::fs::write(&path, json.as_bytes()) {
                warn!("Failed to write {}: {e}", path.display());
            }
        }
        Err(e) => warn!("Failed to serialize metrics: {e}"),
    }
}

/// Append a single JSON line to the given file.
fn append_jsonl(path: &Path, line: &str) {
    use std::io::Write;
    match std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
    {
        Ok(mut f) => {
            if let Err(e) = writeln!(f, "{line}") {
                warn!("Failed to append to {}: {e}", path.display());
            }
        }
        Err(e) => warn!("Failed to open {}: {e}", path.display()),
    }
}

/// Write a live snapshot after each task completes or fails.
///
/// - Overwrites `last_run_metrics.json` with current aggregate state
/// - Appends the individual `TaskMetrics` to `task_history.jsonl`
pub fn write_live_snapshot(project_root: &Path, metrics: &LoopRunMetrics, task: &TaskMetrics) {
    let Some(dir) = ensure_metrics_dir(project_root) else {
        return;
    };
    write_snapshot_file(&dir, metrics);
    if let Ok(line) = serde_json::to_string(task) {
        append_jsonl(&dir.join(TASK_HISTORY_FILE), &line);
    }
}

/// Write metrics for a single-task run (not the full loop).
///
/// Wraps the `TaskMetrics` in a one-task `LoopRunMetrics`, overwrites
/// `last_run_metrics.json`, and appends to both `task_history.jsonl`
/// and `run_history.jsonl`.
pub fn write_single_task_metrics(
    project_root: &Path,
    project_id: &str,
    task: TaskMetrics,
    fee_schedule: &[FeeScheduleEntry],
) {
    let Some(dir) = ensure_metrics_dir(project_root) else {
        return;
    };

    let mut run = LoopRunMetrics::new(project_id.to_string());
    let outcome = task.outcome.clone();
    run.tasks.push(task.clone());
    run.finalize(&outcome, task.duration_ms, 1, 0, 0, fee_schedule);

    write_snapshot_file(&dir, &run);
    if let Ok(line) = serde_json::to_string(&task) {
        append_jsonl(&dir.join(TASK_HISTORY_FILE), &line);
    }
    if let Ok(line) = serde_json::to_string(&run) {
        append_jsonl(&dir.join(HISTORY_FILE), &line);
    }
}

/// Write final metrics at loop exit.
///
/// - Overwrites `last_run_metrics.json` with final state
/// - Appends the full run to `run_history.jsonl`
pub fn write_run_metrics(project_root: &Path, metrics: &LoopRunMetrics) {
    let Some(dir) = ensure_metrics_dir(project_root) else {
        return;
    };
    write_snapshot_file(&dir, metrics);
    if let Ok(line) = serde_json::to_string(metrics) {
        append_jsonl(&dir.join(HISTORY_FILE), &line);
    }
}
