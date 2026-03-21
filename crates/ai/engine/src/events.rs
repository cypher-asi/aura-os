use aura_core::*;
use serde::Serialize;

use crate::git_ops::CommitInfo;

#[derive(Debug, Clone, Serialize)]
pub struct FileOpSummary {
    pub op: String,
    pub path: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct PhaseTimingEntry {
    pub phase: String,
    pub duration_ms: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum EngineEvent {
    LoopStarted {
        project_id: ProjectId,
        agent_instance_id: AgentInstanceId,
    },
    TaskStarted {
        project_id: ProjectId,
        agent_instance_id: AgentInstanceId,
        task_id: TaskId,
        task_title: String,
        session_id: SessionId,
        #[serde(skip_serializing_if = "Option::is_none")]
        prompt_tokens_estimate: Option<u64>,
        #[serde(skip_serializing_if = "Option::is_none")]
        codebase_snapshot_bytes: Option<u64>,
        #[serde(skip_serializing_if = "Option::is_none")]
        codebase_file_count: Option<u32>,
    },
    TaskCompleted {
        project_id: ProjectId,
        agent_instance_id: AgentInstanceId,
        task_id: TaskId,
        execution_notes: String,
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        file_changes: Vec<FileChangeSummary>,
        #[serde(skip_serializing_if = "Option::is_none")]
        duration_ms: Option<u64>,
        #[serde(skip_serializing_if = "Option::is_none")]
        input_tokens: Option<u64>,
        #[serde(skip_serializing_if = "Option::is_none")]
        output_tokens: Option<u64>,
        #[serde(skip_serializing_if = "Option::is_none")]
        cost_usd: Option<f64>,
        #[serde(skip_serializing_if = "Option::is_none")]
        llm_duration_ms: Option<u64>,
        #[serde(skip_serializing_if = "Option::is_none")]
        build_verify_duration_ms: Option<u64>,
        #[serde(skip_serializing_if = "Option::is_none")]
        files_changed_count: Option<u32>,
        #[serde(skip_serializing_if = "Option::is_none")]
        parse_retries: Option<u32>,
        #[serde(skip_serializing_if = "Option::is_none")]
        build_fix_attempts: Option<u32>,
        #[serde(skip_serializing_if = "Option::is_none")]
        model: Option<String>,
    },
    TaskFailed {
        project_id: ProjectId,
        agent_instance_id: AgentInstanceId,
        task_id: TaskId,
        reason: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        duration_ms: Option<u64>,
        #[serde(skip_serializing_if = "Option::is_none")]
        phase: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        parse_retries: Option<u32>,
        #[serde(skip_serializing_if = "Option::is_none")]
        build_fix_attempts: Option<u32>,
        #[serde(skip_serializing_if = "Option::is_none")]
        model: Option<String>,
    },
    TaskRetrying {
        project_id: ProjectId,
        agent_instance_id: AgentInstanceId,
        task_id: TaskId,
        attempt: u32,
        reason: String,
    },
    TaskBecameReady {
        project_id: ProjectId,
        agent_instance_id: AgentInstanceId,
        task_id: TaskId,
    },
    TasksBecameReady {
        project_id: ProjectId,
        agent_instance_id: AgentInstanceId,
        task_ids: Vec<TaskId>,
    },
    FollowUpTaskCreated {
        project_id: ProjectId,
        agent_instance_id: AgentInstanceId,
        task_id: TaskId,
    },
    SessionRolledOver {
        project_id: ProjectId,
        agent_instance_id: AgentInstanceId,
        old_session_id: SessionId,
        new_session_id: SessionId,
        #[serde(skip_serializing_if = "Option::is_none")]
        summary_duration_ms: Option<u64>,
        #[serde(skip_serializing_if = "Option::is_none")]
        context_usage_pct: Option<f64>,
    },
    LoopPaused {
        project_id: ProjectId,
        agent_instance_id: AgentInstanceId,
        completed_count: usize,
    },
    LoopStopped {
        project_id: ProjectId,
        agent_instance_id: AgentInstanceId,
        completed_count: usize,
    },
    LoopFinished {
        project_id: ProjectId,
        agent_instance_id: AgentInstanceId,
        outcome: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        total_duration_ms: Option<u64>,
        #[serde(skip_serializing_if = "Option::is_none")]
        tasks_completed: Option<usize>,
        #[serde(skip_serializing_if = "Option::is_none")]
        tasks_failed: Option<usize>,
        #[serde(skip_serializing_if = "Option::is_none")]
        tasks_retried: Option<usize>,
        #[serde(skip_serializing_if = "Option::is_none")]
        total_input_tokens: Option<u64>,
        #[serde(skip_serializing_if = "Option::is_none")]
        total_output_tokens: Option<u64>,
        #[serde(skip_serializing_if = "Option::is_none")]
        total_cost_usd: Option<f64>,
        #[serde(skip_serializing_if = "Option::is_none")]
        sessions_used: Option<usize>,
        #[serde(skip_serializing_if = "Option::is_none")]
        total_parse_retries: Option<u32>,
        #[serde(skip_serializing_if = "Option::is_none")]
        total_build_fix_attempts: Option<u32>,
        #[serde(skip_serializing_if = "Option::is_none")]
        duplicate_error_bailouts: Option<u32>,
    },
    LoopIterationSummary {
        project_id: ProjectId,
        agent_instance_id: AgentInstanceId,
        task_id: TaskId,
        phase_timings: Vec<PhaseTimingEntry>,
    },
    TaskOutputDelta {
        project_id: ProjectId,
        agent_instance_id: AgentInstanceId,
        task_id: TaskId,
        delta: String,
    },
    FileOpsApplied {
        project_id: ProjectId,
        agent_instance_id: AgentInstanceId,
        task_id: TaskId,
        files_written: usize,
        files_deleted: usize,
        files: Vec<FileOpSummary>,
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

    PlanSubmitted {
        project_id: ProjectId,
        agent_instance_id: AgentInstanceId,
        task_id: TaskId,
        approach: String,
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        files_to_modify: Vec<String>,
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        files_to_create: Vec<String>,
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        key_decisions: Vec<String>,
    },

    BuildVerificationSkipped {
        project_id: ProjectId,
        agent_instance_id: AgentInstanceId,
        task_id: TaskId,
        reason: String,
    },
    BuildVerificationStarted {
        project_id: ProjectId,
        agent_instance_id: AgentInstanceId,
        task_id: TaskId,
        command: String,
    },
    BuildVerificationPassed {
        project_id: ProjectId,
        agent_instance_id: AgentInstanceId,
        task_id: TaskId,
        command: String,
        stdout: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        duration_ms: Option<u64>,
    },
    BuildVerificationFailed {
        project_id: ProjectId,
        agent_instance_id: AgentInstanceId,
        task_id: TaskId,
        command: String,
        stdout: String,
        stderr: String,
        attempt: u32,
        #[serde(skip_serializing_if = "Option::is_none")]
        duration_ms: Option<u64>,
        #[serde(skip_serializing_if = "Option::is_none")]
        error_hash: Option<String>,
    },
    BuildFixAttempt {
        project_id: ProjectId,
        agent_instance_id: AgentInstanceId,
        task_id: TaskId,
        attempt: u32,
    },

    TestVerificationStarted {
        project_id: ProjectId,
        agent_instance_id: AgentInstanceId,
        task_id: TaskId,
        command: String,
    },
    TestVerificationPassed {
        project_id: ProjectId,
        agent_instance_id: AgentInstanceId,
        task_id: TaskId,
        command: String,
        stdout: String,
        tests: Vec<IndividualTestResult>,
        summary: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        duration_ms: Option<u64>,
    },
    TestVerificationFailed {
        project_id: ProjectId,
        agent_instance_id: AgentInstanceId,
        task_id: TaskId,
        command: String,
        stdout: String,
        stderr: String,
        attempt: u32,
        tests: Vec<IndividualTestResult>,
        summary: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        duration_ms: Option<u64>,
    },
    TestFixAttempt {
        project_id: ProjectId,
        agent_instance_id: AgentInstanceId,
        task_id: TaskId,
        attempt: u32,
    },

    GitCommitted {
        project_id: ProjectId,
        agent_instance_id: AgentInstanceId,
        task_id: TaskId,
        commit_sha: String,
        message: String,
    },
    GitPushed {
        project_id: ProjectId,
        agent_instance_id: AgentInstanceId,
        spec_id: SpecId,
        repo: String,
        branch: String,
        commits: Vec<CommitInfo>,
        summary: String,
    },

    /// Event bridged from aura-network WebSocket (feed activity, follows, usage updates).
    NetworkEvent {
        network_event_type: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        payload: Option<serde_json::Value>,
    },
}

impl EngineEvent {
    /// Extract the project_id from any variant that carries one.
    pub fn project_id(&self) -> Option<ProjectId> {
        match self {
            Self::LoopStarted { project_id, .. }
            | Self::TaskStarted { project_id, .. }
            | Self::TaskCompleted { project_id, .. }
            | Self::TaskFailed { project_id, .. }
            | Self::TaskRetrying { project_id, .. }
            | Self::TaskBecameReady { project_id, .. }
            | Self::TasksBecameReady { project_id, .. }
            | Self::FollowUpTaskCreated { project_id, .. }
            | Self::SessionRolledOver { project_id, .. }
            | Self::LoopPaused { project_id, .. }
            | Self::LoopStopped { project_id, .. }
            | Self::LoopFinished { project_id, .. }
            | Self::LoopIterationSummary { project_id, .. }
            | Self::TaskOutputDelta { project_id, .. }
            | Self::FileOpsApplied { project_id, .. }
            | Self::SpecGenStarted { project_id, .. }
            | Self::SpecGenProgress { project_id, .. }
            | Self::SpecGenCompleted { project_id, .. }
            | Self::SpecGenFailed { project_id, .. }
            | Self::SpecSaved { project_id, .. }
            | Self::PlanSubmitted { project_id, .. }
            | Self::BuildVerificationSkipped { project_id, .. }
            | Self::BuildVerificationStarted { project_id, .. }
            | Self::BuildVerificationPassed { project_id, .. }
            | Self::BuildVerificationFailed { project_id, .. }
            | Self::BuildFixAttempt { project_id, .. }
            | Self::TestVerificationStarted { project_id, .. }
            | Self::TestVerificationPassed { project_id, .. }
            | Self::TestVerificationFailed { project_id, .. }
            | Self::TestFixAttempt { project_id, .. }
            | Self::GitCommitted { project_id, .. }
            | Self::GitPushed { project_id, .. } => Some(*project_id),
            Self::LogLine { .. } | Self::NetworkEvent { .. } => None,
        }
    }

    /// Extract the (project_id, agent_instance_id) scope for run-level log routing.
    pub fn run_scope(&self) -> Option<(ProjectId, AgentInstanceId)> {
        match self {
            Self::LoopStarted { project_id, agent_instance_id }
            | Self::TaskStarted { project_id, agent_instance_id, .. }
            | Self::TaskCompleted { project_id, agent_instance_id, .. }
            | Self::TaskFailed { project_id, agent_instance_id, .. }
            | Self::TaskRetrying { project_id, agent_instance_id, .. }
            | Self::TaskBecameReady { project_id, agent_instance_id, .. }
            | Self::TasksBecameReady { project_id, agent_instance_id, .. }
            | Self::FollowUpTaskCreated { project_id, agent_instance_id, .. }
            | Self::SessionRolledOver { project_id, agent_instance_id, .. }
            | Self::LoopPaused { project_id, agent_instance_id, .. }
            | Self::LoopStopped { project_id, agent_instance_id, .. }
            | Self::LoopFinished { project_id, agent_instance_id, .. }
            | Self::LoopIterationSummary { project_id, agent_instance_id, .. }
            | Self::TaskOutputDelta { project_id, agent_instance_id, .. }
            | Self::FileOpsApplied { project_id, agent_instance_id, .. }
            | Self::PlanSubmitted { project_id, agent_instance_id, .. }
            | Self::BuildVerificationSkipped { project_id, agent_instance_id, .. }
            | Self::BuildVerificationStarted { project_id, agent_instance_id, .. }
            | Self::BuildVerificationPassed { project_id, agent_instance_id, .. }
            | Self::BuildVerificationFailed { project_id, agent_instance_id, .. }
            | Self::BuildFixAttempt { project_id, agent_instance_id, .. }
            | Self::TestVerificationStarted { project_id, agent_instance_id, .. }
            | Self::TestVerificationPassed { project_id, agent_instance_id, .. }
            | Self::TestVerificationFailed { project_id, agent_instance_id, .. }
            | Self::TestFixAttempt { project_id, agent_instance_id, .. } => {
                Some((*project_id, *agent_instance_id))
            }
            _ => None,
        }
    }
}
