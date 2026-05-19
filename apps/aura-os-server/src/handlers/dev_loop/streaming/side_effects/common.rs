//! Shared helpers used by every side-effects submodule (event enrichment, registry-bound task pointer updates, cache key parsing, generic field readers).

use std::str::FromStr;

use aura_os_core::{AgentInstanceId, ProjectId, SessionId, TaskId};

use crate::state::AppState;

/// Stamp `project_id`, `agent_instance_id`, `task_id`, and `session_id`
/// onto an event object so downstream subscribers can route without
/// reading them out of the payload tree.
pub(super) fn enrich_event(
    event: serde_json::Value,
    project_id: ProjectId,
    agent_instance_id: AgentInstanceId,
    task_id: Option<&str>,
    session_id: Option<SessionId>,
) -> serde_json::Value {
    let mut enriched = event;
    if let Some(object) = enriched.as_object_mut() {
        object
            .entry("project_id".to_string())
            .or_insert_with(|| project_id.to_string().into());
        object
            .entry("agent_instance_id".to_string())
            .or_insert_with(|| agent_instance_id.to_string().into());
        if let Some(task_id) = task_id {
            object
                .entry("task_id".to_string())
                .or_insert_with(|| task_id.to_string().into());
        }
        if let Some(session_id) = session_id {
            object
                .entry("session_id".to_string())
                .or_insert_with(|| session_id.to_string().into());
        }
    }
    enriched
}

pub(super) async fn set_current_task(
    state: &AppState,
    project_id: ProjectId,
    agent_instance_id: AgentInstanceId,
    task_id: Option<String>,
) {
    if let Some(entry) = state
        .automaton_registry
        .lock()
        .await
        .get_mut(&(project_id, agent_instance_id))
    {
        entry.current_task_id = task_id;
    }
}

/// Parse a free-form task id string into a typed cache key. Returns
/// `None` for non-UUID task ids; the caller silently drops the entry
/// in that case (legacy harness payloads occasionally carry synthetic
/// `"runner-<n>"` ids that should not pollute the cache).
pub(super) fn parse_task_key(project_id: ProjectId, task_id: &str) -> Option<(ProjectId, TaskId)> {
    TaskId::from_str(task_id).ok().map(|tid| (project_id, tid))
}

/// First populated string among the well-known harness reason aliases
/// (`reason`, `message`, `error`, `result`, `result_preview`).
pub(super) fn event_reason(event: &serde_json::Value) -> Option<String> {
    ["reason", "message", "error", "result", "result_preview"]
        .into_iter()
        .find_map(|key| {
            event
                .get(key)
                .and_then(|value| value.as_str())
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(str::to_string)
        })
}

pub(super) fn event_text(event: &serde_json::Value) -> Option<&str> {
    event
        .get("text")
        .or_else(|| event.get("delta"))
        .and_then(|value| value.as_str())
}
