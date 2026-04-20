//! Shared wire protocol types for the Aura harness WebSocket API.
//!
//! Defines the inbound (client → server) and outbound (server → client)
//! message format for the `/stream` WebSocket endpoint.
//!
//! This crate is consumed by both the harness server (`aura-node`) and
//! any client implementation (e.g. `aura-os-link`).
//!
//! # Agent permissions model
//!
//! [`SessionInit::agent_permissions`] is **required** on every session.
//! The harness enforces these permissions unconditionally — there is no
//! role-based fallback, no named preset, and no legacy "no-permissions"
//! default. Every caller opening a session must send an explicit
//! [`AgentPermissionsWire`] value describing the scope + capability bundle
//! the session is allowed to exercise.
//!
//! The single [`crate::SessionInit`] type drives all agent behavior: the
//! free-text `role` field is a UI label with no system meaning; what an
//! agent can actually do is determined entirely by its
//! [`AgentPermissionsWire`] (capabilities + [`AgentScopeWire`]). Spawned
//! child agents must carry a strict subset of their parent's permissions;
//! see `aura_core::AgentPermissions::contains` on the harness side.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fmt;

#[cfg(feature = "typescript")]
use ts_rs::TS;

// ============================================================================
// Inbound Messages (Client → Server)
// ============================================================================

/// Top-level inbound message envelope.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
#[cfg_attr(feature = "typescript", derive(TS), ts(export))]
pub enum InboundMessage {
    /// Initialize the session (must be the first message).
    SessionInit(Box<SessionInit>),
    /// Send a user message for processing.
    UserMessage(UserMessage),
    /// Cancel the current turn.
    Cancel,
    /// Respond to an approval request.
    ApprovalResponse(ApprovalResponse),
    /// Request image or 3D generation.
    GenerationRequest(GenerationRequest),
}

/// A prior conversation message used to hydrate session history.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "typescript", derive(TS), ts(export))]
pub struct ConversationMessage {
    pub role: String,
    pub content: String,
}

/// Payload for `session_init`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "typescript", derive(TS), ts(export))]
pub struct SessionInit {
    #[serde(default)]
    pub system_prompt: Option<String>,
    /// Model identifier (e.g., "claude-opus-4-6").
    #[serde(default)]
    pub model: Option<String>,
    /// Maximum tokens per model response.
    #[serde(default)]
    pub max_tokens: Option<u32>,
    /// Sampling temperature.
    #[serde(default)]
    pub temperature: Option<f32>,
    /// Maximum agentic steps per turn.
    #[serde(default)]
    pub max_turns: Option<u32>,
    /// Installed tools to register for this session.
    #[serde(default)]
    pub installed_tools: Option<Vec<InstalledTool>>,
    /// Installed integrations authorized for this session.
    #[serde(default)]
    pub installed_integrations: Option<Vec<InstalledIntegration>>,
    /// Workspace directory path (must be under the server's workspace base).
    #[serde(default)]
    pub workspace: Option<String>,
    /// Absolute path to the real project directory on the host filesystem.
    /// When set, tool execution happens directly in this directory instead of
    /// the sandboxed `aura_data/workspaces/` tree.
    #[serde(default)]
    pub project_path: Option<String>,
    /// JWT auth token for proxy routing.
    #[serde(default)]
    pub token: Option<String>,
    /// Project ID for domain tool calls (specs, tasks, etc.).
    #[serde(default)]
    pub project_id: Option<String>,
    /// Prior conversation messages to restore into session history.
    #[serde(default)]
    pub conversation_messages: Option<Vec<ConversationMessage>>,
    /// Project-agent UUID for X-Aura-Agent-Id billing header.
    #[serde(default)]
    pub aura_agent_id: Option<String>,
    /// Storage session UUID for X-Aura-Session-Id billing header.
    #[serde(default)]
    pub aura_session_id: Option<String>,
    /// Organization UUID for X-Aura-Org-Id billing header.
    #[serde(default)]
    pub aura_org_id: Option<String>,
    /// Harness-level agent ID for per-agent skill lookup.
    /// Set by the caller (e.g. aura-os) so the harness can resolve which
    /// skills are installed for this agent.
    #[serde(default)]
    pub agent_id: Option<String>,
    /// Optional per-session provider override for BYOK/runtime isolation.
    #[serde(default)]
    pub provider_config: Option<SessionProviderConfig>,
    /// Optional keyword-driven intent classifier spec. When present the harness
    /// narrows the per-turn tool surface based on each user message using the
    /// same tier-1 / tier-2 domain rules aura-os used to run in-process for
    /// the CEO-preset agent. Ships as the profile-JSON subset that
    /// `aura-tools::IntentClassifier::from_profile_json` accepts, plus a
    /// `tool_domains` map from tool name to domain so the harness can narrow
    /// `tool_definitions` (which are opaque to the classifier otherwise).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub intent_classifier: Option<IntentClassifierSpec>,
    /// Explicit [`AgentPermissionsWire`] bundle for this session. Required
    /// on every session; the harness enforces scope + capability checks
    /// unconditionally against these grants. See the module-level
    /// "Agent permissions model" section for details.
    pub agent_permissions: AgentPermissionsWire,
}

/// Wire-compatible mirror of `aura_core::AgentPermissions`.
///
/// Mirrored here so `aura-protocol` stays decoupled from the harness-core
/// crates; the harness translates [`AgentPermissionsWire`] into its own
/// `aura_core::AgentPermissions` at `SessionInit` time. Additive /
/// forward-compatible: unknown capability variants deserialize into
/// [`CapabilityWire::Unknown`] rather than rejecting the session.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "typescript", derive(TS), ts(export))]
pub struct AgentPermissionsWire {
    #[serde(default)]
    pub scope: AgentScopeWire,
    #[serde(default)]
    pub capabilities: Vec<CapabilityWire>,
}

/// Wire-compatible mirror of `aura_core::AgentScope`.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "typescript", derive(TS), ts(export))]
pub struct AgentScopeWire {
    #[serde(default)]
    pub orgs: Vec<String>,
    #[serde(default)]
    pub projects: Vec<String>,
    #[serde(default)]
    pub agent_ids: Vec<String>,
}

/// Wire-compatible mirror of `aura_core::Capability` (externally-tagged
/// camel-case enum matching the core serialization format).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
#[cfg_attr(feature = "typescript", derive(TS), ts(export))]
pub enum CapabilityWire {
    SpawnAgent,
    ControlAgent,
    ReadAgent,
    ManageOrgMembers,
    ManageBilling,
    InvokeProcess,
    PostToFeed,
    GenerateMedia,
    #[serde(rename_all = "camelCase")]
    ReadProject { id: String },
    #[serde(rename_all = "camelCase")]
    WriteProject { id: String },
    /// Wildcard read access over every project in the bundle's scope.
    /// Satisfies any `ReadProject { id }` requirement without having to
    /// enumerate ids. Used by the CEO preset so the unified tool-surface
    /// filter can drop the old `is_ceo_preset()` short-circuit.
    ReadAllProjects,
    /// Wildcard write access over every project in the bundle's scope.
    /// Strict superset of [`ReadAllProjects`]; satisfies any
    /// `WriteProject { id }` requirement (and, by the write-implies-read
    /// rule, any `ReadProject { id }` requirement too).
    WriteAllProjects,
    /// Forward-compat fallback for capabilities introduced after this
    /// protocol version. Deserialized via `#[serde(other)]` so a newer
    /// harness / server can round-trip older wire bundles without
    /// rejecting the session. Producers should never emit this variant.
    #[serde(other)]
    Unknown,
}

/// Keyword-driven classifier spec shipped in [`SessionInit`].
///
/// Matches the JSON shape that
/// `aura-tools::IntentClassifier::from_profile_json` deserializes, extended
/// with `tool_domains` so the harness can answer "which domain does this
/// tool belong to?" without hard-coding the mapping in its binary.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "typescript", derive(TS), ts(export))]
pub struct IntentClassifierSpec {
    /// Domain names that are always visible (tier-1). Snake-case strings
    /// like `"project"`, `"agent"`, `"execution"`, `"monitoring"`.
    pub tier1_domains: Vec<String>,
    /// Keyword rules that expand the visible domain set tier-2 on demand.
    pub classifier_rules: Vec<IntentClassifierRule>,
    /// Mapping from tool name → domain. Any tool whose domain is in the
    /// resolved visible set is kept on a turn.
    #[serde(default)]
    pub tool_domains: HashMap<String, String>,
}

/// One keyword → domain rule for [`IntentClassifierSpec`].
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "typescript", derive(TS), ts(export))]
pub struct IntentClassifierRule {
    pub domain: String,
    pub keywords: Vec<String>,
}

/// Optional per-session provider override used for BYOK-style runtime resolution.
#[derive(Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "typescript", derive(TS), ts(export))]
pub struct SessionProviderConfig {
    /// Provider identifier (currently `anthropic`).
    pub provider: String,
    /// Optional routing mode (`direct` or `proxy`).
    #[serde(default)]
    pub routing_mode: Option<String>,
    /// Optional upstream provider family hint for managed proxy routing.
    /// When set, harness proxy capability decisions prefer this over model-name heuristics.
    #[serde(default)]
    pub upstream_provider_family: Option<String>,
    /// Optional API key for direct provider access.
    #[serde(default)]
    pub api_key: Option<String>,
    /// Optional explicit base URL override.
    #[serde(default)]
    pub base_url: Option<String>,
    /// Optional provider default model for this session.
    #[serde(default)]
    pub default_model: Option<String>,
    /// Optional fallback model.
    #[serde(default)]
    pub fallback_model: Option<String>,
    /// Optional prompt-caching toggle override.
    #[serde(default)]
    pub prompt_caching_enabled: Option<bool>,
}

impl fmt::Debug for SessionProviderConfig {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("SessionProviderConfig")
            .field("provider", &self.provider)
            .field("routing_mode", &self.routing_mode)
            .field("upstream_provider_family", &self.upstream_provider_family)
            .field("api_key", &self.api_key.as_ref().map(|_| "<redacted>"))
            .field("base_url", &self.base_url)
            .field("default_model", &self.default_model)
            .field("fallback_model", &self.fallback_model)
            .field("prompt_caching_enabled", &self.prompt_caching_enabled)
            .finish()
    }
}

/// Payload for `user_message`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "typescript", derive(TS), ts(export))]
pub struct UserMessage {
    pub content: String,
    /// Optional list of tool names the user wants prioritized for this message.
    /// When set, the agent loop will filter tools and set `tool_choice` on the
    /// first iteration to explicitly direct the model toward these tools.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tool_hints: Option<Vec<String>>,
    /// Optional image/text attachments (base64-encoded).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub attachments: Option<Vec<MessageAttachment>>,
}

/// A user-supplied attachment (image or text file) sent with a message.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "typescript", derive(TS), ts(export))]
pub struct MessageAttachment {
    /// `"image"` or `"text"`.
    #[serde(rename = "type")]
    pub type_: String,
    /// MIME type (e.g. `"image/png"`).
    pub media_type: String,
    /// Base64-encoded payload.
    pub data: String,
    /// Optional filename.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
}

/// Payload for `approval_response`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "typescript", derive(TS), ts(export))]
pub struct ApprovalResponse {
    pub tool_use_id: String,
    pub approved: bool,
}
/// Payload for `generation_request`.
///
/// Fields are mode-dependent:
/// - `mode == "image"`: uses `prompt` (required), `model`, `size`, `images`, `is_iteration`
/// - `mode == "3d"`:    uses `image_url` (required), `prompt` (optional hint)
///
/// Both modes accept `project_id` for artifact storage.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "typescript", derive(TS), ts(export))]
pub struct GenerationRequest {
    pub mode: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub prompt: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub size: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub image_url: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub images: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub project_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub is_iteration: Option<bool>,
}

// ============================================================================
// Outbound Messages (Server → Client)
// ============================================================================

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

// ============================================================================
// Installed Tool Types (self-contained, wire-compatible with aura-core)
// ============================================================================

/// Authentication configuration for installed tools.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
#[cfg_attr(feature = "typescript", derive(TS), ts(export))]
#[derive(Default)]
pub enum ToolAuth {
    #[default]
    None,
    Bearer {
        token: String,
    },
    ApiKey {
        header: String,
        key: String,
    },
    Headers {
        headers: HashMap<String, String>,
    },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
#[cfg_attr(feature = "typescript", derive(TS), ts(export))]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum InstalledToolRuntimeAuth {
    #[default]
    None,
    AuthorizationBearer {
        token: String,
    },
    AuthorizationRaw {
        value: String,
    },
    Header {
        name: String,
        value: String,
    },
    QueryParam {
        name: String,
        value: String,
    },
    Basic {
        username: String,
        password: String,
    },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "typescript", derive(TS), ts(export))]
pub struct InstalledToolRuntimeIntegration {
    pub integration_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub base_url: Option<String>,
    #[serde(default)]
    pub auth: InstalledToolRuntimeAuth,
    #[serde(default)]
    pub provider_config: HashMap<String, serde_json::Value>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "typescript", derive(TS), ts(export))]
pub struct InstalledToolRuntimeProviderExecution {
    pub provider: String,
    pub base_url: String,
    #[serde(default)]
    pub static_headers: HashMap<String, String>,
    #[serde(default)]
    pub integrations: Vec<InstalledToolRuntimeIntegration>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "typescript", derive(TS), ts(export))]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum InstalledToolRuntimeExecution {
    AppProvider(InstalledToolRuntimeProviderExecution),
}

/// Definition for an installed tool, sent over the wire in `session_init`.
///
/// Wire-compatible with `aura_core::InstalledToolDefinition` but
/// self-contained so this crate has no dependency on `aura-core`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "typescript", derive(TS), ts(export))]
pub struct InstalledToolIntegrationRequirement {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub integration_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub provider: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub kind: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "typescript", derive(TS), ts(export))]
pub struct InstalledTool {
    pub name: String,
    pub description: String,
    pub input_schema: serde_json::Value,
    pub endpoint: String,
    #[serde(default)]
    pub auth: ToolAuth,
    #[serde(default)]
    pub timeout_ms: Option<u64>,
    #[serde(default)]
    pub namespace: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub required_integration: Option<InstalledToolIntegrationRequirement>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub runtime_execution: Option<InstalledToolRuntimeExecution>,
    #[serde(default)]
    pub metadata: HashMap<String, serde_json::Value>,
}

/// Definition for an installed integration, sent over the wire in `session_init`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "typescript", derive(TS), ts(export))]
pub struct InstalledIntegration {
    pub integration_id: String,
    pub name: String,
    pub provider: String,
    pub kind: String,
    #[serde(default)]
    pub metadata: HashMap<String, serde_json::Value>,
}

// ============================================================================
// TypeScript export (behind `typescript` feature)
// ============================================================================

#[cfg(all(test, feature = "typescript"))]
mod ts_export {
    use super::*;

    #[test]
    fn export_typescript_bindings() {
        InboundMessage::export_all().unwrap();
        OutboundMessage::export_all().unwrap();
    }
}

#[cfg(test)]
mod capability_wire_tests {
    use super::*;

    #[test]
    fn capability_wire_unknown_variant_round_trips_as_unknown() {
        let json = r#"{"type":"futureCapability"}"#;
        let c: CapabilityWire = serde_json::from_str(json).unwrap();
        assert!(matches!(c, CapabilityWire::Unknown));
    }

    #[test]
    fn capability_wire_known_variants_still_deserialize() {
        let spawn: CapabilityWire =
            serde_json::from_str(r#"{"type":"spawnAgent"}"#).unwrap();
        assert!(matches!(spawn, CapabilityWire::SpawnAgent));
        let read_project: CapabilityWire =
            serde_json::from_str(r#"{"type":"readProject","id":"proj-1"}"#).unwrap();
        assert!(matches!(
            read_project,
            CapabilityWire::ReadProject { ref id } if id == "proj-1"
        ));
    }

    #[test]
    fn agent_permissions_with_unknown_capability_deserializes() {
        // An older server receiving a newer bundle must accept the
        // session rather than fail deserialization.
        let json = r#"{
            "scope": { "orgs": [], "projects": [], "agent_ids": [] },
            "capabilities": [
                {"type": "spawnAgent"},
                {"type": "someFutureCapability", "extra": "ignored"}
            ]
        }"#;
        let perms: AgentPermissionsWire = serde_json::from_str(json).unwrap();
        assert_eq!(perms.capabilities.len(), 2);
        assert!(matches!(perms.capabilities[0], CapabilityWire::SpawnAgent));
        assert!(matches!(perms.capabilities[1], CapabilityWire::Unknown));
    }
}
