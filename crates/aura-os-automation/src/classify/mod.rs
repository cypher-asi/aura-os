//! Failure-reason classifiers shared by dev-loop and chat agents.
//!
//! Each submodule owns one slice of the classification surface:
//!
//! * [`transient`] — string heuristics that decide whether a
//!   `task_failed` / `error` reason looks transient (rate limit,
//!   5xx, connection reset, ...) or terminal (agent-stuck signals).
//! * [`restart`] — composed gates that drive automaton restarts and
//!   per-tool-call retry decisions.
//! * [`push`] — git-push-failure subclassification used by the
//!   reconciler and DoD evidence helpers.
//!
//! The public re-exports below are the single import surface every
//! caller should use. Submodules stay `pub` so test modules can reach
//! into the implementation for white-box checks.

pub mod push;
pub mod restart;
pub mod transient;

#[cfg(test)]
mod tests;

pub use push::classify_push_failure;
pub use restart::{
    classify_restart_reason, should_restart_on_error, tool_call_failed_should_retry,
};
pub use transient::{
    is_agent_stuck_terminal_signal, is_git_push_timeout, is_insufficient_credits,
    is_provider_internal, is_rate_limited, looks_like_unclassified_transient,
};
