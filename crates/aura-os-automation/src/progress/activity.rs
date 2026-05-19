//! Pure mapping `apply_loop_activity` from a harness wire event-type
//! string to a [`LoopActivityTransition`].

use aura_os_events::{LoopActivity, LoopStatus};

use crate::event_kinds as ek;

/// Hint string the mapper writes into `LoopActivity::current_step` when
/// the loop becomes [`LoopStatus::Running`] on a text/thinking delta.
/// Static so the mapper can stay allocation-free.
pub const STEP_THINKING: &str = "thinking";

/// Hint string the mapper writes into `LoopActivity::current_step` when
/// the loop returns to [`LoopStatus::Running`] after a tool result.
pub const STEP_PROCESSING: &str = "processing";

/// Computed activity transition for a single harness event.
///
/// The mapper itself never touches the live registry; the server-side
/// shim is responsible for forwarding the transition into
/// `LoopHandle::transition` and (for [`LoopActivityTransition::WaitingTool`])
/// pulling the tool name out of the event payload before formatting
/// the `current_step` hint.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum LoopActivityTransition {
    /// Move to [`LoopStatus::Running`] with the given step hint.
    Running {
        /// Short human-readable hint stored in
        /// `LoopActivity::current_step`. Static so the mapper does
        /// not allocate; the shim turns it into a `String` when it
        /// applies the transition.
        step: &'static str,
    },
    /// Move to [`LoopStatus::WaitingTool`]. The shim formats the
    /// `current_step` from the event payload's `tool` field (e.g.
    /// `"tool: read_file"`).
    WaitingTool,
}

/// Map a harness event-kind string to an activity transition for the
/// dev-loop progress indicator.
///
/// Returns `None` when the event is intentionally non-status-bearing
/// (token-usage, snapshot updates, terminal harness lifecycle events
/// that are handled by `LoopHandle::mark_completed`/`mark_failed`),
/// or when the event would not change the observable activity (e.g. a
/// `text_delta` arriving while we are already in
/// [`LoopStatus::Running`] with the `"thinking"` step).
///
/// Match arms compare against [`crate::event_kinds`] constants — never
/// raw strings. The constants mirror the harness's
/// `automaton_event_kinds` module and are pinned by the
/// `event_kinds_match_harness_constants` invariant test.
#[must_use]
pub fn apply_loop_activity(
    current: &LoopActivity,
    event_kind: &str,
) -> Option<LoopActivityTransition> {
    let next = match event_kind {
        ek::TEXT_DELTA | ek::THINKING_DELTA => LoopActivityTransition::Running {
            step: STEP_THINKING,
        },
        ek::TOOL_USE_START | ek::TOOL_CALL_STARTED => LoopActivityTransition::WaitingTool,
        ek::TOOL_CALL_COMPLETED | ek::TOOL_RESULT => LoopActivityTransition::Running {
            step: STEP_PROCESSING,
        },
        _ => return None,
    };
    if matches_current(current, &next) {
        return None;
    }
    Some(next)
}

/// `true` when `next` would not change the observable activity.
///
/// The registry's 4 Hz throttle would already drop most redundant
/// publishes, but returning `None` here lets the shim short-circuit
/// without taking the per-loop `write_lock` in the hot path. It also
/// makes the "no state change" branch directly testable.
fn matches_current(current: &LoopActivity, next: &LoopActivityTransition) -> bool {
    match next {
        LoopActivityTransition::Running { step } => {
            current.status == LoopStatus::Running && current.current_step.as_deref() == Some(*step)
        }
        // The shim formats current_step from the event payload, so we
        // cannot decide here whether the WaitingTool transition is a
        // no-op without inspecting the event. Treat every WaitingTool
        // event as a transition; the registry's throttle still rate-
        // limits the publish.
        LoopActivityTransition::WaitingTool => false,
    }
}
