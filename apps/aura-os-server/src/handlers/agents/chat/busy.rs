//! Shared chat-vs-automation conflict detection.
//!
//! The aura-harness enforces "one in-flight turn per agent_id".
//! After Phase 1, `agent_id` is partitioned per AgentInstance, so
//! two surfaces of one Aura template only collide if they happen
//! to land on the same partition. This module rejects new chat
//! turns whose partition already has a live, unpaused automaton
//! attached, so the UI can render "stop the loop to chat" instead
//! of the raw harness "turn in progress" wording.
//!
//! Phase 4 of the agent-stream reliability plan narrowed the
//! bare-agent variant: the legacy `instance_target = None` branch
//! used to scan the WHOLE registry and reject when ANY instance of
//! the template was busy, which incorrectly blocked a bare-agent
//! chat (partition `{template}::default`) whenever a sibling instance
//! (`{template}::{instance_id}`) was running an automaton — even
//! though the harness sees those as distinct partitions and would
//! never have collided. The guard now takes a [`BusyScope`] enum so
//! each route declares the exact slice of the registry it cares
//! about: `Instance` for the project-instance route, `TemplateInProject`
//! for the bare-agent route once it has a project context, and
//! `Unscoped` as the safe fallback for bare-agent chats with no
//! project pin (no rejection — the harness's `turn_in_progress`
//! catches the rare cross-partition collision and Phase 2's SSE
//! remap surfaces it as a clean `agent_busy`).

use std::collections::HashMap;

use aura_os_core::{AgentId, AgentInstanceId, ProjectId};
use tracing::warn;

use crate::error::{ApiError, ApiResult};
use crate::state::{ActiveAutomaton, AppState, AutomatonRegistryKey};

/// Caller-declared scope for a chat-vs-automation busy check. Each
/// chat route picks the variant that matches the partition its turn
/// will actually land on, so the guard only inspects automatons that
/// could plausibly collide.
///
/// * [`BusyScope::Instance`] — the project / instance chat route.
///   Reject only when the exact `(project_id, agent_instance_id)` slot
///   has a live, unpaused automaton attached. Mirrors the harness
///   partition `{template}::{instance_id}` 1:1.
/// * [`BusyScope::TemplateInProject`] — the bare-agent chat route
///   once it has resolved a project context (either via
///   `SendChatRequest.project_id` or via the Phase-3 Home-project
///   self-heal that runs inside `load_persistence_only`).
///   Reject only when some instance of `template` inside `project_id`
///   is busy — siblings in OTHER projects can keep automating without
///   blocking this chat.
/// * [`BusyScope::Unscoped`] — the bare-agent chat route when no
///   project context is available yet. Never rejects: the bare-agent
///   partition is `{template}::default`, which no automaton ever
///   binds to (automatons always run on a real `AgentInstanceId`),
///   so a software-side rejection here would be strictly wider than
///   the harness's actual collision surface. The previous "scan the
///   whole registry" fallback lived here; it produced false positives
///   for users with one tab automating in Project A and another tab
///   chatting bare-agent. The harness's own `turn_in_progress` is the
///   safety net for the rare collision the narrowed guard misses.
#[derive(Debug, Clone, Copy)]
pub enum BusyScope<'a> {
    /// Strict per-instance check used by the project / instance
    /// chat route.
    Instance {
        project_id: &'a ProjectId,
        agent_instance_id: &'a AgentInstanceId,
    },
    /// Project-scoped template scan used by the bare-agent chat
    /// route once it has a project context.
    TemplateInProject { project_id: &'a ProjectId },
    /// No scope — never rejects. Documents the bare-agent
    /// "I don't know which project I'll bind to yet" case.
    Unscoped,
}

/// Reject the current chat turn if any active automaton conflicts
/// with the caller-declared [`BusyScope`].
///
/// See the [`BusyScope`] doc for the per-variant semantics. Returns
/// `Ok(())` when nothing in the registry conflicts with the scope.
pub(super) async fn reject_if_partition_busy(
    state: &AppState,
    template: &AgentId,
    scope: BusyScope<'_>,
) -> ApiResult<()> {
    let reg = state.automaton_registry.lock().await;
    let Some(busy) = evaluate_partition_busy(&reg, template, scope) else {
        return Ok(());
    };
    drop(reg);
    let BusyMatch {
        project_id,
        agent_instance_id,
        automaton_id,
    } = busy;
    let scope_kind = match scope {
        BusyScope::Instance { .. } => "instance",
        BusyScope::TemplateInProject { .. } => "template_in_project",
        BusyScope::Unscoped => "unscoped",
    };
    warn!(
        %template,
        %project_id,
        %agent_instance_id,
        %automaton_id,
        scope = scope_kind,
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
pub struct BusyMatch {
    pub project_id: ProjectId,
    pub agent_instance_id: AgentInstanceId,
    pub automaton_id: String,
}

/// Synchronous guard predicate over a snapshot of the registry.
///
/// Returns `Some(BusyMatch)` for the first entry that conflicts
/// with the chat turn we're about to open, `None` when the scope
/// is clean. An entry "conflicts" when it is alive and not paused;
/// a paused entry is treated as free because the harness turn-lock
/// is released while the loop is paused and the next chat turn
/// will displace it cleanly on resume.
///
/// Phase 4 introduced [`BusyScope`] so the bare-agent and instance
/// routes can declare different slices of the registry to scan;
/// see the enum doc for the per-variant rules.
pub fn evaluate_partition_busy(
    registry: &HashMap<AutomatonRegistryKey, ActiveAutomaton>,
    template: &AgentId,
    scope: BusyScope<'_>,
) -> Option<BusyMatch> {
    match scope {
        BusyScope::Instance {
            project_id,
            agent_instance_id,
        } => {
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
        BusyScope::TemplateInProject { project_id } => registry
            .iter()
            .find(|((entry_project, _), entry)| {
                entry_project == project_id
                    && entry.template_agent_id == *template
                    && is_busy(entry)
            })
            .map(|((entry_project, entry_instance), entry)| BusyMatch {
                project_id: *entry_project,
                agent_instance_id: *entry_instance,
                automaton_id: entry.automaton_id.clone(),
            }),
        BusyScope::Unscoped => None,
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
    fn instance_scope_returns_busy_when_alive_and_not_paused() {
        let template = AgentId::new();
        let project_id = ProjectId::new();
        let aiid = AgentInstanceId::new();
        let mut reg = HashMap::new();
        reg.insert((project_id, aiid), entry(template, "auto-1", true, false));

        let busy = evaluate_partition_busy(
            &reg,
            &template,
            BusyScope::Instance {
                project_id: &project_id,
                agent_instance_id: &aiid,
            },
        )
        .expect("alive, unpaused entry should report busy");
        assert_eq!(busy.project_id, project_id);
        assert_eq!(busy.agent_instance_id, aiid);
        assert_eq!(busy.automaton_id, "auto-1");
    }

    #[test]
    fn instance_scope_returns_none_when_paused() {
        let template = AgentId::new();
        let project_id = ProjectId::new();
        let aiid = AgentInstanceId::new();
        let mut reg = HashMap::new();
        reg.insert((project_id, aiid), entry(template, "auto-1", true, true));

        assert!(evaluate_partition_busy(
            &reg,
            &template,
            BusyScope::Instance {
                project_id: &project_id,
                agent_instance_id: &aiid,
            }
        )
        .is_none());
    }

    #[test]
    fn instance_scope_returns_none_when_not_alive() {
        let template = AgentId::new();
        let project_id = ProjectId::new();
        let aiid = AgentInstanceId::new();
        let mut reg = HashMap::new();
        reg.insert((project_id, aiid), entry(template, "auto-1", false, false));

        assert!(evaluate_partition_busy(
            &reg,
            &template,
            BusyScope::Instance {
                project_id: &project_id,
                agent_instance_id: &aiid,
            }
        )
        .is_none());
    }

    #[test]
    fn instance_scope_returns_none_when_no_entry_exists() {
        let template = AgentId::new();
        let project_id = ProjectId::new();
        let aiid = AgentInstanceId::new();
        let reg = HashMap::new();

        assert!(evaluate_partition_busy(
            &reg,
            &template,
            BusyScope::Instance {
                project_id: &project_id,
                agent_instance_id: &aiid,
            }
        )
        .is_none());
    }

    /// Phase 4 narrowing: the project-scoped template scan must match
    /// only entries that share BOTH the requested template AND the
    /// requested project. A sibling instance of the same template in
    /// a DIFFERENT project must not register as busy — that's the
    /// false positive the legacy "scan everywhere" branch produced
    /// for users running an automation in Project A while opening a
    /// bare-agent chat scoped to Project B.
    #[test]
    fn template_in_project_scope_matches_same_project_only() {
        let template = AgentId::new();
        let project_a = ProjectId::new();
        let project_b = ProjectId::new();
        let aiid_a = AgentInstanceId::new();
        let aiid_b = AgentInstanceId::new();
        let mut reg = HashMap::new();
        // Same template, DIFFERENT project — must NOT match a chat
        // scoped to project_b.
        reg.insert(
            (project_a, aiid_a),
            entry(template, "auto-other-project", true, false),
        );
        reg.insert(
            (project_b, aiid_b),
            entry(template, "auto-target", true, false),
        );

        let busy = evaluate_partition_busy(
            &reg,
            &template,
            BusyScope::TemplateInProject {
                project_id: &project_b,
            },
        )
        .expect("template-in-project scan should find the in-project entry");
        assert_eq!(busy.project_id, project_b);
        assert_eq!(busy.agent_instance_id, aiid_b);
        assert_eq!(busy.automaton_id, "auto-target");
    }

    /// Phase 4 narrowing regression guard: an automaton on a
    /// DIFFERENT project must NOT block a chat scoped to its own
    /// project. The legacy unscoped branch returned this entry as
    /// busy; the new TemplateInProject branch must skip it.
    #[test]
    fn template_in_project_scope_skips_other_project_with_same_template() {
        let template = AgentId::new();
        let project_a = ProjectId::new();
        let project_b = ProjectId::new();
        let aiid_a = AgentInstanceId::new();
        let mut reg = HashMap::new();
        reg.insert(
            (project_a, aiid_a),
            entry(template, "auto-elsewhere", true, false),
        );

        // Scope says "are you busy in project_b?" — the only entry
        // lives in project_a, so the answer must be no.
        assert!(evaluate_partition_busy(
            &reg,
            &template,
            BusyScope::TemplateInProject {
                project_id: &project_b,
            }
        )
        .is_none());
    }

    #[test]
    fn template_in_project_scope_skips_paused_and_dead_entries() {
        let template = AgentId::new();
        let project_id = ProjectId::new();
        let aiid_paused = AgentInstanceId::new();
        let aiid_dead = AgentInstanceId::new();
        let mut reg = HashMap::new();
        reg.insert(
            (project_id, aiid_paused),
            entry(template, "auto-paused", true, true),
        );
        reg.insert(
            (project_id, aiid_dead),
            entry(template, "auto-dead", false, false),
        );

        assert!(evaluate_partition_busy(
            &reg,
            &template,
            BusyScope::TemplateInProject {
                project_id: &project_id,
            }
        )
        .is_none());
    }

    #[test]
    fn template_in_project_scope_returns_none_when_template_does_not_match() {
        let template = AgentId::new();
        let other_template = AgentId::new();
        let project_id = ProjectId::new();
        let aiid = AgentInstanceId::new();
        let mut reg = HashMap::new();
        reg.insert(
            (project_id, aiid),
            entry(other_template, "auto-other", true, false),
        );

        assert!(evaluate_partition_busy(
            &reg,
            &template,
            BusyScope::TemplateInProject {
                project_id: &project_id,
            }
        )
        .is_none());
    }

    /// Phase 4 fallback: the unscoped branch must NEVER reject. This
    /// pins the documented narrowing — when the bare-agent route can't
    /// declare a project context, the guard is a no-op and the harness
    /// is the safety net.
    #[test]
    fn unscoped_returns_none_even_when_template_is_busy_elsewhere() {
        let template = AgentId::new();
        let project_id = ProjectId::new();
        let aiid = AgentInstanceId::new();
        let mut reg = HashMap::new();
        reg.insert(
            (project_id, aiid),
            entry(template, "auto-busy-anywhere", true, false),
        );

        assert!(evaluate_partition_busy(&reg, &template, BusyScope::Unscoped).is_none());
    }
}
