//! Filesystem-based logging for the dev loop: flat files per project/run/task
//! for evaluating effectiveness, token usage, and reasoning.

use std::collections::HashMap;
use std::path::{Path, PathBuf};

use aura_os_core::{AgentInstanceId, ProjectId, TaskId};
use aura_engine::EngineEvent;
use chrono::Utc;
use serde::Serialize;
use tokio::fs;
use tokio::sync::Mutex;
use tracing::debug;

/// Run state for one (project_id, agent_instance_id).
struct RunState {
    _run_id: String,
    run_dir: PathBuf,
}

/// Writes all engine events and task output to flat files under a base directory.
pub(crate) struct LoopLogWriter {
    base_dir: PathBuf,
    run_state: Mutex<HashMap<(ProjectId, AgentInstanceId), RunState>>,
    task_to_run: Mutex<HashMap<TaskId, (ProjectId, AgentInstanceId)>>,
}

/// Timestamped event line: `{"_ts":"ISO8601","event":{...}}`
#[derive(Serialize)]
struct TimestampedEvent<'a> {
    _ts: String,
    event: &'a EngineEvent,
}

impl LoopLogWriter {
    pub(crate) fn new(base_dir: PathBuf) -> Self {
        Self {
            base_dir,
            run_state: Mutex::new(HashMap::new()),
            task_to_run: Mutex::new(HashMap::new()),
        }
    }

    /// Call on LoopStarted: create run dir and register run.
    pub(crate) async fn on_loop_started(&self, project_id: ProjectId, agent_instance_id: AgentInstanceId) {
        let run_id = format!(
            "{}_{}",
            Utc::now().format("%Y%m%d_%H%M%S"),
            agent_instance_id
        );
        let run_dir = self.base_dir.join(project_id.to_string()).join(&run_id);
        if let Err(e) = fs::create_dir_all(&run_dir).await {
            debug!(path = %run_dir.display(), error = %e, "loop_log: failed to create run dir");
            return;
        }
        let mut state = self.run_state.lock().await;
        state.insert(
            (project_id, agent_instance_id),
            RunState {
                _run_id: run_id,
                run_dir,
            },
        );
    }

    /// Call on TaskStarted: record task -> (project, agent) for writing output later.
    pub(crate) async fn on_task_started(
        &self,
        project_id: ProjectId,
        agent_instance_id: AgentInstanceId,
        task_id: TaskId,
    ) {
        let mut map = self.task_to_run.lock().await;
        map.insert(task_id, (project_id, agent_instance_id));
    }

    /// Append one timestamped event to the appropriate file (run, project, or global).
    pub(crate) async fn on_event(&self, event: &EngineEvent) {
        let line = match serde_json::to_string(&TimestampedEvent {
            _ts: Utc::now().to_rfc3339(),
            event,
        }) {
            Ok(s) => s + "\n",
            Err(e) => {
                debug!(error = %e, "loop_log: failed to serialize event");
                return;
            }
        };

        if let Some((project_id, agent_instance_id)) = event.run_scope() {
            let state = self.run_state.lock().await;
            if let Some(run) = state.get(&(project_id, agent_instance_id)) {
                let path = run.run_dir.join("events.jsonl");
                drop(state);
                if let Err(e) = append_line(&path, &line).await {
                    debug!(error = %e, "loop_log: failed to append run event");
                }
                return;
            }
        }

        if let Some(project_id) = event.project_id() {
            let project_dir = self.base_dir.join(project_id.to_string());
            let path = project_dir.join("project_events.jsonl");
            if let Err(e) = create_dir_and_append(&project_dir, &path, &line).await {
                debug!(error = %e, "loop_log: failed to append project event");
            }
            return;
        }

        let path = self.base_dir.join("global_events.jsonl");
        if let Err(e) = append_line(&path, &line).await {
            debug!(error = %e, "loop_log: failed to append global event");
        }
    }

    /// Call on TaskCompleted/TaskFailed: look up run from task_id, write task output to run dir, unregister task.
    pub(crate) async fn on_task_end(&self, task_id: TaskId, output: &str) {
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
            let path = run_dir.join(format!("task_{}.output.txt", task_id));
            if let Err(e) = fs::write(&path, output).await {
                debug!(path = %path.display(), error = %e, "loop_log: failed to write task output");
            }
        }
        let mut map = self.task_to_run.lock().await;
        map.remove(&task_id);
    }

    /// Call on LoopFinished/LoopStopped: remove run state.
    pub(crate) async fn on_loop_ended(&self, project_id: ProjectId, agent_instance_id: AgentInstanceId) {
        let mut state = self.run_state.lock().await;
        state.remove(&(project_id, agent_instance_id));
    }
}

async fn append_line(path: &Path, line: &str) -> std::io::Result<()> {
    let parent = path.parent().unwrap_or(path);
    fs::create_dir_all(parent).await?;
    let mut f = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .write(true)
        .open(path)
        .await?;
    use tokio::io::AsyncWriteExt;
    f.write_all(line.as_bytes()).await?;
    f.flush().await
}

async fn create_dir_and_append(dir: &Path, path: &Path, line: &str) -> std::io::Result<()> {
    fs::create_dir_all(dir).await?;
    append_line(path, line).await
}
