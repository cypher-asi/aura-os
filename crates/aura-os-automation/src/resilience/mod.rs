//! Retry tracking and orphan-recovery helpers shared by the
//! dev-loop and chat agent.
//!
//! Phase G3a / Sections D + E. The trackers live here because the
//! server-side `side_effects.rs` (Section D) and `start.rs` /
//! `adapter.rs` (Section E) all need the same budget-gated decision
//! logic but should not own the state model — they own the side
//! effects.
//!
//! ## Pure data structures
//!
//! Both [`ToolRetryTracker`] and [`TaskRetryTracker`] are pure
//! in-memory counters keyed by [`aura_os_core::TaskId`]. The
//! `aura-os-core` `Task` struct has no `retry_count` column today
//! (see `crates/aura-os-core/src/entities/task.rs`) and the
//! aura-storage schema does not persist one either; persisting the
//! count would require a storage migration that belongs to a later
//! phase. Until that lands, the trackers' transient
//! `Mutex<HashMap<TaskId, u32>>` is sufficient because both budgets
//! are per-run anyway — the dev-loop forwarder owns one tracker per
//! loop instance, so a server restart effectively resets the
//! counters to zero, which is the safe default (a fresh run gets
//! the full retry budget).
//!
//! ## Orphan recovery
//!
//! [`recover_orphans`] is a pure function the App layer feeds with
//! `&[Task]`. It returns an [`OrphanRecoveryPlan`] for every task
//! the loop should `safe_transition` back to `Ready` on loop start
//! — currently every task observed in [`TaskStatus::InProgress`].
//! Applying the plans is the server's job; the helper itself does
//! no I/O.

pub mod orphan;
pub mod task_retry;
pub mod tool_retry;

#[cfg(test)]
mod tests;

pub use orphan::{recover_orphans, OrphanRecoveryPlan, ORPHAN_RECOVERY_REASON};
pub use task_retry::TaskRetryTracker;
pub use tool_retry::{RetryDecision, ToolRetryTracker};
