use aura_core::*;
use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum EngineEvent {
    LoopStarted {
        project_id: ProjectId,
        agent_id: AgentId,
    },
    TaskStarted {
        task_id: TaskId,
        task_title: String,
    },
    TaskCompleted {
        task_id: TaskId,
    },
    TaskFailed {
        task_id: TaskId,
        reason: String,
    },
    TaskRetrying {
        task_id: TaskId,
        attempt: u32,
        reason: String,
    },
    TaskBecameReady {
        task_id: TaskId,
    },
    FollowUpTaskCreated {
        task_id: TaskId,
    },
    SessionRolledOver {
        old_session_id: SessionId,
        new_session_id: SessionId,
    },
    LoopPaused {
        completed_count: usize,
    },
    LoopStopped {
        completed_count: usize,
    },
    LoopFinished {
        outcome: String,
    },
    TaskOutputDelta {
        task_id: TaskId,
        delta: String,
    },
    LogLine {
        message: String,
    },

    SpecGenStarted {
        project_id: ProjectId,
    },
    SpecGenProgress {
        project_id: ProjectId,
        stage: String,
    },
    SpecGenCompleted {
        project_id: ProjectId,
        spec_count: usize,
    },
    SpecGenFailed {
        project_id: ProjectId,
        reason: String,
    },
    SpecSaved {
        project_id: ProjectId,
        spec: Spec,
    },
}
