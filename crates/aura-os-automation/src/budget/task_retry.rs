//! Per-task budget for full task-level auto-retries.
//!
//! Task-level retries are coarser than the [`tool_call`] budget: they
//! re-run the harness from a known recovery checkpoint rather than
//! restarting just the failing tool call. Section E of the
//! dev-loop progress-signal plan will wire this constant into
//! `safe_transition`; G1 only introduces it so downstream phases have
//! a stable name to import.
//!
//! The default of three matches the existing
//! `DEFAULT_MAX_RETRIES_PER_TASK` constant in
//! `apps/aura-os-server/src/reconciler.rs`; once Section E lands the
//! reconciler's constant will defer to this one.
//!
//! [`tool_call`]: super::tool_retry::TOOL_CALL_RETRY_BUDGET

/// Maximum number of task-level auto-retries the dev-loop will issue
/// before treating a task as terminally failed.
pub const TASK_LEVEL_RETRY_BUDGET: u32 = 3;
