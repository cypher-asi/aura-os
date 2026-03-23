//! Tool execution trait and result types.
//!
//! All types are re-exported from `aura-agent` to avoid duplication.
//! The `ToolExecutor` name is kept as an alias for backward compatibility.

pub use aura_agent::{AutoBuildResult, BuildBaseline, ToolCallResult};

/// Trait for executing tool calls during an agent turn.
///
/// This is a re-export of `aura_agent::AgentToolExecutor` under the
/// name `ToolExecutor` for backward compatibility with existing app code.
pub use aura_agent::AgentToolExecutor as ToolExecutor;
