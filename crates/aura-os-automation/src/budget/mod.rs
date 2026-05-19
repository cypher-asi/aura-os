//! Retry + exploration budgets shared across the dev-loop and
//! chat agent.
//!
//! The retry constants are single `u32` values; the exploration
//! ceiling is a small `Copy` struct scaled per-task by
//! [`exploration::ExplorationBudget::for_task`]. Every budget
//! lives in its own file so future per-budget documentation /
//! metrics hooks grow without rewriting the rest of the module.

pub mod exploration;
pub mod task_retry;
pub mod tool_retry;

#[cfg(test)]
mod tests;

pub use exploration::{
    ExplorationBudget, ExplorationStatus, EXPLORATION_DEPENDENCY_BONUS,
    EXPLORATION_DESCRIPTION_DIVISOR, EXPLORATION_HARD_FLOOR, EXPLORATION_SOFT_CEILING,
    EXPLORATION_SOFT_FLOOR,
};
pub use task_retry::TASK_LEVEL_RETRY_BUDGET;
pub use tool_retry::TOOL_CALL_RETRY_BUDGET;
