//! Append-only writers: lifecycle entry points (`on_loop_started`,
//! `on_task_started`, `on_json_event`, `on_task_end`, `on_loop_ended`)
//! and the small fs/serialization helpers they share.

use std::path::Path;

use aura_os_core::{AgentInstanceId, ProjectId, SpecId, TaskId};
use chrono::Utc;
use serde::Serialize;
use tokio::fs;
use tokio::io::AsyncWriteExt;
use tracing::debug;

use super::{
    classify_debug_file, LoopLogWriter, RunCounters, RunMetadata, RunState, RunStatus,
    RunTaskSummary, DEBUG_EVENT_BLOCKER, DEBUG_EVENT_ITERATION, DEBUG_EVENT_LLM_CALL,
    DEBUG_EVENT_RETRY,
};

/// Wrapper used for each `events.jsonl` line. Gives consumers a stable
/// receipt timestamp even when harness events omit their own.
#[derive(Serialize)]
struct TimestampedEvent<'a> {
    #[serde(rename = "_ts")]
    ts: String,
    event: &'a serde_json::Value,
}

impl LoopLogWriter {
    /// Create a fresh run bundle and register it so subsequent event
    /// appends write to the right directory. Safe to call multiple
    /// times — a second call for the same `(project, instance)` pair
    /// replaces the in-memory pointer but leaves the previous bundle
    /// intact on disk.
    pub async fn on_loop_started(&self, project_id: ProjectId, agent_instance_id: AgentInstanceId) {
        let now = Utc::now();
        let run_id = format!("{}_{}", now.format("%Y%m%d_%H%M%S"), agent_instance_id);
        let run_dir = self.base_dir.join(project_id.to_string()).join(&run_id);
        if let Err(error) = fs::create_dir_all(&run_dir).await {
            debug!(path = %run_dir.display(), %error, "loop_log: failed to create run dir");
            return;
        }

        let metadata = RunMetadata {
            run_id: run_id.clone(),
            project_id,
            agent_instance_id,
            started_at: now,
            ended_at: None,
            status: RunStatus::Running,
            tasks: Vec::new(),
            spec_ids: Vec::new(),
            counters: RunCounters::default(),
        };
        if let Err(error) = write_metadata(&run_dir, &metadata).await {
            debug!(path = %run_dir.display(), %error, "loop_log: failed to write initial metadata");
        }

        let mut state = self.run_state.lock().await;
        state.insert(
            (project_id, agent_instance_id),
            RunState {
                run_id,
                run_dir,
                metadata,
            },
        );
    }

    /// Record the `task_id → run` mapping so `on_task_end` can write
    /// accumulated task output into the correct bundle. When
    /// `spec_id` is provided (resolved by the caller from the task
    /// DB), it is stamped on the `RunTaskSummary` and unioned into
    /// `RunMetadata::spec_ids` so the Debug UI can group runs by
    /// spec without re-walking the filesystem.
    pub async fn on_task_started(
        &self,
        project_id: ProjectId,
        agent_instance_id: AgentInstanceId,
        task_id: TaskId,
        spec_id: Option<SpecId>,
    ) {
        {
            let mut map = self.task_to_run.lock().await;
            map.insert(task_id, (project_id, agent_instance_id));
        }
        let mut state = self.run_state.lock().await;
        if let Some(run) = state.get_mut(&(project_id, agent_instance_id)) {
            let tid = task_id.to_string();
            if !run.metadata.tasks.iter().any(|t| t.task_id == tid) {
                run.metadata.tasks.push(RunTaskSummary {
                    task_id: tid,
                    spec_id,
                    started_at: Some(Utc::now()),
                    ended_at: None,
                    status: None,
                });
                if let Some(sid) = spec_id {
                    merge_spec_id(&mut run.metadata.spec_ids, sid);
                }
                let _ = write_metadata(&run.run_dir, &run.metadata).await;
            }
        }
    }

    /// Append an event to the run bundle (or fall back to a
    /// project-scoped / global file when the run isn't registered
    /// yet, typically for very-early startup frames).
    pub async fn on_json_event(
        &self,
        project_id: ProjectId,
        agent_instance_id: AgentInstanceId,
        event: &serde_json::Value,
    ) {
        let event_type = event
            .get("type")
            .and_then(|v| v.as_str())
            .unwrap_or("unknown")
            .to_owned();

        let line = match serde_json::to_string(&TimestampedEvent {
            ts: Utc::now().to_rfc3339(),
            event,
        }) {
            Ok(s) => s + "\n",
            Err(error) => {
                debug!(%error, "loop_log: failed to serialize event");
                return;
            }
        };

        let run_dir = {
            let mut state = self.run_state.lock().await;
            if let Some(run) = state.get_mut(&(project_id, agent_instance_id)) {
                run.metadata.counters.events_total += 1;
                update_counters(&mut run.metadata.counters, &event_type, event);
                if matches!(event_type.as_str(), "task_completed" | "task_failed") {
                    if let Some(tid) = event.get("task_id").and_then(|v| v.as_str()) {
                        if let Some(entry) =
                            run.metadata.tasks.iter_mut().find(|t| t.task_id == tid)
                        {
                            entry.ended_at = Some(Utc::now());
                            entry.status = Some(event_type.clone());
                        }
                    }
                }
                let _ = write_metadata(&run.run_dir, &run.metadata).await;
                Some(run.run_dir.clone())
            } else {
                None
            }
        };

        let run_dir = match run_dir {
            Some(dir) => dir,
            None => {
                let project_dir = self.base_dir.join(project_id.to_string());
                let path = project_dir.join("project_events.jsonl");
                if let Err(error) = create_dir_and_append(&project_dir, &path, &line).await {
                    debug!(%error, "loop_log: failed to append pre-run project event");
                }
                return;
            }
        };

        if let Err(error) = append_line(&run_dir.join("events.jsonl"), &line).await {
            debug!(%error, "loop_log: failed to append run event");
        }

        if let Some(file_name) = classify_debug_file(&event_type) {
            if let Err(error) = append_line(&run_dir.join(file_name), &line).await {
                debug!(%error, file = file_name, "loop_log: failed to append debug frame");
            }
        }
    }

    /// Persist accumulated task text and mark the task as ended.
    pub async fn on_task_end(&self, task_id: TaskId, output: &str) {
        let key = self.task_to_run.lock().await.get(&task_id).copied();
        let run_dir = if let Some((project_id, agent_instance_id)) = key {
            let state = self.run_state.lock().await;
            state
                .get(&(project_id, agent_instance_id))
                .map(|r| r.run_dir.clone())
        } else {
            None
        };
        if let Some(run_dir) = run_dir {
            let path = run_dir.join(format!("task_{task_id}.output.txt"));
            if let Err(error) = fs::write(&path, output).await {
                debug!(path = %path.display(), %error, "loop_log: failed to write task output");
            }
        }
        let mut map = self.task_to_run.lock().await;
        map.remove(&task_id);
    }

    /// Mark the run as finished and write the summary document.
    pub async fn on_loop_ended(
        &self,
        project_id: ProjectId,
        agent_instance_id: AgentInstanceId,
        status: RunStatus,
    ) {
        let mut state = self.run_state.lock().await;
        if let Some(run) = state.remove(&(project_id, agent_instance_id)) {
            let mut metadata = run.metadata;
            metadata.ended_at = Some(Utc::now());
            metadata.status = status;
            if let Err(error) = write_metadata(&run.run_dir, &metadata).await {
                debug!(path = %run.run_dir.display(), %error, "loop_log: failed to write final metadata");
            }
            let summary = super::read::render_summary(&metadata);
            if let Err(error) = fs::write(run.run_dir.join("summary.md"), summary).await {
                debug!(path = %run.run_dir.display(), %error, "loop_log: failed to write summary");
            }
            let _ = run.run_id;
        }
    }
}

/// Insert `spec_id` into `spec_ids` if not already present, keeping
/// the list sorted (stringwise) so the serialised JSON is stable
/// across runs regardless of insertion order. Using a `HashSet`
/// locally would be faster but would lose ordering on serialise.
fn merge_spec_id(spec_ids: &mut Vec<SpecId>, spec_id: SpecId) {
    let key = spec_id.to_string();
    match spec_ids.binary_search_by(|existing| existing.to_string().cmp(&key)) {
        Ok(_) => {}
        Err(idx) => spec_ids.insert(idx, spec_id),
    }
}

fn update_counters(counters: &mut RunCounters, event_type: &str, event: &serde_json::Value) {
    match event_type {
        DEBUG_EVENT_LLM_CALL => counters.llm_calls += 1,
        DEBUG_EVENT_ITERATION => counters.iterations += 1,
        DEBUG_EVENT_BLOCKER => counters.blockers += 1,
        DEBUG_EVENT_RETRY => counters.retries += 1,
        "tool_call_snapshot" | "tool_call_completed" | "tool_use_start" => {
            counters.tool_calls += 1;
        }
        "text_delta" => counters.narration_deltas += 1,
        "task_completed" => counters.task_completed += 1,
        "task_failed" => counters.task_failed += 1,
        "assistant_message_end" | "token_usage" => {
            // Anthropic emits `token_usage` frames throughout a turn with
            // cumulative-ish counts; summing every frame double-counts.
            // Only fold usage into the run totals when the event is a
            // terminal `assistant_message_end`, or when the frame
            // explicitly marks itself as final (either at the top level
            // or under `usage`).
            let usage = event.get("usage").unwrap_or(event);
            let is_final = event_type == "assistant_message_end"
                || event
                    .get("final")
                    .and_then(|v| v.as_bool())
                    .unwrap_or(false)
                || usage
                    .get("final")
                    .and_then(|v| v.as_bool())
                    .unwrap_or(false);
            if !is_final {
                return;
            }
            if let Some(inp) = usage.get("input_tokens").and_then(|v| v.as_u64()) {
                counters.input_tokens = counters.input_tokens.saturating_add(inp);
            }
            if let Some(out) = usage.get("output_tokens").and_then(|v| v.as_u64()) {
                counters.output_tokens = counters.output_tokens.saturating_add(out);
            }
        }
        _ => {}
    }
}

pub(super) async fn write_metadata(run_dir: &Path, metadata: &RunMetadata) -> std::io::Result<()> {
    let path = run_dir.join("metadata.json");
    let body = match serde_json::to_vec_pretty(metadata) {
        Ok(body) => body,
        Err(e) => return Err(std::io::Error::new(std::io::ErrorKind::InvalidData, e)),
    };
    fs::write(path, body).await
}

async fn append_line(path: &Path, line: &str) -> std::io::Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).await?;
    }
    let mut f = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
        .await?;
    f.write_all(line.as_bytes()).await?;
    f.flush().await
}

async fn create_dir_and_append(dir: &Path, path: &Path, line: &str) -> std::io::Result<()> {
    fs::create_dir_all(dir).await?;
    append_line(path, line).await
}
