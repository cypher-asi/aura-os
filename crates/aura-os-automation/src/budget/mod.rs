//! Retry budgets shared across the dev-loop and chat agent.
//!
//! Each budget is a single `u32` constant; the values are deliberately
//! small so callers can pass them by value. The constants live in
//! distinct files so future per-budget documentation / metrics hooks
//! grow without rewriting the rest of the module.

pub mod task_retry;
pub mod tool_retry;

pub use task_retry::TASK_LEVEL_RETRY_BUDGET;
pub use tool_retry::TOOL_CALL_RETRY_BUDGET;
