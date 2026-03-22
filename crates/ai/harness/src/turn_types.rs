//! Request and result types for agent turns.

use std::sync::Arc;
use std::time::Duration;

use tokio::sync::mpsc;

use crate::events::RuntimeEvent;
use crate::executor::ToolExecutor;
use crate::types::{Message, ThinkingConfig, ToolDefinition};

/// Configuration for a single agent turn.
pub struct TurnConfig {
    /// Maximum LLM iterations before stopping.
    pub max_iterations: usize,
    /// Maximum tokens per LLM call.
    pub max_tokens: u32,
    /// Extended thinking configuration.
    pub thinking: Option<ThinkingConfig>,
    /// Timeout for the streaming response.
    pub stream_timeout: Duration,
    /// Maximum context tokens before compaction.
    pub max_context_tokens: Option<u64>,
    /// Override the LLM model for this turn.
    pub model_override: Option<String>,
    /// Base exploration allowance (read-only tool calls before blocking).
    pub exploration_allowance: Option<usize>,
    /// Iterations between automatic build checks.
    pub auto_build_cooldown: Option<usize>,
}

/// A request to execute a single agent turn.
pub struct TurnRequest {
    /// The system prompt.
    pub system_prompt: String,
    /// Conversation messages.
    pub messages: Vec<Message>,
    /// Available tool definitions.
    pub tools: Arc<[ToolDefinition]>,
    /// The tool executor to use for this turn.
    pub executor: Arc<dyn ToolExecutor>,
    /// Turn configuration.
    pub config: TurnConfig,
    /// Optional channel for streaming runtime events.
    pub event_tx: Option<mpsc::UnboundedSender<RuntimeEvent>>,
}

/// Aggregated token usage across all iterations of a turn.
#[derive(Debug, Clone, Default)]
pub struct TotalUsage {
    /// Total input tokens consumed.
    pub input_tokens: u64,
    /// Total output tokens generated.
    pub output_tokens: u64,
}

/// The result of a completed agent turn.
#[derive(Debug)]
pub struct TurnResult {
    /// The final assistant text response.
    pub text: String,
    /// Extended thinking content.
    pub thinking: String,
    /// Aggregated token usage.
    pub usage: TotalUsage,
    /// Number of LLM iterations executed.
    pub iterations_run: usize,
    /// Whether the turn timed out.
    pub timed_out: bool,
    /// Whether the turn stopped due to insufficient credits.
    pub insufficient_credits: bool,
    /// Non-billing LLM error message, if any.
    pub llm_error: Option<String>,
}
