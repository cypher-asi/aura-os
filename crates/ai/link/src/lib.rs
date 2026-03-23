#![warn(missing_docs)]
//! Agentic execution link — abstractions for running LLM agent turns.
//!
//! This crate defines the [`AgentRuntime`] trait (the seam where different
//! execution backends plug in) and supporting types like [`ToolExecutor`],
//! [`TurnRequest`], [`TurnResult`], and [`RuntimeEvent`].
//!
//! Conversation and tool types are re-exported from the harness crates
//! (`aura-reasoner`, `aura-agent`) so consumers get the canonical definitions
//! without pulling in provider crates directly.

mod error;
mod events;
mod executor;
mod link_runtime;
mod runtime;
mod turn_types;
mod types;

pub use aura_agent::build;
pub use aura_agent::compaction;
pub use aura_agent::planning;
pub use aura_agent::policy;
pub use aura_agent::self_review;
pub use error::RuntimeError;
pub use events::RuntimeEvent;
pub use executor::{AutoBuildResult, BuildBaseline, ToolCallResult, ToolExecutor};
pub use link_runtime::LinkRuntime;
pub use runtime::AgentRuntime;
pub use turn_types::{TotalUsage, TurnConfig, TurnRequest, TurnResult};
pub use types::{
    tool_result_as_str, tool_result_text_mut, CacheControl, ContentBlock, ImageSource, Message,
    MessageContent, Role, ThinkingConfig, ToolCall, ToolDefinition, ToolResultContent,
};

#[cfg(test)]
mod tests;
