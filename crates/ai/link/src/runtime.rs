//! The core agent runtime trait.

use async_trait::async_trait;

use crate::error::RuntimeError;
use crate::turn_types::{TurnRequest, TurnResult};

/// A pluggable agent execution backend.
///
/// Implementations handle the full agentic loop: LLM calls, tool execution,
/// result injection, and iteration until the model returns `EndTurn` or a
/// stop condition is reached.
///
/// The current production implementation is
/// [`LinkRuntime`](crate::LinkRuntime), which wraps
/// `aura-agent::AgentLoop`.
///
/// `aura-chat::InternalRuntime` still exists only for legacy integration tests
/// that have not yet migrated to `LinkRuntime`.
#[async_trait]
pub trait AgentRuntime: Send + Sync {
    /// Execute a complete agent turn.
    async fn execute_turn(&self, request: TurnRequest) -> Result<TurnResult, RuntimeError>;
}
