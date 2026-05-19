//! Composed restart-decision gates built on top of [`transient`].
//!
//! These helpers combine the lower-level classifiers into the two
//! decisions the dev-loop actually makes in production:
//!
//! * Should we restart the automaton in response to an `error` event?
//! * Should we issue another infra-retry in response to a
//!   `tool_call_failed` event given the prior retry count?
//!
//! Both gates excluded `is_agent_stuck_terminal_signal` matches: once
//! the harness has decided to stop on its own anti-waste guard,
//! restarting it just thrashes the WS reconnect path.
//!
//! [`transient`]: super::transient

use super::transient::{
    is_agent_stuck_terminal_signal, is_git_push_timeout, is_provider_internal, is_rate_limited,
    looks_like_unclassified_transient,
};
use crate::budget::TOOL_CALL_RETRY_BUDGET;

/// Stable label naming which transient classifier accepted `reason`,
/// or `None` when the reason is terminal / not classified as
/// restartable.
///
/// The returned strings are intentionally short and `'static` so
/// callers can plumb them into structured log fields and metrics
/// labels without allocation.
///
/// Ordering matches the precedence used by [`should_restart_on_error`]
/// so identical inputs produce consistent telemetry.
pub fn classify_restart_reason(reason: &str) -> Option<&'static str> {
    if is_agent_stuck_terminal_signal(reason) {
        return None;
    }
    if is_rate_limited(reason) {
        return Some("rate_limited");
    }
    if is_provider_internal(reason) {
        return Some("provider_internal");
    }
    if is_git_push_timeout(reason) {
        return Some("git_push_timeout");
    }
    if looks_like_unclassified_transient(reason) {
        return Some("transient");
    }
    None
}

/// True when an `error`-event reason from the harness should trigger
/// an automaton restart.
///
/// Restart iff the reason is actually transient (classified or
/// unclassified-transient heuristic) **and** is not a terminal
/// agent-stuck signal.
pub fn should_restart_on_error(reason: &str) -> bool {
    classify_restart_reason(reason).is_some()
}

/// True when a harness-emitted `tool_call_failed` with this `reason`
/// should trigger another server-side infra retry, given the number
/// of retries already consumed for the task.
///
/// Two axes are checked:
///
/// * Classifier: [`should_restart_on_error`] must accept the reason.
/// * Counter: `prior_count` must be strictly below
///   [`TOOL_CALL_RETRY_BUDGET`].
pub fn tool_call_failed_should_retry(reason: &str, prior_count: u32) -> bool {
    prior_count < TOOL_CALL_RETRY_BUDGET && should_restart_on_error(reason)
}
