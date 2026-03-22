//! Runtime error types.

/// Errors that can occur during agent runtime execution.
#[derive(Debug, thiserror::Error)]
pub enum RuntimeError {
    /// The underlying model provider returned an error.
    #[error("provider error: {0}")]
    Provider(String),

    /// Tool execution failed.
    #[error("tool execution error: {0}")]
    ToolExecution(String),

    /// The turn exceeded its iteration or token budget.
    #[error("turn budget exhausted: {0}")]
    BudgetExhausted(String),

    /// The account has insufficient credits.
    #[error("insufficient credits")]
    InsufficientCredits,

    /// An internal error occurred.
    #[error("internal error: {0}")]
    Internal(String),
}
