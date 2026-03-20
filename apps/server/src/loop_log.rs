//! Filesystem-based logging for the dev loop: flat files per project/run/task
//! for evaluating effectiveness, token usage, and reasoning.

use std::collections::HashMap;
use std::path::{Path, PathBuf};

use aura_core::{AgentInstanceId, ProjectId, TaskId};
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
pub struct LoopLogWriter {
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
    pub fn new(base_dir: PathBuf) -> Self {
        Self {
            base_dir,
            run_state: Mutex::new(HashMap::new()),
            task_to_run: Mutex::new(HashMap::new()),
        }
    }

    /// Call on LoopStarted: create run dir and register run.
    pub async fn on_loop_started(&self, project_id: ProjectId, agent_instance_id: AgentInstanceId) {
        let run_id = format!(
            "{}_{}",
            Utc::now().format("%Y%m%d_%H%M%S"),
            agent_instance_id
        );
        let run_dir = self
            .base_dir
            .join(project_id.to_string())
            .join(&run_id);
        if let Err(e) = fs::create_dir_all(&run_dir).await {
            debug!("loop_log: failed to create run dir {}: {}", run_dir.display(), e);
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
    pub async fn on_task_started(
        &self,
        project_id: ProjectId,
        agent_instance_id: AgentInstanceId,
        task_id: TaskId,
    ) {
        let mut map = self.task_to_run.lock().await;
        map.insert(task_id, (project_id, agent_instance_id));
    }

    /// Append one timestamped event to the appropriate file (run, project, or global).
    pub async fn on_event(&self, event: &EngineEvent) {
        let line = match serde_json::to_string(&TimestampedEvent {
            _ts: Utc::now().to_rfc3339(),
            event,
        }) {
            Ok(s) => s + "\n",
            Err(e) => {
                debug!("loop_log: failed to serialize event: {}", e);
                return;
            }
        };

        if let Some((project_id, agent_instance_id)) = event_run_scope(event) {
            let state = self.run_state.lock().await;
            if let Some(run) = state.get(&(project_id, agent_instance_id)) {
                let path = run.run_dir.join("events.jsonl");
                drop(state);
                if let Err(e) = append_line(&path, &line).await {
                    debug!("loop_log: failed to append run event: {}", e);
                }
                return;
            }
        }

        if let Some(project_id) = event_project_id(event) {
            let project_dir = self.base_dir.join(project_id.to_string());
            let path = project_dir.join("project_events.jsonl");
            if let Err(e) = create_dir_and_append(&project_dir, &path, &line).await {
                debug!("loop_log: failed to append project event: {}", e);
            }
            return;
        }

        let path = self.base_dir.join("global_events.jsonl");
        if let Err(e) = append_line(&path, &line).await {
            debug!("loop_log: failed to append global event: {}", e);
        }
    }

    /// Call on TaskCompleted/TaskFailed: look up run from task_id, write task output to run dir, unregister task.
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
            let path = run_dir.join(format!("task_{}.output.txt", task_id));
            if let Err(e) = fs::write(&path, output).await {
                debug!("loop_log: failed to write task output {}: {}", path.display(), e);
            }
        }
        let mut map = self.task_to_run.lock().await;
        map.remove(&task_id);
    }

    /// Call on LoopFinished/LoopStopped: remove run state.
    pub async fn on_loop_ended(&self, project_id: ProjectId, agent_instance_id: AgentInstanceId) {
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

async fn create_dir_and_append(
    dir: &Path,
    path: &Path,
    line: &str,
) -> std::io::Result<()> {
    fs::create_dir_all(dir).await?;
    append_line(path, line).await
}

fn event_project_id(event: &EngineEvent) -> Option<ProjectId> {
    match event {
        EngineEvent::LoopStarted { project_id, .. }
        | EngineEvent::TaskStarted { project_id, .. }
        | EngineEvent::TaskCompleted { project_id, .. }
        | EngineEvent::TaskFailed { project_id, .. }
        | EngineEvent::TaskRetrying { project_id, .. }
        | EngineEvent::TaskBecameReady { project_id, .. }
        | EngineEvent::TasksBecameReady { project_id, .. }
        | EngineEvent::FollowUpTaskCreated { project_id, .. }
        | EngineEvent::SessionRolledOver { project_id, .. }
        | EngineEvent::LoopPaused { project_id, .. }
        | EngineEvent::LoopStopped { project_id, .. }
        | EngineEvent::LoopFinished { project_id, .. }
        | EngineEvent::LoopIterationSummary { project_id, .. }
        | EngineEvent::TaskOutputDelta { project_id, .. }
        | EngineEvent::FileOpsApplied { project_id, .. }
        | EngineEvent::SpecGenStarted { project_id, .. }
        | EngineEvent::SpecGenProgress { project_id, .. }
        | EngineEvent::SpecGenCompleted { project_id, .. }
        | EngineEvent::SpecGenFailed { project_id, .. }
        | EngineEvent::SpecSaved { project_id, .. }
        | EngineEvent::BuildVerificationSkipped { project_id, .. }
        | EngineEvent::BuildVerificationStarted { project_id, .. }
        | EngineEvent::BuildVerificationPassed { project_id, .. }
        | EngineEvent::BuildVerificationFailed { project_id, .. }
        | EngineEvent::BuildFixAttempt { project_id, .. }
        | EngineEvent::TestVerificationStarted { project_id, .. }
        | EngineEvent::TestVerificationPassed { project_id, .. }
        | EngineEvent::TestVerificationFailed { project_id, .. }
        | EngineEvent::TestFixAttempt { project_id, .. } => Some(*project_id),
        EngineEvent::LogLine { .. } | EngineEvent::NetworkEvent { .. } => None,
    }
}

fn event_run_scope(event: &EngineEvent) -> Option<(ProjectId, AgentInstanceId)> {
    match event {
        EngineEvent::LoopStarted {
            project_id,
            agent_instance_id,
        }
        | EngineEvent::TaskStarted {
            project_id,
            agent_instance_id,
            ..
        }
        | EngineEvent::TaskCompleted {
            project_id,
            agent_instance_id,
            ..
        }
        | EngineEvent::TaskFailed {
            project_id,
            agent_instance_id,
            ..
        }
        | EngineEvent::TaskRetrying {
            project_id,
            agent_instance_id,
            ..
        }
        | EngineEvent::TaskBecameReady {
            project_id,
            agent_instance_id,
            ..
        }
        | EngineEvent::TasksBecameReady {
            project_id,
            agent_instance_id,
            ..
        }
        | EngineEvent::FollowUpTaskCreated {
            project_id,
            agent_instance_id,
            ..
        }
        | EngineEvent::SessionRolledOver {
            project_id,
            agent_instance_id,
            ..
        }
        | EngineEvent::LoopPaused {
            project_id,
            agent_instance_id,
            ..
        }
        | EngineEvent::LoopStopped {
            project_id,
            agent_instance_id,
            ..
        }
        | EngineEvent::LoopFinished {
            project_id,
            agent_instance_id,
            ..
        }
        | EngineEvent::LoopIterationSummary {
            project_id,
            agent_instance_id,
            ..
        }
        | EngineEvent::TaskOutputDelta {
            project_id,
            agent_instance_id,
            ..
        }
        | EngineEvent::FileOpsApplied {
            project_id,
            agent_instance_id,
            ..
        }
        | EngineEvent::BuildVerificationSkipped {
            project_id,
            agent_instance_id,
            ..
        }
        | EngineEvent::BuildVerificationStarted {
            project_id,
            agent_instance_id,
            ..
        }
        | EngineEvent::BuildVerificationPassed {
            project_id,
            agent_instance_id,
            ..
        }
        | EngineEvent::BuildVerificationFailed {
            project_id,
            agent_instance_id,
            ..
        }
        | EngineEvent::BuildFixAttempt {
            project_id,
            agent_instance_id,
            ..
        }
        | EngineEvent::TestVerificationStarted {
            project_id,
            agent_instance_id,
            ..
        }
        | EngineEvent::TestVerificationPassed {
            project_id,
            agent_instance_id,
            ..
        }
        | EngineEvent::TestVerificationFailed {
            project_id,
            agent_instance_id,
            ..
        }
        | EngineEvent::TestFixAttempt {
            project_id,
            agent_instance_id,
            ..
        } => Some((*project_id, *agent_instance_id)),
        _ => None,
    }
}
