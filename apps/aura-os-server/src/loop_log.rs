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

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};

use aura_os_core::{AgentInstanceId, ProjectId, SpecId, TaskId};
use chrono::Utc;
use serde::Serialize;
use tokio::fs;
use tokio::io::AsyncWriteExt;
use tokio::sync::Mutex;
use tracing::{debug, info};

// The on-disk schema lives in a small shared crate so the CLI
// (`aura-run-analyze`) and future consumers can read bundles without
// taking a dependency on this server binary.
pub use aura_loop_log_schema::{
    classify_debug_file, RunCounters, RunMetadata, RunStatus, RunTaskSummary, DEBUG_EVENT_BLOCKER,
    DEBUG_EVENT_ITERATION, DEBUG_EVENT_LLM_CALL, DEBUG_EVENT_RETRY,
};

/// Per-run state kept in memory so appends are O(1) without scanning
/// the filesystem. Dropped when the loop ends (or the server shuts
/// down, at which point the on-disk bundle is still intact).
struct RunState {
    run_id: String,
    run_dir: PathBuf,
    metadata: RunMetadata,
}

/// Writes every dev-loop event and debug frame to an on-disk run
/// bundle. See module docs for the directory layout.
pub struct LoopLogWriter {
    base_dir: PathBuf,
    run_state: Mutex<HashMap<(ProjectId, AgentInstanceId), RunState>>,
    task_to_run: Mutex<HashMap<TaskId, (ProjectId, AgentInstanceId)>>,
}

/// Wrapper used for each `events.jsonl` line. Gives consumers a stable
/// receipt timestamp even when harness events omit their own.
#[derive(Serialize)]
struct TimestampedEvent<'a> {
    #[serde(rename = "_ts")]
    ts: String,
    event: &'a serde_json::Value,
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
            let summary = render_summary(&metadata);
            if let Err(error) = fs::write(run.run_dir.join("summary.md"), summary).await {
                debug!(path = %run.run_dir.display(), %error, "loop_log: failed to write summary");
            }
            let _ = run.run_id;
        }
    }

    // ---------------------------------------------------------------
    // Read APIs used by the HTTP surface / CLI
    // ---------------------------------------------------------------

    /// List every run bundle for a single project, newest first.
    pub async fn list_runs(&self, project_id: ProjectId) -> Vec<RunMetadata> {
        let project_dir = self.base_dir.join(project_id.to_string());
        let mut entries = match fs::read_dir(&project_dir).await {
            Ok(entries) => entries,
            Err(_) => return Vec::new(),
        };
        let mut runs: Vec<RunMetadata> = Vec::new();
        while let Ok(Some(entry)) = entries.next_entry().await {
            let path = entry.path();
            if !path.is_dir() {
                continue;
            }
            if let Some(meta) = read_metadata(&path).await {
                runs.push(meta);
            }
        }
        runs.sort_by(|a, b| b.started_at.cmp(&a.started_at));
        runs
    }

    /// List every project id that has at least one run bundle on disk.
    pub async fn list_projects(&self) -> Vec<ProjectId> {
        let mut entries = match fs::read_dir(&self.base_dir).await {
            Ok(entries) => entries,
            Err(_) => return Vec::new(),
        };
        let mut seen: HashSet<ProjectId> = HashSet::new();
        while let Ok(Some(entry)) = entries.next_entry().await {
            if !entry.path().is_dir() {
                continue;
            }
            if let Some(name) = entry.file_name().to_str() {
                if let Ok(id) = name.parse::<ProjectId>() {
                    seen.insert(id);
                }
            }
        }
        seen.into_iter().collect()
    }

    pub async fn read_metadata(&self, project_id: ProjectId, run_id: &str) -> Option<RunMetadata> {
        let dir = self.bundle_dir(project_id, run_id);
        read_metadata(&dir).await
    }

    pub async fn read_jsonl(
        &self,
        project_id: ProjectId,
        run_id: &str,
        file_name: &str,
    ) -> Option<String> {
        let path = self.bundle_dir(project_id, run_id).join(file_name);
        fs::read_to_string(&path).await.ok()
    }

    pub async fn read_summary(&self, project_id: ProjectId, run_id: &str) -> Option<String> {
        let path = self.bundle_dir(project_id, run_id).join("summary.md");
        match fs::read_to_string(&path).await {
            Ok(content) => Some(content),
            Err(_) => {
                let metadata = self.read_metadata(project_id, run_id).await?;
                Some(render_summary(&metadata))
            }
        }
    }

    /// Absolute path to a run bundle directory. Used by exporters.
    pub fn bundle_dir(&self, project_id: ProjectId, run_id: &str) -> PathBuf {
        self.base_dir.join(project_id.to_string()).join(run_id)
    }

    /// Walk every run bundle on disk and flip any metadata still stuck
    /// at `status: Running` to `Interrupted`. This exists because the
    /// only writer of a terminal status is `on_loop_ended`, which runs
    /// inside a tokio task spawned by the dev-loop handler. If the
    /// server crashes, is killed, or that task is aborted before it
    /// reaches the cleanup path, the bundle is left permanently
    /// "Running" on disk — which the Debug UI then surfaces in its
    /// "Running now" list forever.
    ///
    /// Call this once at startup, *before* handing the writer to
    /// `AppState` / routes. At that point the in-memory `run_state`
    /// is empty so any on-disk `Running` is by definition orphaned
    /// from a previous process lifetime.
    ///
    /// Kept synchronous so it composes with the sync `build_app_state`
    /// constructor without forcing every caller into an async runtime.
    /// The filesystem walk only touches bundle directories and rewrites
    /// a small JSON file per orphan, so blocking briefly on startup is
    /// fine.
    pub fn reconcile_orphan_runs(&self) -> usize {
        let mut reconciled = 0usize;
        let project_entries = match std::fs::read_dir(&self.base_dir) {
            Ok(entries) => entries,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return 0,
            Err(error) => {
                debug!(
                    path = %self.base_dir.display(),
                    %error,
                    "loop_log: failed to scan base_dir during reconciliation",
                );
                return 0;
            }
        };

        for project_entry in project_entries.flatten() {
            let project_dir = project_entry.path();
            if !project_dir.is_dir() {
                continue;
            }
            let run_entries = match std::fs::read_dir(&project_dir) {
                Ok(entries) => entries,
                Err(error) => {
                    debug!(
                        path = %project_dir.display(),
                        %error,
                        "loop_log: failed to scan project dir during reconciliation",
                    );
                    continue;
                }
            };
            for run_entry in run_entries.flatten() {
                let run_dir = run_entry.path();
                if !run_dir.is_dir() {
                    continue;
                }
                match reconcile_one_run(&run_dir) {
                    Ok(true) => reconciled += 1,
                    Ok(false) => {}
                    Err(error) => debug!(
                        path = %run_dir.display(),
                        %error,
                        "loop_log: failed to reconcile orphan run",
                    ),
                }
            }
        }

        if reconciled > 0 {
            info!(
                reconciled,
                base_dir = %self.base_dir.display(),
                "loop_log: marked orphaned running runs as interrupted on startup",
            );
        }
        reconciled
    }
}

/// Reconcile a single run directory. Returns `Ok(true)` when the
/// metadata was actually rewritten (i.e. we flipped a `Running` to
/// `Interrupted`), `Ok(false)` when the bundle was already terminal
/// or had no metadata.json.
fn reconcile_one_run(run_dir: &Path) -> std::io::Result<bool> {
    let metadata_path = run_dir.join("metadata.json");
    let raw = match std::fs::read(&metadata_path) {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(false),
        Err(error) => return Err(error),
    };
    let mut metadata: RunMetadata = match serde_json::from_slice(&raw) {
        Ok(meta) => meta,
        Err(error) => {
            debug!(
                path = %metadata_path.display(),
                %error,
                "loop_log: metadata.json unreadable during reconciliation",
            );
            return Ok(false);
        }
    };
    if metadata.status != RunStatus::Running {
        return Ok(false);
    }

    // Prefer the events.jsonl mtime as the "last observed activity"
    // timestamp — metadata.json is re-written on every event, so its
    // own mtime is effectively the same value, but events.jsonl is a
    // better fit when bundles exist without a recent metadata write.
    // Fall back to metadata.json, then to now().
    let ended_at = last_activity(run_dir).unwrap_or_else(Utc::now);

    metadata.status = RunStatus::Interrupted;
    if metadata.ended_at.is_none() {
        metadata.ended_at = Some(ended_at);
    }

    let body = serde_json::to_vec_pretty(&metadata)
        .map_err(|error| std::io::Error::new(std::io::ErrorKind::InvalidData, error))?;
    std::fs::write(&metadata_path, body)?;

    // Backfill summary.md for anything that never reached `on_loop_ended`
    // so the Debug sidekick's summary tab isn't empty for interrupted
    // runs.
    let summary_path = run_dir.join("summary.md");
    if !summary_path.exists() {
        let summary = render_summary(&metadata);
        if let Err(error) = std::fs::write(&summary_path, summary) {
            debug!(
                path = %summary_path.display(),
                %error,
                "loop_log: failed to backfill summary.md during reconciliation",
            );
        }
    }

    info!(
        run_id = %metadata.run_id,
        project_id = %metadata.project_id,
        ended_at = %metadata.ended_at.map(|t| t.to_rfc3339()).unwrap_or_default(),
        "loop_log: reconciled orphan run -> interrupted",
    );
    Ok(true)
}

/// Most recent modified-time across `events.jsonl` and `metadata.json`,
/// converted to UTC. Used to backfill `ended_at` for interrupted runs.
fn last_activity(run_dir: &Path) -> Option<chrono::DateTime<Utc>> {
    let mut best: Option<std::time::SystemTime> = None;
    for name in ["events.jsonl", "metadata.json"] {
        if let Ok(meta) = std::fs::metadata(run_dir.join(name)) {
            if let Ok(modified) = meta.modified() {
                best = Some(match best {
                    Some(current) if current >= modified => current,
                    _ => modified,
                });
            }
        }
    }
    best.map(chrono::DateTime::<Utc>::from)
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

async fn write_metadata(run_dir: &Path, metadata: &RunMetadata) -> std::io::Result<()> {
    let path = run_dir.join("metadata.json");
    let body = match serde_json::to_vec_pretty(metadata) {
        Ok(body) => body,
        Err(e) => return Err(std::io::Error::new(std::io::ErrorKind::InvalidData, e)),
    };
    fs::write(path, body).await
}

async fn read_metadata(run_dir: &Path) -> Option<RunMetadata> {
    let raw = fs::read(run_dir.join("metadata.json")).await.ok()?;
    serde_json::from_slice(&raw).ok()
}

fn render_summary(metadata: &RunMetadata) -> String {
    use std::fmt::Write;
    let mut out = String::new();
    let _ = writeln!(out, "# Run {}", metadata.run_id);
    let _ = writeln!(out);
    let _ = writeln!(out, "- project_id: `{}`", metadata.project_id);
    let _ = writeln!(out, "- agent_instance_id: `{}`", metadata.agent_instance_id);
    let _ = writeln!(out, "- started_at: {}", metadata.started_at.to_rfc3339());
    if let Some(ended) = metadata.ended_at {
        let duration = ended.signed_duration_since(metadata.started_at);
        let _ = writeln!(out, "- ended_at: {}", ended.to_rfc3339());
        let _ = writeln!(out, "- duration: {}s", duration.num_seconds().max(0));
    }
    let _ = writeln!(out, "- status: {:?}", metadata.status);
    let _ = writeln!(out);
    let _ = writeln!(out, "## Counters");
    let c = &metadata.counters;
    let _ = writeln!(out, "- events_total: {}", c.events_total);
    let _ = writeln!(out, "- llm_calls: {}", c.llm_calls);
    let _ = writeln!(out, "- iterations: {}", c.iterations);
    let _ = writeln!(out, "- blockers: {}", c.blockers);
    let _ = writeln!(out, "- retries: {}", c.retries);
    let _ = writeln!(out, "- tool_calls: {}", c.tool_calls);
    let _ = writeln!(out, "- narration_deltas: {}", c.narration_deltas);
    let _ = writeln!(out, "- task_completed: {}", c.task_completed);
    let _ = writeln!(out, "- task_failed: {}", c.task_failed);
    let _ = writeln!(out, "- input_tokens: {}", c.input_tokens);
    let _ = writeln!(out, "- output_tokens: {}", c.output_tokens);
    let _ = writeln!(out);
    if !metadata.tasks.is_empty() {
        let _ = writeln!(out, "## Tasks");
        for task in &metadata.tasks {
            let status = task.status.as_deref().unwrap_or("in_progress");
            let _ = writeln!(out, "- `{}` — {}", task.task_id, status);
        }
    }
    out
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
}
