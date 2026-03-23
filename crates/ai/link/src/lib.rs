#![warn(missing_docs)]
//! Agentic execution link — abstractions for running LLM agent turns
//! and the [`SwarmClient`] HTTP client for the automaton management API.
//!
//! ## Legacy runtime surface (will be removed)
//!
//! The [`AgentRuntime`] trait, [`LinkRuntime`], [`ToolExecutor`],
//! [`TurnRequest`] / [`TurnResult`], and [`RuntimeEvent`] types are kept
//! temporarily for backward compatibility with the `aura-chat` and
//! `aura-engine` crates.  They will be deleted once those crates are removed.
//!
//! ## SwarmClient
//!
//! [`SwarmClient`] is the new, thin HTTP client that talks to the Swarm
//! automaton daemon.  All new code should use this instead of the legacy
//! runtime types.

// ── Legacy modules (backward compat, will be removed) ────────────────
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

// ── Swarm client ─────────────────────────────────────────────────────
mod swarm_client;
mod swarm_types;

pub use swarm_client::SwarmClient;
pub use swarm_types::{AutomatonEvent, AutomatonInfo, AutomatonStatus, InstallRequest, InstallResponse};

#[cfg(test)]
mod tests;
