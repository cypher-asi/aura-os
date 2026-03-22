#![warn(missing_docs)]
//! Agentic execution link — abstractions for running LLM agent turns.
//!
//! This crate defines the [`AgentRuntime`] trait (the seam where different
//! execution backends plug in) and supporting types like [`ToolExecutor`],
//! [`TurnRequest`], [`TurnResult`], and [`RuntimeEvent`].
//!
//! All conversation and tool types are self-contained within this crate so
//! that consumers do not need to depend on any specific provider crate.

mod error;
mod events;
mod executor;
mod link_runtime;
mod runtime;
mod turn_types;
mod types;

pub use error::RuntimeError;
pub use events::RuntimeEvent;
pub use executor::{AutoBuildResult, BuildBaseline, ToolCallResult, ToolExecutor};
pub use link_runtime::LinkRuntime;
pub use runtime::AgentRuntime;
pub use turn_types::{TotalUsage, TurnConfig, TurnRequest, TurnResult};
pub use types::{
    CacheControl, ContentBlock, ImageSource, Message, MessageContent, Role, ThinkingConfig,
    ToolCall, ToolDefinition,
};

#[cfg(test)]
mod tests;
