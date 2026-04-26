//! Outbound (server → client) wire messages and their payloads.
//!
//! [`OutboundMessage`] is the top-level enum streamed from the harness to a
//! websocket client. It covers session-level events (ready / start / end),
//! incremental text and tool deltas, tool-result and tool-approval prompts,
//! errors, and image / 3D generation events.

use serde::{Deserialize, Serialize};

#[cfg(feature = "typescript")]
use ts_rs::TS;

use crate::common::{ToolApprovalRemember, ToolStateWire};

/// Top-level outbound message envelope.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
#[cfg_attr(feature = "typescript", derive(TS), ts(export))]
pub enum OutboundMessage {
    /// Session initialized and ready.
    SessionReady(SessionReady),
    /// Start of an assistant message.
    AssistantMessageStart(AssistantMessageStart),
    /// Incremental text content from the model.
    TextDelta(TextDelta),
    /// Incremental thinking content from the model.
    ThinkingDelta(ThinkingDelta),
    /// A tool use has started.
    ToolUseStart(ToolUseStart),
    /// Snapshot of a tool call with accumulated input (streamed incrementally).
    ToolCallSnapshot(ToolCallSnapshot),
    /// Result of a tool execution.
    ToolResult(ToolResultMsg),
    /// Ask the client to approve or deny a live tool call.
    ToolApprovalPrompt(ToolApprovalPrompt),
    /// End of an assistant message (turn complete).
    AssistantMessageEnd(AssistantMessageEnd),
    /// An error occurred.
    Error(ErrorMsg),
    /// Generation started.
    GenerationStart(GenerationStart),
    /// Generation progress update.
    GenerationProgress(GenerationProgressMsg),
    /// Partial image data (progressive rendering).
    GenerationPartialImage(GenerationPartialImage),
    /// Generation completed successfully.
    GenerationCompleted(GenerationCompleted),
    /// Generation failed.
    GenerationError(GenerationErrorMsg),
}

/// Payload for `session_ready`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "typescript", derive(TS), ts(export))]
pub struct SessionReady {
    pub session_id: String,
    pub tools: Vec<ToolInfo>,
    /// Skills that are active (installed + resolved) for this session's agent.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub skills: Vec<SkillInfo>,
}

/// Minimal tool info for the `session_ready` response.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "typescript", derive(TS), ts(export))]
pub struct ToolInfo {
    pub name: String,
    pub description: String,
    #[serde(default = "default_tool_state_on")]
    pub effective_state: ToolStateWire,
}

const fn default_tool_state_on() -> ToolStateWire {
    ToolStateWire::On
}

/// Minimal skill info surfaced in `session_ready`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "typescript", derive(TS), ts(export))]
pub struct SkillInfo {
    pub name: String,
    pub description: String,
}

/// Payload for `assistant_message_start`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "typescript", derive(TS), ts(export))]
pub struct AssistantMessageStart {
    pub message_id: String,
}

/// Payload for `text_delta`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "typescript", derive(TS), ts(export))]
pub struct TextDelta {
    pub text: String,
}

/// Payload for `thinking_delta`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "typescript", derive(TS), ts(export))]
pub struct ThinkingDelta {
    pub thinking: String,
}

/// Payload for `tool_use_start`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "typescript", derive(TS), ts(export))]
pub struct ToolUseStart {
    pub id: String,
    pub name: String,
}

/// Payload for `tool_call_snapshot` -- incrementally accumulated tool input.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "typescript", derive(TS), ts(export))]
pub struct ToolCallSnapshot {
    pub id: String,
    pub name: String,
    pub input: serde_json::Value,
}

/// Payload for `tool_result`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "typescript", derive(TS), ts(export))]
pub struct ToolResultMsg {
    pub name: String,
    pub result: String,
    pub is_error: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_use_id: Option<String>,
}

/// Payload for `tool_approval_prompt`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "typescript", derive(TS), ts(export))]
pub struct ToolApprovalPrompt {
    pub request_id: String,
    pub tool_name: String,
    pub args: serde_json::Value,
    pub agent_id: String,
    pub remember_options: Vec<ToolApprovalRemember>,
}

/// Payload for `assistant_message_end`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "typescript", derive(TS), ts(export))]
pub struct AssistantMessageEnd {
    pub message_id: String,
    pub stop_reason: String,
    pub usage: SessionUsage,
    pub files_changed: FilesChanged,
    /// Phase 5 billing roll-up: the originating user whose budget
    /// should absorb this turn's cost. When `None`, the immediate
    /// agent owner is billed (today's behavior). Populated by the
    /// harness when a spawned agent's work should roll up to the
    /// ancestor user via `walk_parent_chain`. Strictly additive —
    /// older harness builds never set this field; older clients
    /// ignore it on deserialize.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub originating_user_id: Option<String>,
}

/// Token usage information for a session.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[cfg_attr(feature = "typescript", derive(TS), ts(export))]
pub struct SessionUsage {
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub estimated_context_tokens: u64,
    pub cache_creation_input_tokens: u64,
    pub cache_read_input_tokens: u64,
    pub cumulative_input_tokens: u64,
    pub cumulative_output_tokens: u64,
    pub cumulative_cache_creation_input_tokens: u64,
    pub cumulative_cache_read_input_tokens: u64,
    /// Fraction of the model's context window consumed (0.0–1.0).
    pub context_utilization: f32,
    /// Model identifier used for this turn.
    pub model: String,
    /// Provider name (e.g., "anthropic").
    pub provider: String,
}

/// A single file mutation observed during a turn.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "typescript", derive(TS), ts(export))]
pub struct FileOp {
    pub path: String,
    pub operation: String,
}

/// Summary of file mutations during a turn.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[cfg_attr(feature = "typescript", derive(TS), ts(export))]
pub struct FilesChanged {
    pub created: Vec<String>,
    pub modified: Vec<String>,
    pub deleted: Vec<String>,
}

impl FilesChanged {
    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.created.is_empty() && self.modified.is_empty() && self.deleted.is_empty()
    }
}

/// Payload for `error`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "typescript", derive(TS), ts(export))]
pub struct ErrorMsg {
    pub code: String,
    pub message: String,
    pub recoverable: bool,
}

// ============================================================================
// Generation Event Types
// ============================================================================

/// Payload for `generation_start`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "typescript", derive(TS), ts(export))]
pub struct GenerationStart {
    pub mode: String,
}

/// Payload for `generation_progress`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "typescript", derive(TS), ts(export))]
pub struct GenerationProgressMsg {
    pub percent: f64,
    pub message: String,
}

/// Payload for `generation_partial_image`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "typescript", derive(TS), ts(export))]
pub struct GenerationPartialImage {
    pub data: String,
}

/// Payload for `generation_completed`.
///
/// The `payload` field carries the raw response from the generation backend,
/// whose shape varies by mode (image vs 3D).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "typescript", derive(TS), ts(export))]
pub struct GenerationCompleted {
    pub mode: String,
    #[serde(default)]
    pub payload: serde_json::Value,
}

/// Payload for `generation_error`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "typescript", derive(TS), ts(export))]
pub struct GenerationErrorMsg {
    pub code: String,
    pub message: String,
}
