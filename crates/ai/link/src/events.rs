//! Streaming events emitted during an agent turn.

/// Events emitted by an [`AgentRuntime`](crate::AgentRuntime) during execution.
///
/// These are the canonical event types that consumers (e.g. the chat streaming
/// layer) subscribe to for real-time progress updates.
#[derive(Debug, Clone)]
pub enum RuntimeEvent {
    /// A chunk of assistant text output.
    Delta(String),
    /// A chunk of extended thinking output.
    ThinkingDelta(String),
    /// A tool invocation has started (name known, input not yet complete).
    ToolUseStarted {
        /// Tool use identifier.
        id: String,
        /// Tool name.
        name: String,
    },
    /// Parsed snapshot of tool input JSON (streamed incrementally).
    ToolInputSnapshot {
        /// Tool use identifier.
        id: String,
        /// Tool name.
        name: String,
        /// Parsed tool input snapshot.
        input: serde_json::Value,
    },
    /// A tool invocation is fully parsed (input available).
    ToolUseDetected {
        /// Tool use identifier.
        id: String,
        /// Tool name.
        name: String,
        /// Parsed tool input.
        input: serde_json::Value,
    },
    /// A tool has produced a result.
    ToolResult {
        /// The tool_use id this result corresponds to.
        tool_use_id: String,
        /// Tool name.
        tool_name: String,
        /// Textual result content.
        content: String,
        /// Whether this result represents an error.
        is_error: bool,
    },
    /// Cumulative token usage reported after each LLM iteration.
    ///
    /// Values are running totals for the turn, not per-iteration deltas.
    IterationTokenUsage {
        /// Input tokens consumed.
        input_tokens: u64,
        /// Output tokens generated.
        output_tokens: u64,
    },
    /// A tool-loop iteration completed (all tool calls in this round finished).
    IterationComplete {
        /// Zero-based iteration index.
        iteration: usize,
    },
    /// A non-fatal warning occurred during the turn.
    Warning(String),
    /// An error occurred during the turn.
    Error(String),
}
