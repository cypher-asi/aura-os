//! Shared chat-vs-automation conflict detection.
//!
//! The aura-harness enforces "one in-flight turn per agent_id".
//! After Phase 1, `agent_id` is partitioned per AgentInstance, so
//! two surfaces of one Aura template only collide if they happen
//! to land on the same partition. This module rejects new chat
//! turns whose partition already has a live, unpaused automaton
//! attached, so the UI can render "stop the loop to chat" instead
//! of the raw harness "turn in progress" wording.

use std::collections::HashMap;

use aura_os_core::{AgentId, AgentInstanceId, ProjectId};
use tracing::warn;

use crate::error::{ApiError, ApiResult};
use crate::state::{ActiveAutomaton, AppState, AutomatonRegistryKey};

/// Reject the current chat turn if any active automaton is bound to
/// the partition we are about to open.
///
/// `instance_target = Some((project_id, instance_id))` checks the
/// strict `(project_id, instance_id)` registry slot — the original
/// instance-route guard. `None` checks all automaton entries whose
/// `template_agent_id` matches `template`, used by the legacy
/// `/v1/agents/:agent_id/chat/stream` route which has no project /
/// instance scope of its own. Returns `Ok(())` when the partition is
/// free.
pub(super) async fn reject_if_partition_busy(
    state: &AppState,
    template: &AgentId,
    instance_target: Option<(&ProjectId, &AgentInstanceId)>,
) -> ApiResult<()> {
    let reg = state.automaton_registry.lock().await;
    let Some(busy) = evaluate_partition_busy(&reg, template, instance_target) else {
        return Ok(());
    };
    drop(reg);
    let BusyMatch {
        project_id,
        agent_instance_id,
        automaton_id,
    } = busy;
    warn!(
        %template,
        %project_id,
        %agent_instance_id,
        %automaton_id,
        instance_scoped = instance_target.is_some(),
        "Rejecting chat turn: agent partition is running an automation loop",
    );
    Err(ApiError::agent_busy(
        "Agent is currently running an automation task. Stop the loop to chat.",
        Some(automaton_id),
    ))
}

/// Result of an in-memory scan of the automaton registry — pulled
/// out so the synchronous matching logic can be unit-tested without
/// having to construct a full [`AppState`].
#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct BusyMatch {
    pub project_id: ProjectId,
    pub agent_instance_id: AgentInstanceId,
    pub automaton_id: String,
}

/// Synchronous guard predicate over a snapshot of the registry.
///
/// Returns `Some(BusyMatch)` for the first entry that conflicts
/// with the chat turn we're about to open, `None` when the
/// partition is free. An entry "conflicts" when it is alive and
/// not paused; a paused entry is treated as free because the
/// harness turn-lock is released while the loop is paused and the
/// next chat turn will displace it cleanly on resume.
pub(super) fn evaluate_partition_busy(
    registry: &HashMap<AutomatonRegistryKey, ActiveAutomaton>,
    template: &AgentId,
    instance_target: Option<(&ProjectId, &AgentInstanceId)>,
) -> Option<BusyMatch> {
    match instance_target {
        Some((project_id, agent_instance_id)) => {
            let entry = registry.get(&(*project_id, *agent_instance_id))?;
            if !is_busy(entry) {
                return None;
            }
            Some(BusyMatch {
                project_id: *project_id,
                agent_instance_id: *agent_instance_id,
                automaton_id: entry.automaton_id.clone(),
            })
        }
        None => registry
            .iter()
            .find(|(_, entry)| entry.template_agent_id == *template && is_busy(entry))
            .map(|((project_id, agent_instance_id), entry)| BusyMatch {
                project_id: *project_id,
                agent_instance_id: *agent_instance_id,
                automaton_id: entry.automaton_id.clone(),
            }),
    }
}

fn is_busy(entry: &ActiveAutomaton) -> bool {
    let alive = entry.alive.load(std::sync::atomic::Ordering::Acquire);
    alive && !entry.paused
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::AtomicBool;
    use std::sync::Arc;

    use super::*;

    fn entry(template: AgentId, automaton_id: &str, alive: bool, paused: bool) -> ActiveAutomaton {
        ActiveAutomaton {
            automaton_id: automaton_id.to_string(),
            project_id: ProjectId::new(),
            template_agent_id: template,
            harness_base_url: "http://127.0.0.1:1".to_string(),
            paused,
            alive: Arc::new(AtomicBool::new(alive)),
            forwarder: None,
            current_task_id: None,
            session_id: None,
        }
    }

    #[test]
    fn instance_target_returns_busy_when_alive_and_not_paused() {
        let template = AgentId::new();
        let project_id = ProjectId::new();
        let aiid = AgentInstanceId::new();
        let mut reg = HashMap::new();
        reg.insert((project_id, aiid), entry(template, "auto-1", true, false));

        let busy = evaluate_partition_busy(&reg, &template, Some((&project_id, &aiid)))
            .expect("alive, unpaused entry should report busy");
        assert_eq!(busy.project_id, project_id);
        assert_eq!(busy.agent_instance_id, aiid);
        assert_eq!(busy.automaton_id, "auto-1");
    }

    #[test]
    fn instance_target_returns_none_when_paused() {
        let template = AgentId::new();
        let project_id = ProjectId::new();
        let aiid = AgentInstanceId::new();
        let mut reg = HashMap::new();
        reg.insert((project_id, aiid), entry(template, "auto-1", true, true));

        assert!(evaluate_partition_busy(&reg, &template, Some((&project_id, &aiid))).is_none());
    }

    #[test]
    fn instance_target_returns_none_when_not_alive() {
        let template = AgentId::new();
        let project_id = ProjectId::new();
        let aiid = AgentInstanceId::new();
        let mut reg = HashMap::new();
        reg.insert((project_id, aiid), entry(template, "auto-1", false, false));

        assert!(evaluate_partition_busy(&reg, &template, Some((&project_id, &aiid))).is_none());
    }

    #[test]
    fn instance_target_returns_none_when_no_entry_exists() {
        let template = AgentId::new();
        let project_id = ProjectId::new();
        let aiid = AgentInstanceId::new();
        let reg = HashMap::new();

        assert!(evaluate_partition_busy(&reg, &template, Some((&project_id, &aiid))).is_none());
    }

    #[test]
    fn template_scan_matches_any_instance_of_same_template() {
        let template = AgentId::new();
        let other_template = AgentId::new();
        let project_a = ProjectId::new();
        let project_b = ProjectId::new();
        let aiid_a = AgentInstanceId::new();
        let aiid_b = AgentInstanceId::new();
        let mut reg = HashMap::new();
        reg.insert(
            (project_a, aiid_a),
            entry(other_template, "auto-other", true, false),
        );
        reg.insert(
            (project_b, aiid_b),
            entry(template, "auto-target", true, false),
        );

        let busy = evaluate_partition_busy(&reg, &template, None)
            .expect("template scan should find the matching entry");
        assert_eq!(busy.project_id, project_b);
        assert_eq!(busy.agent_instance_id, aiid_b);
        assert_eq!(busy.automaton_id, "auto-target");
    }

    #[test]
    fn template_scan_skips_paused_and_dead_entries() {
        let template = AgentId::new();
        let project_a = ProjectId::new();
        let project_b = ProjectId::new();
        let aiid_a = AgentInstanceId::new();
        let aiid_b = AgentInstanceId::new();
        let mut reg = HashMap::new();
        reg.insert(
            (project_a, aiid_a),
            entry(template, "auto-paused", true, true),
        );
        reg.insert((project_b, aiid_b), entry(template, "auto-dead", false, false));

        assert!(evaluate_partition_busy(&reg, &template, None).is_none());
    }

    #[test]
    fn template_scan_returns_none_when_no_entry_matches_template() {
        let template = AgentId::new();
        let other_template = AgentId::new();
        let project_id = ProjectId::new();
        let aiid = AgentInstanceId::new();
        let mut reg = HashMap::new();
        reg.insert(
            (project_id, aiid),
            entry(other_template, "auto-other", true, false),
        );

        assert!(evaluate_partition_busy(&reg, &template, None).is_none());
    }
}
