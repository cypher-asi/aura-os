use std::sync::atomic::Ordering;

use aura_os_core::{AgentInstanceId, ProjectId};
use aura_os_events::LoopKind;

use crate::dto::{ActiveLoopTask, LoopStatusResponse};
use crate::state::AppState;

use super::limits::FORWARDER_FRESHNESS_THRESHOLD;
use super::streaming::current_millis;

pub(super) async fn set_paused(
    state: &AppState,
    project_id: ProjectId,
    agent_instance_id: AgentInstanceId,
    paused: bool,
) {
    if let Some(entry) = state
        .automaton_registry
        .lock()
        .await
        .get_mut(&(project_id, agent_instance_id))
    {
        entry.paused = paused;
    }
}

pub(super) async fn can_reuse_forwarder(
    state: &AppState,
    project_id: ProjectId,
    agent_instance_id: AgentInstanceId,
    automaton_id: &str,
) -> bool {
    let snapshot = {
        let reg = state.automaton_registry.lock().await;
        reg.get(&(project_id, agent_instance_id))
            .map(|entry| ForwarderHealthSnapshot {
                automaton_id_matches: entry.automaton_id == automaton_id,
                alive: entry.alive.load(Ordering::SeqCst),
                paused: entry.paused,
                last_event_at_ms: entry.last_forwarder_event_at.load(Ordering::Relaxed),
            })
    };
    let Some(snapshot) = snapshot else {
        return false;
    };
    let decision = evaluate_forwarder_reuse(&snapshot, current_millis());
    if let ReuseDecision::Wedged { gap_ms } = decision {
        tracing::warn!(
            %project_id,
            %agent_instance_id,
            automaton_id,
            gap_ms,
            threshold_ms = FORWARDER_FRESHNESS_THRESHOLD.as_millis() as i64,
            "refusing adopt-shortcut: forwarder appears wedged \
             (no harness events received within freshness window); \
             forcing full restart"
        );
    }
    matches!(decision, ReuseDecision::Reuse)
}

struct ForwarderHealthSnapshot {
    automaton_id_matches: bool,
    alive: bool,
    paused: bool,
    last_event_at_ms: i64,
}

#[derive(Debug, PartialEq, Eq)]
enum ReuseDecision {
    /// All gates passed: adopt-shortcut may reuse the existing
    /// forwarder + ws-reader pair.
    Reuse,
    /// Hard mismatch (wrong automaton_id, registry says
    /// `alive == false`, etc.). Reuse never made sense here.
    Refuse,
    /// `alive == true` and `automaton_id` matches, but the forwarder
    /// has gone silent past the freshness window — almost certainly
    /// wedged (ws-reader dead but registry entry still says alive).
    /// Carries the observed gap for logging.
    Wedged { gap_ms: i64 },
}

/// Pure decision function for the adopt-shortcut gate. Extracted from
/// [`can_reuse_forwarder`] so the freshness logic can be unit-tested
/// without standing up a full [`AppState`].
fn evaluate_forwarder_reuse(snapshot: &ForwarderHealthSnapshot, now_ms: i64) -> ReuseDecision {
    if !snapshot.automaton_id_matches || !snapshot.alive {
        return ReuseDecision::Refuse;
    }
    // Paused loops legitimately have no harness traffic; skip the
    // freshness gate for them. A user resuming a paused loop should
    // not pay the cost of a forwarder rebuild just because Pause put
    // the harness to sleep.
    if snapshot.paused {
        return ReuseDecision::Reuse;
    }
    let gap_ms = now_ms.saturating_sub(snapshot.last_event_at_ms);
    if gap_ms < FORWARDER_FRESHNESS_THRESHOLD.as_millis() as i64 {
        ReuseDecision::Reuse
    } else {
        ReuseDecision::Wedged { gap_ms }
    }
}

pub(super) async fn replace_registry_entry(
    state: &AppState,
    project_id: ProjectId,
    agent_instance_id: AgentInstanceId,
) {
    abort_and_remove(state, project_id, agent_instance_id).await;
}

pub(super) async fn abort_and_remove(
    state: &AppState,
    project_id: ProjectId,
    agent_instance_id: AgentInstanceId,
) {
    // Explicit stop / displacement invalidates the persisted run
    // handle regardless of whether a live registry entry exists --
    // otherwise a restarted server would keep "rediscovering" a loop
    // the user already stopped.
    super::run_handles::remove(state, project_id, agent_instance_id);
    let Some(entry) = state
        .automaton_registry
        .lock()
        .await
        .remove(&(project_id, agent_instance_id))
    else {
        return;
    };
    // Publish `LoopEnded` synchronously BEFORE aborting the forwarder
    // task. Without this the only path to `LoopEnded` was the
    // `Drop` impl on the forwarder's `Arc<LoopHandle>` clone, which
    // fires asynchronously after the task fully unwinds and the
    // event-worker mpsc drains. In a rapid Stop+Start cycle the new
    // `LoopOpened` would race ahead of the late `LoopEnded`, leaving
    // the client with a stale activity row for the previous loop
    // instance. Marking cancelled here flushes the terminal event
    // through the hub on the calling task's clock.
    if let Some(handle) = entry.loop_handle {
        handle.mark_cancelled().await;
    }
    // Release the harness ws-slot immediately rather than waiting for
    // the forwarder task to drop the last `WsReaderHandle` clone on
    // its way out. The harness enforces a per-process WS-slot
    // semaphore (`AURA_HARNESS_WS_SLOTS`) and back-to-back
    // Stop+Start cycles can pin the slot if we let the reader linger.
    if let Some(reader) = entry.ws_reader_handle {
        reader.cancel();
    }
    if let Some(handle) = entry.forwarder {
        handle.abort();
    }
}

pub(super) async fn status_response(
    state: &AppState,
    project_id: ProjectId,
    agent_instance_id: Option<AgentInstanceId>,
) -> LoopStatusResponse {
    let (active, paused, loop_engineering) =
        snapshot_active_paused_and_mode(state, project_id, agent_instance_id).await;
    // `current_task_id` lives on `LoopActivity` (Phase 5: LoopHandle is
    // the single authoritative source). Walk the loop registry for
    // every Automation / TaskRun loop bound to this project and pull
    // the typed `TaskId` straight off the activity payload.
    let active_tasks = collect_active_loop_tasks(state, project_id);
    let running = !active.is_empty();
    LoopStatusResponse {
        running,
        paused,
        loop_state: Some(status_loop_state(running, paused).to_string()),
        project_id: Some(project_id),
        agent_instance_id,
        active_agent_instances: Some(active),
        loop_engineering,
        cooldown_remaining_ms: None,
        cooldown_reason: None,
        cooldown_kind: None,
        active_tasks: Some(active_tasks),
    }
}

/// Collect every active agent-instance id for the project together
/// with whether ANY automaton in the project is currently paused.
/// Carved out of [`status_response`] so its body stays inside the
/// 50-line per-function budget. Lock acquisition is identical.
async fn snapshot_active_paused_and_mode(
    state: &AppState,
    project_id: ProjectId,
    agent_instance_id: Option<AgentInstanceId>,
) -> (Vec<AgentInstanceId>, bool, Option<serde_json::Value>) {
    let reg = state.automaton_registry.lock().await;
    let active: Vec<AgentInstanceId> = reg
        .iter()
        .filter(|((pid, _), _)| *pid == project_id)
        .map(|((_, agent_id), _)| *agent_id)
        .collect();
    let paused = reg
        .iter()
        .any(|((pid, _), entry)| *pid == project_id && entry.paused);
    let loop_engineering = reg
        .iter()
        .filter(|((pid, _), _)| *pid == project_id)
        .filter(|((_, agent_id), _)| agent_instance_id.map_or(true, |wanted| *agent_id == wanted))
        .find_map(|(_, entry)| entry.loop_engineering.clone());
    (active, paused, loop_engineering)
}

/// Walk the loop registry for every `Automation`/`TaskRun` loop in
/// the project and pull the typed `TaskId` off the activity payload.
/// Carved out of [`status_response`] so its body stays inside the
/// 50-line per-function budget.
fn collect_active_loop_tasks(state: &AppState, project_id: ProjectId) -> Vec<ActiveLoopTask> {
    let project_loops = state.loop_registry.snapshot_where(|loop_id| {
        loop_id.project_id == Some(project_id)
            && matches!(loop_id.kind, LoopKind::Automation | LoopKind::TaskRun)
    });
    // Diagnostic: when the play button + cooking strip are lit but the
    // Run pane stays empty, the most common backend root cause is a
    // registered Automation loop whose `current_task_id` is still
    // `None` because the harness hasn't emitted `task_started` yet
    // (typical during long planning / backlog-filling phases where
    // the LLM is calling `submit_plan` / `get_task_context` /
    // `read_file` without claiming a backlog task). Emitting this
    // trace whenever `/loop/status` reports an empty `active_tasks`
    // for a project that *does* have an open Automation loop gives
    // operators a single grep target to confirm the hypothesis.
    #[cfg(debug_assertions)]
    for snapshot in &project_loops {
        if snapshot.activity.current_task_id.is_none() {
            tracing::debug!(
                %project_id,
                loop_kind = ?snapshot.loop_id.kind,
                loop_status = ?snapshot.activity.status,
                current_step = ?snapshot.activity.current_step,
                "active_tasks: loop registered but current_task_id is None \
                 (harness has not emitted task_started — likely planning phase)"
            );
        }
    }
    project_loops
        .into_iter()
        .filter_map(|snapshot| {
            let agent_id = snapshot.loop_id.agent_instance_id?;
            let task_id = snapshot.activity.current_task_id?;
            Some(ActiveLoopTask {
                task_id: task_id.to_string(),
                agent_instance_id: agent_id,
            })
        })
        .collect()
}

/// Translate (running, paused) into the wire `loop_state` label.
fn status_loop_state(running: bool, paused: bool) -> &'static str {
    if paused {
        "paused"
    } else if running {
        "running"
    } else {
        "finished"
    }
}

#[cfg(test)]
mod tests {
    //! Unit tests for the adopt-shortcut freshness gate. The wedge
    //! the user reported (AutomationBar ring spinning forever after
    //! rapid Stop+Start cycles, no task progress, needs harness + app
    //! restart) was caused by [`can_reuse_forwarder`] returning
    //! `true` whenever `alive == true` regardless of whether the
    //! forwarder had received any actual harness traffic. These
    //! tests pin the new gating behaviour (extracted into
    //! [`evaluate_forwarder_reuse`] so it can be exercised without
    //! standing up a full [`AppState`]) so a future refactor cannot
    //! quietly regress back to the alive-only check.

    use super::{
        evaluate_forwarder_reuse, ForwarderHealthSnapshot, ReuseDecision,
        FORWARDER_FRESHNESS_THRESHOLD,
    };

    fn snapshot(
        alive: bool,
        paused: bool,
        automaton_id_matches: bool,
        last_event_at_ms: i64,
    ) -> ForwarderHealthSnapshot {
        ForwarderHealthSnapshot {
            automaton_id_matches,
            alive,
            paused,
            last_event_at_ms,
        }
    }

    const NOW_MS: i64 = 10_000_000;

    #[test]
    fn fresh_active_forwarder_can_be_reused() {
        let snap = snapshot(true, false, true, NOW_MS);
        assert_eq!(
            evaluate_forwarder_reuse(&snap, NOW_MS),
            ReuseDecision::Reuse
        );
    }

    #[test]
    fn stale_active_forwarder_is_refused_as_wedged() {
        // One ms past the threshold: must trip the wedge gate, NOT
        // be allowed through. This is the regression the user hit —
        // a registry entry still flagged `alive` but whose ws-reader
        // had died, so no harness events were arriving.
        let gap = FORWARDER_FRESHNESS_THRESHOLD.as_millis() as i64 + 1;
        let snap = snapshot(true, false, true, NOW_MS - gap);
        assert_eq!(
            evaluate_forwarder_reuse(&snap, NOW_MS),
            ReuseDecision::Wedged { gap_ms: gap }
        );
    }

    #[test]
    fn freshness_window_is_inclusive_at_the_edge() {
        // One ms inside the threshold: still allowed. The gate uses
        // strict less-than, so the boundary belongs to the
        // "still fresh" half.
        let gap = FORWARDER_FRESHNESS_THRESHOLD.as_millis() as i64 - 1;
        let snap = snapshot(true, false, true, NOW_MS - gap);
        assert_eq!(
            evaluate_forwarder_reuse(&snap, NOW_MS),
            ReuseDecision::Reuse
        );
    }

    #[test]
    fn paused_forwarder_skips_freshness_gate() {
        // Paused loops legitimately have no harness traffic; gating
        // on freshness for them would force a forwarder rebuild on
        // every Resume click and regress the pause/resume happy path.
        let stale = NOW_MS - (FORWARDER_FRESHNESS_THRESHOLD.as_millis() as i64) - 1_000;
        let snap = snapshot(true, true, true, stale);
        assert_eq!(
            evaluate_forwarder_reuse(&snap, NOW_MS),
            ReuseDecision::Reuse
        );
    }

    #[test]
    fn dead_forwarder_is_refused_even_when_fresh() {
        let snap = snapshot(false, false, true, NOW_MS);
        assert_eq!(
            evaluate_forwarder_reuse(&snap, NOW_MS),
            ReuseDecision::Refuse
        );
    }

    #[test]
    fn mismatched_automaton_id_is_refused() {
        let snap = snapshot(true, false, false, NOW_MS);
        assert_eq!(
            evaluate_forwarder_reuse(&snap, NOW_MS),
            ReuseDecision::Refuse
        );
    }
}
