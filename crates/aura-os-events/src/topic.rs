//! Topic taxonomy used to route [`crate::DomainEvent`]s.
//!
//! A producer publishes an event; the [`crate::EventHub`] derives the
//! event's [`Topic`]s via [`crate::DomainEvent::topics`] and fans the
//! event out to every subscriber whose [`crate::SubscriptionFilter`]
//! matches one or more of those topics.
//!
//! Topics are deliberately narrow. A subscriber that wants "everything
//! for project P" subscribes to [`Topic::Project`] and gets project-
//! scoped events plus every loop / agent-instance / task event whose
//! routing keys roll up under that project — the hub computes the
//! topic union per event, not per subscription.

use serde::{Deserialize, Serialize};

use aura_os_core::{AgentId, AgentInstanceId, ProjectId, SessionId, TaskId};

use crate::loop_id::LoopId;

/// One topic key. Subscribers express interest in a set of topics via
/// [`crate::SubscriptionFilter`]; producers stamp every event with the
/// topics it should reach via [`crate::DomainEvent::topics`].
#[derive(Clone, Debug, Hash, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum Topic {
    /// Scoped to a single project. Receives loop activity / chat /
    /// task events whose routing keys belong to this project.
    Project(ProjectId),
    /// Scoped to a single project-agent binding (instance).
    AgentInstance(AgentInstanceId),
    /// Scoped to an org-level agent. Useful for cross-project
    /// activity rollups for one agent.
    AgentId(AgentId),
    /// Scoped to a single chat / task run / automation session.
    Session(SessionId),
    /// Scoped to a single task. Receives task-saved events plus
    /// per-task loop activity.
    Task(TaskId),
    /// Scoped to one specific loop instance.
    Loop(LoopId),
}

impl Topic {
    /// Stable discriminant for use in hash maps when the variant
    /// payloads are not relevant (e.g. cardinality counters).
    #[must_use]
    pub fn kind(&self) -> &'static str {
        match self {
            Topic::Project(_) => "project",
            Topic::AgentInstance(_) => "agent_instance",
            Topic::AgentId(_) => "agent_id",
            Topic::Session(_) => "session",
            Topic::Task(_) => "task",
            Topic::Loop(_) => "loop",
        }
    }
}
