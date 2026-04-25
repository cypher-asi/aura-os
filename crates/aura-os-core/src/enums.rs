use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ProjectStatus {
    Planning,
    Active,
    Paused,
    Completed,
    Archived,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TaskStatus {
    Backlog,
    ToDo,
    Pending,
    Ready,
    InProgress,
    Blocked,
    Done,
    Failed,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AgentStatus {
    Idle,
    Working,
    Blocked,
    Stopped,
    Error,
    Archived,
}

/// Functional role an `AgentInstance` plays inside a project.
///
/// This is the foundation for the multi-instance concurrency model
/// (see `concurrent-agent-loops` plan, Phase 2): the upstream harness
/// enforces "one in-flight turn per `agent_id`", so a single instance
/// cannot simultaneously serve a chat turn, an automation loop, and a
/// task run. Instead, each project hosts at least:
///
/// * one `Chat` instance — the default target for the main chat
///   surface,
/// * one `Loop` instance — the default target for the automation loop,
/// * any number of ephemeral `Executor` instances — one per concurrent
///   ad-hoc task run.
///
/// Defaults to [`Self::Chat`] so existing rows that pre-date this
/// field stay routed to the chat surface, matching their historical
/// behavior. Persisted on the storage DTO as a snake-case string so
/// the field survives unknown values from older clients (deserialised
/// via `#[serde(default)]` everywhere it appears).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum AgentInstanceRole {
    #[default]
    Chat,
    Loop,
    Executor,
}

impl AgentInstanceRole {
    /// Stable wire string used in storage payloads and event JSON.
    pub fn as_wire_str(&self) -> &'static str {
        match self {
            Self::Chat => "chat",
            Self::Loop => "loop",
            Self::Executor => "executor",
        }
    }

    /// Parse the wire string emitted by [`Self::as_wire_str`].
    /// Unknown values map to [`Self::Chat`] so a forward-compat
    /// upstream that introduces a new variant doesn't poison reads.
    pub fn from_wire_str(s: &str) -> Self {
        match s {
            "loop" => Self::Loop,
            "executor" => Self::Executor,
            _ => Self::Chat,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SessionStatus {
    Active,
    Completed,
    Failed,
    RolledOver,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ChatRole {
    User,
    Assistant,
    System,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum OrgRole {
    Owner,
    Admin,
    Member,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum HarnessMode {
    #[default]
    Local,
    Swarm,
}

impl HarnessMode {
    pub fn from_machine_type(mt: &str) -> Self {
        match mt {
            "local" => Self::Local,
            _ => Self::Swarm,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum OrchestrationStatus {
    Planning,
    Executing,
    Completed,
    Failed,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum StepStatus {
    Pending,
    Running,
    Done,
    Failed,
    Skipped,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ArtifactType {
    Report,
    Document,
    Data,
    Media,
    Code,
    Custom,
}

// ---------------------------------------------------------------------------
// Process workflow enums
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ProcessNodeType {
    Ignition,
    Action,
    Condition,
    Artifact,
    Delay,
    Merge,
    Prompt,
    SubProcess,
    ForEach,
    Group,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ProcessRunStatus {
    Pending,
    Running,
    Completed,
    Failed,
    Cancelled,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ProcessRunTrigger {
    Scheduled,
    Manual,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ProcessEventStatus {
    Pending,
    Running,
    Completed,
    Failed,
    Skipped,
}
