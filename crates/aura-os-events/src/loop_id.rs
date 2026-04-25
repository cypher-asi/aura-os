//! Strongly-typed identifier for a single loop instance.
//!
//! A [`LoopId`] uniquely identifies one running loop in the system. Two
//! HTTP requests, two SSE streams, or two automation starts always have
//! distinct `LoopId`s, even when they share the same project, agent, or
//! agent instance.
//!
//! The full key shape is `(user, project?, agent_instance?, agent, kind, instance_uuid)`.
//! The `instance_uuid` makes every loop unique by construction; the rest
//! of the tuple makes routing keys cheap to derive.

use serde::{Deserialize, Serialize};
use uuid::Uuid;

use aura_os_core::{AgentId, AgentInstanceId, ProjectId, UserId};

/// Kind of loop, used both for telemetry and so subscribers can filter
/// by loop type (e.g. only show progress for automation loops).
#[derive(Clone, Copy, Debug, Hash, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum LoopKind {
    /// Interactive chat loop (user ↔ agent message stream).
    Chat,
    /// Continuous task automation loop (`POST .../loop/start`).
    Automation,
    /// One-off task run (`POST .../tasks/:id/run`).
    TaskRun,
    /// Spec generation stream (`POST .../specs/generate/stream`).
    SpecGen,
    /// Process / workflow run.
    ProcessRun,
}

/// Composite identifier for a single loop instance.
///
/// All fields except `instance` come from the request context; `instance`
/// is generated fresh per [`LoopId::new`] call so two loops can never
/// collide even when their other keys are identical.
#[derive(Clone, Debug, Hash, PartialEq, Eq, Serialize, Deserialize)]
pub struct LoopId {
    /// User who owns this loop.
    pub user_id: UserId,
    /// Project the loop is bound to, when applicable. Org-level chats
    /// (no project binding) leave this `None`.
    pub project_id: Option<ProjectId>,
    /// Project-agent instance the loop is bound to, when applicable.
    pub agent_instance_id: Option<AgentInstanceId>,
    /// Org-level agent driving the loop. Always present.
    pub agent_id: AgentId,
    /// What kind of loop this is.
    pub kind: LoopKind,
    /// Unique per-loop instance UUID. Generated fresh per loop.
    pub instance: Uuid,
}

impl LoopId {
    /// Construct a fresh loop id with a brand-new instance UUID.
    #[must_use]
    pub fn new(
        user_id: UserId,
        project_id: Option<ProjectId>,
        agent_instance_id: Option<AgentInstanceId>,
        agent_id: AgentId,
        kind: LoopKind,
    ) -> Self {
        Self {
            user_id,
            project_id,
            agent_instance_id,
            agent_id,
            kind,
            instance: Uuid::new_v4(),
        }
    }

    /// Stable string form for log lines and HTTP headers.
    ///
    /// Format: `kind:instance` (e.g. `automation:9d9f...`). The full
    /// tuple is available via `Debug` / serde when needed.
    #[must_use]
    pub fn short(&self) -> String {
        format!(
            "{kind:?}:{instance}",
            kind = self.kind,
            instance = self.instance
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fresh() -> LoopId {
        LoopId::new(
            UserId::new(),
            Some(ProjectId::new()),
            Some(AgentInstanceId::new()),
            AgentId::new(),
            LoopKind::Chat,
        )
    }

    #[test]
    fn distinct_loops_have_distinct_instance_uuids() {
        let a = fresh();
        let b = fresh();
        assert_ne!(a.instance, b.instance);
    }

    #[test]
    fn round_trips_through_serde() {
        let id = fresh();
        let json = serde_json::to_string(&id).unwrap();
        let back: LoopId = serde_json::from_str(&json).unwrap();
        assert_eq!(id, back);
    }

    #[test]
    fn short_form_includes_kind_and_instance() {
        let id = fresh();
        let s = id.short();
        assert!(s.starts_with("Chat:"));
        assert!(s.ends_with(&id.instance.to_string()));
    }
}
