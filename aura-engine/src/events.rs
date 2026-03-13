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
    LogLine {
        message: String,
    },
}
