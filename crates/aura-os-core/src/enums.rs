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
/// Each role gets its own upstream harness partition via
/// [`crate::harness_agent_id`] (`{template}::{instance}`, or
/// `{template}::default` when no instance is targeted), so the
/// harness's "one in-flight turn per `agent_id`" rule no longer
/// serializes chat against automation against task runs the way it
/// did before the per-instance partitioning landed. Concretely:
///
/// * `Chat` — backs an interactive chat surface. Each project's
///   default chat instance opens a long-lived session under the
///   `{template}::{chat_instance_id}` partition; per-partition turn
///   slots in `aura-os-server::handlers::agents::chat` queue the
///   second send and reject the third with `agent_busy` while the
///   first is still in flight.
/// * `Loop` — backs the dev automation loop. Runs concurrently with
///   the chat instance under its own `{template}::{loop_instance_id}`
///   partition, so the same agent template can be chatting and
///   automating at the same time without colliding on the harness.
///   The chat-vs-automation guard
///   (`chat::busy::reject_if_partition_busy`) only refuses chat
///   sends that target the *same* `(project_id,
///   agent_instance_id)` pair already attached to an active
///   automaton — chat on a sibling instance is allowed.
/// * `Executor` — backs ephemeral one-shot task runs. Each ad-hoc
///   task run is launched on its own `Executor` instance so multiple
///   tasks can execute in parallel under distinct partitions instead
///   of fighting over the project-wide `Loop` slot.
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

/// Provenance tag for an `AgentInstance` row. Persisted as a free
/// string on `project_agent.source` (via [`Self::as_wire_str`]) so
/// adding a new origin does not require a storage migration. Drives
/// the projects sidebar filter (`isUserFacingAgentInstance`): only
/// rows with no source (legacy data) or `Ui` surface in the project
/// tree on the frontend.
///
/// The four currently meaningful origins:
///
/// * `Ui` — user clicked the "+" button in the desktop / web sidebar
///   (default for `POST /api/projects/:pid/agents` when no source is
///   sent on the request body). Visible in the projects sidebar.
/// * `AutoHome` — `ensure_agent_home_project_and_binding` lazily
///   created the row inside the per-org `"Home"` project so chat
///   persistence has somewhere to land. Hidden.
/// * `AutoProjectDefault` — `AppShell.handleProjectCreated` auto-
///   attached the Standard Agent template to a newly-created project.
///   Hidden.
/// * `Sdk` — SDK / benchmark / e2e fixture script created the row via
///   the storage REST API. Hidden so dev runs and load tests don't
///   pollute the user's sidebar between cleanup cycles.
/// * `System` — server-internal infrastructure binding such as the
///   per-project `Loop` instance or an ephemeral `Executor` minted for
///   a `POST /tasks/:id/run` call. Stamping a non-null `source` on
///   these rows defends against the case where storage strips the
///   `instance_role` column on `list_project_agents` responses (which
///   would otherwise let them slip through the sidebar filter as
///   role-defaulted Chat rows and stack up as duplicate "Summarize
///   This Me"-style entries on every run).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AgentInstanceSource {
    Ui,
    AutoHome,
    AutoProjectDefault,
    Sdk,
    System,
}

impl AgentInstanceSource {
    /// Stable wire string used in storage payloads and event JSON.
    /// Mirrors the string constants the frontend's
    /// `isUserFacingAgentInstance` filter knows about.
    pub fn as_wire_str(&self) -> &'static str {
        match self {
            Self::Ui => "ui",
            Self::AutoHome => "auto_home",
            Self::AutoProjectDefault => "auto_project_default",
            Self::Sdk => "sdk",
            Self::System => "system",
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
    Deleted,
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
