//! Filesystem-based logging for the dev automation loop. Every active
//! automaton produces a "run bundle" directory on disk that captures the
//! full event stream, task outputs, per-category debug channels, and a
//! run-level metadata document. The bundle is the source of truth for
//! the Debug UI app and the `aura-run-analyze` CLI.
//!
//! Layout:
//!
//! ```text
//! {base_dir}/
//!   {project_id}/
//!     {run_id}/                     # e.g. 20260420_143022_{agent_instance_id}
//!       metadata.json               # see [`RunMetadata`]
//!       events.jsonl                # every forwarder event, 1/line
//!       llm_calls.jsonl             # harness `DebugEvent::Reasoning`
//!       iterations.jsonl            # harness iteration start/end snapshots
//!       blockers.jsonl              # `[BLOCKED]` write attempts
//!       retries.jsonl               # provider 429/529 retries
//!       task_{task_id}.output.txt   # accumulated text output per task
//!       summary.md                  # generated on loop end
//! ```
//!
//! All file writes are append-only so a crashed run leaves a usable
//! bundle on disk. Debug events the harness doesn't yet emit simply
//! leave their JSONL files empty — every downstream consumer tolerates
//! missing appenders.

use std::collections::HashMap;
use std::path::{Path, PathBuf};

use aura_os_core::{AgentInstanceId, ProjectId, TaskId};
use tokio::sync::Mutex;

// The on-disk schema lives in a small shared crate so the CLI
// (`aura-run-analyze`) and future consumers can read bundles without
// taking a dependency on this server binary.
pub use aura_loop_log_schema::{
    classify_debug_file, RunCounters, RunMetadata, RunStatus, RunTaskSummary, DEBUG_EVENT_BLOCKER,
    DEBUG_EVENT_ITERATION, DEBUG_EVENT_LLM_CALL, DEBUG_EVENT_RETRY,
};

mod read;
mod reconcile;
mod write;

/// Per-run state kept in memory so appends are O(1) without scanning
/// the filesystem. Dropped when the loop ends (or the server shuts
/// down, at which point the on-disk bundle is still intact).
pub(crate) struct RunState {
    #[allow(dead_code)]
    pub(crate) run_id: String,
    pub(crate) run_dir: PathBuf,
    pub(crate) metadata: RunMetadata,
}

/// Writes every dev-loop event and debug frame to an on-disk run
/// bundle. See module docs for the directory layout.
pub struct LoopLogWriter {
    pub(crate) base_dir: PathBuf,
    pub(crate) run_state: Mutex<HashMap<(ProjectId, AgentInstanceId), RunState>>,
    pub(crate) task_to_run: Mutex<HashMap<TaskId, (ProjectId, AgentInstanceId)>>,
}

impl LoopLogWriter {
    pub fn new(base_dir: PathBuf) -> Self {
        Self {
            base_dir,
            run_state: Mutex::new(HashMap::new()),
            task_to_run: Mutex::new(HashMap::new()),
        }
    }

    pub fn base_dir(&self) -> &Path {
        &self.base_dir
    }

    /// Absolute path to a run bundle directory. Used by exporters.
    pub fn bundle_dir(&self, project_id: ProjectId, run_id: &str) -> PathBuf {
        self.base_dir.join(project_id.to_string()).join(run_id)
    }

    /// Return the currently-open bundle for a live loop, if this
    /// process still owns its in-memory writer state.
    pub(crate) async fn active_bundle(
        &self,
        project_id: ProjectId,
        agent_instance_id: AgentInstanceId,
    ) -> Option<(String, PathBuf)> {
        let state = self.run_state.lock().await;
        state
            .get(&(project_id, agent_instance_id))
            .map(|run| (run.run_id.clone(), run.run_dir.clone()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[tokio::test]
    async fn writes_events_to_run_bundle() {
        let tmp = TempDir::new().unwrap();
        let writer = LoopLogWriter::new(tmp.path().to_path_buf());
        let pid = ProjectId::new();
        let aiid = AgentInstanceId::new();
        writer.on_loop_started(pid, aiid).await;

        let ev = serde_json::json!({"type": "text_delta", "text": "hi"});
        writer.on_json_event(pid, aiid, &ev).await;
        writer.on_loop_ended(pid, aiid, RunStatus::Completed).await;

        let runs = writer.list_runs(pid).await;
        assert_eq!(runs.len(), 1);
        let events = writer
            .read_jsonl(pid, &runs[0].run_id, "events.jsonl")
            .await
            .unwrap();
        assert!(events.contains("text_delta"));
        let summary = writer.read_summary(pid, &runs[0].run_id).await.unwrap();
        assert!(summary.contains("Run"));
        assert_eq!(runs[0].counters.events_total, 1);
        assert_eq!(runs[0].counters.narration_deltas, 1);
    }

    #[tokio::test]
    async fn token_usage_only_accumulates_on_final_frames() {
        let tmp = TempDir::new().unwrap();
        let writer = LoopLogWriter::new(tmp.path().to_path_buf());
        let pid = ProjectId::new();
        let aiid = AgentInstanceId::new();
        writer.on_loop_started(pid, aiid).await;

        // Mid-stream `token_usage` frames must NOT be folded into the
        // run totals — Anthropic streams these throughout a turn.
        for _ in 0..3 {
            let ev = serde_json::json!({
                "type": "token_usage",
                "usage": {"input_tokens": 100, "output_tokens": 50},
            });
            writer.on_json_event(pid, aiid, &ev).await;
        }

        {
            let state = writer.run_state.lock().await;
            let run = state.get(&(pid, aiid)).unwrap();
            assert_eq!(run.metadata.counters.input_tokens, 0);
            assert_eq!(run.metadata.counters.output_tokens, 0);
        }

        // A `token_usage` frame explicitly marked `final: true` under
        // `usage` should fold in once.
        let final_usage = serde_json::json!({
            "type": "token_usage",
            "usage": {"input_tokens": 100, "output_tokens": 50, "final": true},
        });
        writer.on_json_event(pid, aiid, &final_usage).await;

        // And `assistant_message_end` always counts.
        let end = serde_json::json!({
            "type": "assistant_message_end",
            "usage": {"input_tokens": 10, "output_tokens": 5},
        });
        writer.on_json_event(pid, aiid, &end).await;

        writer.on_loop_ended(pid, aiid, RunStatus::Completed).await;

        let runs = writer.list_runs(pid).await;
        assert_eq!(runs.len(), 1);
        assert_eq!(runs[0].counters.input_tokens, 110);
        assert_eq!(runs[0].counters.output_tokens, 55);
    }

    #[tokio::test]
    async fn reconcile_marks_orphans_interrupted_and_preserves_terminal_runs() {
        let tmp = TempDir::new().unwrap();

        // Orphan: started but dropped without `on_loop_ended` — simulates
        // a server crash between the start event and the cleanup path.
        let orphan_pid = ProjectId::new();
        let orphan_aiid = AgentInstanceId::new();
        {
            let writer = LoopLogWriter::new(tmp.path().to_path_buf());
            writer.on_loop_started(orphan_pid, orphan_aiid).await;
            let ev = serde_json::json!({"type": "text_delta", "text": "hi"});
            writer.on_json_event(orphan_pid, orphan_aiid, &ev).await;
            // Intentionally no `on_loop_ended`; writer drops here.
        }

        // Cleanly completed run that must survive the sweep untouched.
        let done_pid = ProjectId::new();
        let done_aiid = AgentInstanceId::new();
        {
            let writer = LoopLogWriter::new(tmp.path().to_path_buf());
            writer.on_loop_started(done_pid, done_aiid).await;
            writer
                .on_loop_ended(done_pid, done_aiid, RunStatus::Completed)
                .await;
        }

        // Fresh writer on the same base_dir — mirrors the server
        // startup path.
        let writer = LoopLogWriter::new(tmp.path().to_path_buf());
        let reconciled = writer.reconcile_orphan_runs();
        assert_eq!(reconciled, 1);

        let orphan_runs = writer.list_runs(orphan_pid).await;
        assert_eq!(orphan_runs.len(), 1);
        assert_eq!(orphan_runs[0].status, RunStatus::Interrupted);
        assert!(orphan_runs[0].ended_at.is_some());
        let summary = writer
            .read_summary(orphan_pid, &orphan_runs[0].run_id)
            .await
            .unwrap();
        assert!(summary.contains("Interrupted"));

        let done_runs = writer.list_runs(done_pid).await;
        assert_eq!(done_runs.len(), 1);
        assert_eq!(done_runs[0].status, RunStatus::Completed);

        // Idempotent: a second sweep should find nothing to fix.
        assert_eq!(writer.reconcile_orphan_runs(), 0);
    }

    #[tokio::test]
    async fn debug_events_split_into_channel_files() {
        let tmp = TempDir::new().unwrap();
        let writer = LoopLogWriter::new(tmp.path().to_path_buf());
        let pid = ProjectId::new();
        let aiid = AgentInstanceId::new();
        writer.on_loop_started(pid, aiid).await;
        let ev = serde_json::json!({"type": DEBUG_EVENT_BLOCKER, "reason": "duplicate"});
        writer.on_json_event(pid, aiid, &ev).await;
        writer.on_loop_ended(pid, aiid, RunStatus::Completed).await;

        let runs = writer.list_runs(pid).await;
        let blockers = writer
            .read_jsonl(pid, &runs[0].run_id, "blockers.jsonl")
            .await
            .unwrap();
        assert!(blockers.contains("duplicate"));
        assert_eq!(runs[0].counters.blockers, 1);
    }

    #[tokio::test]
    async fn active_bundle_is_available_until_loop_ends() {
        let tmp = TempDir::new().unwrap();
        let writer = LoopLogWriter::new(tmp.path().to_path_buf());
        let pid = ProjectId::new();
        let aiid = AgentInstanceId::new();

        assert!(writer.active_bundle(pid, aiid).await.is_none());
        writer.on_loop_started(pid, aiid).await;

        let (run_id, run_dir) = writer
            .active_bundle(pid, aiid)
            .await
            .expect("started loop should expose active bundle");
        assert!(run_dir.ends_with(&run_id));

        writer.on_loop_ended(pid, aiid, RunStatus::Completed).await;
        assert!(writer.active_bundle(pid, aiid).await.is_none());
    }

    #[tokio::test]
    async fn task_lifecycle_writes_output_and_failed_summary() {
        let tmp = TempDir::new().unwrap();
        let writer = LoopLogWriter::new(tmp.path().to_path_buf());
        let pid = ProjectId::new();
        let aiid = AgentInstanceId::new();
        let tid = TaskId::new();

        writer.on_loop_started(pid, aiid).await;
        writer.on_task_started(pid, aiid, tid, None).await;
        writer
            .on_json_event(
                pid,
                aiid,
                &serde_json::json!({"type": "task_started", "task_id": tid}),
            )
            .await;
        writer
            .on_json_event(
                pid,
                aiid,
                &serde_json::json!({"type": "task_failed", "task_id": tid, "reason": "pytest regression"}),
            )
            .await;
        writer
            .on_task_end(tid, "collected task output\npytest failed")
            .await;
        writer.on_loop_ended(pid, aiid, RunStatus::Failed).await;

        let runs = writer.list_runs(pid).await;
        assert_eq!(runs.len(), 1);
        assert_eq!(runs[0].status, RunStatus::Failed);
        assert_eq!(runs[0].tasks.len(), 1);
        assert_eq!(runs[0].tasks[0].task_id, tid.to_string());
        assert_eq!(runs[0].tasks[0].status.as_deref(), Some("task_failed"));

        let output_path = writer
            .bundle_dir(pid, &runs[0].run_id)
            .join(format!("task_{tid}.output.txt"));
        let output = tokio::fs::read_to_string(output_path).await.unwrap();
        assert!(output.contains("pytest failed"));

        let summary = writer.read_summary(pid, &runs[0].run_id).await.unwrap();
        assert!(summary.contains("Failed"));
    }
}
