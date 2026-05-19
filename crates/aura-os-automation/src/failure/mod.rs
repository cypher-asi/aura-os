//! Fallback failure-reason synthesis for harness `task_failed`
//! events that arrive without an extractable reason.
//!
//! Phase G3a / Section B. The dev-loop forwarder calls
//! [`synthesize_failure_reason`] from the `task_failed` arm in
//! `apps/aura-os-server/src/handlers/dev_loop/streaming/side_effects.rs`
//! whenever the standard reason fields (`reason`, `message`, `error`,
//! `code`) are all empty. Without this fallback the persisted
//! `Task.execution_notes` ended up blank and the UI showed "Task
//! failed without producing output" with nothing actionable for the
//! operator.
//!
//! The synthesizer itself is a small pure function — it owns no I/O
//! and no allocations beyond the returned `String`. The caller in
//! `side_effects.rs` builds a [`FailureContext`] from whatever signal
//! is locally available (the event payload, a recent tool name
//! cache, the live-output tail), then hands it to
//! [`synthesize_failure_reason`].

pub mod synthesize;

#[cfg(test)]
mod tests;

pub use synthesize::{synthesize_failure_reason, FailureContext};
