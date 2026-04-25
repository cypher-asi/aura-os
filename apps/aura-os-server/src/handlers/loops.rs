//! `GET /api/loops` snapshot endpoint and supporting types.
//!
//! Surfaces the current contents of [`AppState::loop_registry`](crate::state::AppState::loop_registry)
//! as JSON so the frontend can re-hydrate the unified circular progress
//! indicator on page load and after a WebSocket reconnect. The same
//! shape is also pushed live via [`aura_os_events::DomainEvent::LoopActivityChanged`]
//! events, so the snapshot endpoint and the streaming events agree on
//! what a loop looks like.

use axum::extract::{Query, State};
use axum::Json;
use serde::{Deserialize, Serialize};

use aura_os_core::{AgentInstanceId, ProjectId, TaskId};
use aura_os_events::{LoopActivity, LoopId, LoopKind};
use aura_os_loops::LoopSnapshot;

use crate::error::ApiResult;
use crate::state::AppState;

/// Optional filter for `GET /api/loops`. Any combination is allowed; an
/// empty filter returns every loop the caller can observe.
#[derive(Debug, Default, Deserialize)]
pub(crate) struct LoopsFilter {
    /// Limit results to loops bound to this project.
    pub project_id: Option<ProjectId>,
    /// Limit results to loops driven by this agent instance.
    pub agent_instance_id: Option<AgentInstanceId>,
    /// Limit results to loops working on this task.
    pub task_id: Option<TaskId>,
    /// Limit results to loops of this kind (`chat` / `automation` / …).
    pub kind: Option<LoopKind>,
}

/// JSON envelope for one loop in the snapshot response.
#[derive(Debug, Serialize)]
pub(crate) struct LoopSnapshotDto {
    pub loop_id: LoopId,
    pub activity: LoopActivity,
}

impl From<LoopSnapshot> for LoopSnapshotDto {
    fn from(value: LoopSnapshot) -> Self {
        Self {
            loop_id: value.loop_id,
            activity: value.activity,
        }
    }
}

/// Top-level response shape for `GET /api/loops`.
#[derive(Debug, Serialize)]
pub(crate) struct LoopsSnapshotResponse {
    pub loops: Vec<LoopSnapshotDto>,
}

/// `GET /api/loops` - return all loops matching the optional filter.
pub(crate) async fn list_loops(
    State(state): State<AppState>,
    Query(filter): Query<LoopsFilter>,
) -> ApiResult<Json<LoopsSnapshotResponse>> {
    // Pre-resolve the filter values locally so the predicate closure
    // can match against `Option<&T>` without re-entering the DashMap
    // per call. We compute `current_task_id` inline from a second
    // snapshot pass when a task filter is set, which is O(1) against
    // the DashMap.
    let project_filter = filter.project_id;
    let instance_filter = filter.agent_instance_id;
    let kind_filter = filter.kind;
    let task_filter = filter.task_id;
    let snapshots = state.loop_registry.snapshot_where(|loop_id| {
        let project_ok = project_filter.is_none() || loop_id.project_id == project_filter;
        let instance_ok = instance_filter.is_none() || loop_id.agent_instance_id == instance_filter;
        let kind_ok = match kind_filter {
            None => true,
            Some(k) => loop_id.kind == k,
        };
        let task_ok = match task_filter {
            None => true,
            Some(expected) => {
                state
                    .loop_registry
                    .snapshot_one(loop_id)
                    .and_then(|s| s.activity.current_task_id)
                    == Some(expected)
            }
        };
        project_ok && instance_ok && kind_ok && task_ok
    });
    let loops: Vec<LoopSnapshotDto> = snapshots.into_iter().map(LoopSnapshotDto::from).collect();
    Ok(Json(LoopsSnapshotResponse { loops }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use aura_os_core::{AgentId, UserId};
    use aura_os_events::EventHub;
    use aura_os_loops::LoopRegistry;

    fn fresh_loop(project: ProjectId, instance: AgentInstanceId, kind: LoopKind) -> LoopId {
        LoopId::new(
            UserId::new(),
            Some(project),
            Some(instance),
            AgentId::new(),
            kind,
        )
    }

    #[tokio::test]
    async fn snapshot_filters_by_project_and_kind() {
        let hub = EventHub::new();
        let registry = LoopRegistry::new(hub);
        let p1 = ProjectId::new();
        let p2 = ProjectId::new();
        let _l1 = registry.open(fresh_loop(p1, AgentInstanceId::new(), LoopKind::Chat));
        let _l2 = registry.open(fresh_loop(p1, AgentInstanceId::new(), LoopKind::Automation));
        let _l3 = registry.open(fresh_loop(p2, AgentInstanceId::new(), LoopKind::Chat));

        let only_p1_chat = registry.snapshot_where(|loop_id| {
            loop_id.project_id == Some(p1) && loop_id.kind == LoopKind::Chat
        });
        assert_eq!(only_p1_chat.len(), 1);
        assert_eq!(only_p1_chat[0].loop_id.kind, LoopKind::Chat);
    }
}
