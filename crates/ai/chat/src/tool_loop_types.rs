use std::time::Duration;

use async_trait::async_trait;
use aura_claude::{ThinkingConfig, ToolCall};

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

pub struct ToolLoopConfig {
    pub max_iterations: usize,
    pub max_tokens: u32,
    pub thinking: Option<ThinkingConfig>,
    pub stream_timeout: Duration,
    pub billing_reason: &'static str,
    /// When set, the loop uses API-reported input_tokens (not the chars/4
    /// heuristic) to detect context window pressure and retroactively compact
    /// older tool results before the next iteration.
    pub max_context_tokens: Option<u64>,
    /// Maximum credits to spend in this tool loop. The loop stops gracefully
    /// when cumulative debited credits approach this limit. `None` means no cap.
    pub credit_budget: Option<u64>,
    /// Base exploration allowance (read_file, search_code, find_files,
    /// list_files calls before blocking). Defaults to 12 when `None`.
    pub exploration_allowance: Option<usize>,
    /// Override the LLM model for this loop (e.g. use a lighter model for
    /// simple tasks). `None` uses the provider's default.
    pub model_override: Option<String>,
}

// ---------------------------------------------------------------------------
// Tool execution trait -- callers implement this
// ---------------------------------------------------------------------------

pub struct ToolCallResult {
    pub tool_use_id: String,
    pub content: String,
    pub is_error: bool,
    /// When true the loop will break after processing all results in this batch.
    pub stop_loop: bool,
}

#[async_trait]
pub trait ToolExecutor: Send + Sync {
    async fn execute(&self, tool_calls: &[ToolCall]) -> Vec<ToolCallResult>;
}

// ---------------------------------------------------------------------------
// Stream events emitted by the loop
// ---------------------------------------------------------------------------

#[derive(Debug, Clone)]
pub enum ToolLoopEvent {
    Delta(String),
    ThinkingDelta(String),
    ToolUseDetected {
        id: String,
        name: String,
        input: serde_json::Value,
    },
    ToolResult {
        tool_use_id: String,
        tool_name: String,
        content: String,
        is_error: bool,
    },
    IterationTokenUsage {
        input_tokens: u64,
        output_tokens: u64,
    },
    Error(String),
}

// ---------------------------------------------------------------------------
// Result
// ---------------------------------------------------------------------------

pub struct ToolLoopResult {
    pub text: String,
    pub thinking: String,
    pub total_input_tokens: u64,
    pub total_output_tokens: u64,
    pub iterations_run: usize,
    pub timed_out: bool,
    pub insufficient_credits: bool,
    /// Set when the LLM returned a non-billing API error (e.g. provider
    /// credit exhaustion, rate limit, auth failure). Callers should treat
    /// this as a hard failure rather than a successful completion.
    pub llm_error: Option<String>,
}
