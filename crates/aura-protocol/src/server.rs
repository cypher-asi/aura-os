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
use crate::context::{ContextBreakdown, ContextContents};

/// Top-level outbound message envelope.
// `AssistantMessageEnd` is intentionally the largest variant: it carries
// the full per-turn `SessionUsage` (now including the optional rendered
// `ContextContents`) by value. This envelope is deserialized once per SSE
// frame on a turn boundary, not allocated in a hot loop, so the
// `large_enum_variant` size cost is negligible; boxing it would force
// `Box`/deref churn across the ~35 call sites that construct and match it
// for no real runtime benefit.
#[allow(clippy::large_enum_variant)]
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
    /// Progress heartbeat. Strictly additive: the harness emits these
    /// during long tool calls (`stage = "tool_running"`, every
    /// `AURA_TURN_TOOL_HEARTBEAT_INTERVAL_SECS`) so the aura-os
    /// sliding-idle watchdog and the client-side stuck-stream
    /// watchdog see forward motion and don't trip a `turn_timeout` on
    /// a turn that is actually working. Older clients ignore unknown
    /// SSE event types (the chat handler already does — see
    /// `interface/src/hooks/use-chat-stream/build-stream-handler.ts`
    /// `EventType.Progress` branch) so adding the variant is
    /// wire-compatible in both directions.
    Progress(ProgressMsg),
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
    /// A subagent (`task` tool) child run has been spawned and is now
    /// observable as its own live thread. Emitted on the PARENT stream
    /// before the blocking `task` tool returns, so a client can render
    /// a clickable thread card and lazily attach to `child_run_id`.
    SubagentSpawned(SubagentSpawned),
    /// Terminal (or transitional) status update for a previously
    /// announced subagent child run. Emitted on the parent stream so
    /// the thread card reflects running/completed/failed/etc.
    SubagentStatus(SubagentStatus),
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
///
/// `result` carries the textual tool output (the string-only contract
/// used by every existing tool). Computer-use / vision tools may
/// additionally attach a single rendered frame via the optional
/// `image_base64` + `image_media_type` pair: the harness (the
/// producer of this message) base64-encodes a PNG/JPEG screenshot and
/// stamps its media type so the server can persist it and replay it to
/// the model as an Anthropic `image` content block inside the
/// `tool_result`.
///
/// Both image fields are strictly additive and backward compatible:
/// `#[serde(default)]` lets older producers omit them on the wire, and
/// `skip_serializing_if = "Option::is_none"` keeps the JSON
/// byte-identical to today's shape when no image is present. A message
/// with neither field behaves exactly as before — a string result.
///
/// Never log the base64 payload; log `image_media_type` and the
/// encoded byte length only.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "typescript", derive(TS), ts(export))]
pub struct ToolResultMsg {
    pub name: String,
    pub result: String,
    pub is_error: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_use_id: Option<String>,
    /// Base64-encoded PNG/JPEG payload of an image tool-result (e.g. a
    /// computer-use screenshot). `None` for the ordinary string-only
    /// path. Pairs with [`Self::image_media_type`].
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub image_base64: Option<String>,
    /// IANA media type of [`Self::image_base64`] (e.g. `"image/png"`).
    /// `None` when no image is attached.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub image_media_type: Option<String>,
}

/// Payload for `subagent_spawned`.
///
/// Announces a child subagent run on the parent stream. `child_run_id`
/// is a freshly minted run id the client can attach to via
/// `WS /stream/:child_run_id`. `parent_tool_use_id` ties the thread
/// back to the originating `task` tool-use block so the UI can render
/// the live thread under that tool card.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "typescript", derive(TS), ts(export))]
pub struct SubagentSpawned {
    pub child_run_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub parent_tool_use_id: Option<String>,
    pub subagent_type: String,
    pub prompt: String,
    /// Model id driving this child run. Set for AURA Council members so
    /// the UI can label each column; `None` for ordinary `task` spawns.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    /// Zero-based council slot index for AURA Council members (ordering
    /// the columns); `None` for ordinary `task` spawns.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub council_index: Option<u32>,
    /// Council combine mechanism (`synthesize` / `contrast` /
    /// `side_by_side`) shared by every member of the turn. Set on AURA
    /// Council member spawns so the UI can label the panel with the
    /// active mechanism; `None` for ordinary `task` spawns.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub council_mechanism: Option<String>,
}

/// Payload for `subagent_status`.
///
/// `state` is one of `running | completed | failed | cancelled |
/// timeout | rejected`. `reason` carries the failure/rejection detail
/// when applicable (depth/quota rejections surface here).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "typescript", derive(TS), ts(export))]
pub struct SubagentStatus {
    pub child_run_id: String,
    pub state: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
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
    /// Per-bucket token estimates that sum (approximately) to
    /// `estimated_context_tokens`. Strictly additive — older harness
    /// builds emit `ContextBreakdown::default()` (all zeros), and the
    /// frontend treats an all-zero breakdown as "not available" and
    /// falls back to the legacy used/total view.
    #[serde(default)]
    pub context_breakdown: ContextBreakdown,
    /// Rendered text the harness counted for each static context
    /// bucket, fetched lazily by the client when a user opens a bucket
    /// in the Context Composition popover. Strictly additive — older
    /// harness builds omit it, and the frontend treats a
    /// missing/empty value as "content not available from this harness
    /// build yet" (mirrors the tolerant `context_breakdown` convention).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub context_contents: Option<ContextContents>,
}

/// A single file mutation observed during a turn.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "typescript", derive(TS), ts(export))]
pub struct FileOp {
    pub path: String,
    pub operation: String,
}

/// Per-file diff metadata that runs alongside the path lists in
/// [`FilesChanged`]. Optional and additive: senders that don't compute
/// line counts (older harnesses, write/delete tool paths) simply omit
/// the entry, and consumers must treat "no entry for path" / "0 / 0"
/// as "unknown", not "no change".
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "typescript", derive(TS), ts(export))]
pub struct FileDiff {
    pub path: String,
    pub lines_added: u32,
    pub lines_removed: u32,
}

/// Summary of file mutations during a turn.
///
/// `diffs` is a parallel list of per-path line-count metadata. It lives
/// alongside `created` / `modified` / `deleted` (rather than replacing
/// them) so older clients that only know about the path lists keep
/// working untouched. The serde default + skip_if_empty pair keeps the
/// wire format byte-identical when no diffs are computed, preserving
/// JSON-shape compatibility with any pinned schemas.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[cfg_attr(feature = "typescript", derive(TS), ts(export))]
pub struct FilesChanged {
    pub created: Vec<String>,
    pub modified: Vec<String>,
    pub deleted: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub diffs: Vec<FileDiff>,
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
    /// Short opaque id (12 lowercase hex chars) used to correlate this
    /// error across server logs, client breadcrumbs, and user-pasted
    /// support reports. Strictly additive on the wire:
    ///
    /// - Older clients that don't know the field deserialize fine
    ///   (`#[serde(default)]` keeps the field optional inbound), and
    ///   the sender omits it from the JSON when `None`
    ///   (`skip_serializing_if = "Option::is_none"`) so older receivers
    ///   never see an unexpected key.
    /// - Older harness builds simply leave it `None`. The aura-os SSE
    ///   remap boundary in `apps/aura-os-server/src/handlers/agents/chat/errors.rs`
    ///   keeps stamping a `(support_id=<id>)` suffix into `message`
    ///   for that case so existing clients still get a usable id.
    /// - Newer harness in-process emit sites (e.g. the watchdog
    ///   `stream_stalled` / `turn_timeout` synth, the agent loop's
    ///   `agent_stalled` terminal event) can pre-populate the field so
    ///   the same id appears on both the structured field and the
    ///   message suffix; the SSE remap path leaves a prepopulated id
    ///   untouched.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub support_id: Option<String>,
}

/// Payload for `progress` heartbeat / status events.
///
/// `stage` is the only required field and carries a free-form short
/// label (`"tool_running"`, `"lagged"`, `"forked_for_context"`, …).
/// Unknown stages flow straight through to the client which renders
/// them as a generic progress label, so we can introduce new stages
/// without coordinating a wire bump.
///
/// Optional fields are omitted from the JSON when `None`
/// (`skip_serializing_if = "Option::is_none"`) and default to `None`
/// inbound (`#[serde(default)]`) so older harness/client pairs that
/// don't know about them deserialize cleanly.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "typescript", derive(TS), ts(export))]
pub struct ProgressMsg {
    /// Short machine-readable stage tag. The aura-os chat client
    /// renders unknown values as the literal label, so adding new
    /// stages does not require a coordinated client release.
    pub stage: String,
    /// Tool whose long-running execution is producing this heartbeat.
    /// Set on `stage = "tool_running"`; left `None` for stages that
    /// don't refer to a single tool (e.g. `"lagged"`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tool_name: Option<String>,
    /// Wall-clock milliseconds since the heartbeat's reference event
    /// (tool start for `"tool_running"`). Optional — older clients
    /// ignore it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub elapsed_ms: Option<u64>,
    /// Optional human-readable label / detail string.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
    /// UTF-8 suffix lengths from the interrupted attempt only.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reset_text_bytes: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reset_thinking_bytes: Option<u64>,
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tool_result_without_image_omits_image_fields() {
        // The string-only path must serialize byte-identically to the
        // pre-image contract: no `image_base64` / `image_media_type`
        // keys appear when both are `None`.
        let msg = ToolResultMsg {
            name: "read_file".to_string(),
            result: "file contents".to_string(),
            is_error: false,
            tool_use_id: Some("toolu_1".to_string()),
            image_base64: None,
            image_media_type: None,
        };
        let json = serde_json::to_string(&msg).expect("serialize tool result");
        assert!(
            !json.contains("image_base64"),
            "absent image must be skipped: {json}"
        );
        assert!(
            !json.contains("image_media_type"),
            "absent media type must be skipped: {json}"
        );

        let back: ToolResultMsg = serde_json::from_str(&json).expect("deserialize tool result");
        assert_eq!(back.name, "read_file");
        assert_eq!(back.result, "file contents");
        assert!(!back.is_error);
        assert_eq!(back.tool_use_id.as_deref(), Some("toolu_1"));
        assert_eq!(back.image_base64, None);
        assert_eq!(back.image_media_type, None);
    }

    #[test]
    fn tool_result_with_image_round_trips() {
        // A computer-use screenshot result must round-trip both image
        // fields. The base64 here is a tiny placeholder — the test
        // asserts the contract, not the payload.
        let msg = ToolResultMsg {
            name: "computer".to_string(),
            result: "screenshot taken".to_string(),
            is_error: false,
            tool_use_id: Some("toolu_shot".to_string()),
            image_base64: Some("aGVsbG8=".to_string()),
            image_media_type: Some("image/png".to_string()),
        };
        let json = serde_json::to_string(&msg).expect("serialize image tool result");
        assert!(json.contains("\"image_base64\":\"aGVsbG8=\""), "{json}");
        assert!(
            json.contains("\"image_media_type\":\"image/png\""),
            "{json}"
        );

        let back: ToolResultMsg = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(back.image_base64.as_deref(), Some("aGVsbG8="));
        assert_eq!(back.image_media_type.as_deref(), Some("image/png"));
        assert_eq!(back.result, "screenshot taken");
    }

    #[test]
    fn tool_result_legacy_json_deserializes_without_image_fields() {
        // An older harness build emits no image keys at all; the field
        // defaults must keep that payload deserializing cleanly.
        let legacy = serde_json::json!({
            "name": "list_files",
            "result": "a\nb\nc",
            "is_error": false,
        });
        let back: ToolResultMsg =
            serde_json::from_value(legacy).expect("legacy payload deserializes");
        assert_eq!(back.image_base64, None);
        assert_eq!(back.image_media_type, None);
        assert_eq!(back.tool_use_id, None);
    }
}
