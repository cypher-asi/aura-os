//! Inbound (client → server) wire messages and their payloads.
//!
//! [`InboundMessage`] is the top-level enum sent from a websocket client
//! into the harness. Each variant carries one of the payload structs
//! defined in this module.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fmt;

#[cfg(feature = "typescript")]
use ts_rs::TS;

use crate::common::{ToolApprovalDecision, ToolApprovalRemember};
use crate::installed::{InstalledIntegration, InstalledTool};
use crate::permissions::{AgentPermissionsWire, AgentToolPermissionsWire};

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
    /// Respond to a live tool approval prompt.
    ToolApprovalResponse(ToolApprovalResponse),
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
    /// Template agent id for skill / permissions / billing lookup.
    ///
    /// `agent_id` (above) is the partition key the harness uses for
    /// turn-locking, derived from the AgentInstance via
    /// `aura_os_core::harness_agent_id`. `template_agent_id` is the
    /// stable Aura template id (the row in `agents`) so the harness
    /// can resolve installed skills, agent-level permissions, and
    /// billing aggregation against a single identity per template
    /// even when multiple partitions exist.
    ///
    /// Optional during rollout: when `None`, the harness falls back
    /// to `agent_id` for skill lookup (the pre-Phase-1 behavior).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub template_agent_id: Option<String>,
    /// Originating end-user id for resolving and persisting tool defaults.
    pub user_id: String,
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
    /// Optional per-agent tool override stamped onto this session. `None`
    /// means the harness should load the persisted agent override, if any;
    /// an empty map means "explicitly inherit the user default".
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tool_permissions: Option<AgentToolPermissionsWire>,
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

/// Optional per-session routing override used by Aura proxy runtime resolution.
#[derive(Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "typescript", derive(TS), ts(export))]
pub struct SessionProviderConfig {
    /// Provider identifier for the Aura-managed proxy.
    pub provider: String,
    /// Optional routing mode (`proxy`).
    #[serde(default)]
    pub routing_mode: Option<String>,
    /// Deprecated upstream provider family hint. Aura OS leaves provider
    /// selection to the harness/proxy layer.
    #[serde(default)]
    pub upstream_provider_family: Option<String>,
    /// Deprecated direct-provider API key. Aura OS does not send provider keys.
    #[serde(default)]
    pub api_key: Option<String>,
    /// Deprecated explicit base URL override.
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

/// Payload for `tool_approval_response`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "typescript", derive(TS), ts(export))]
pub struct ToolApprovalResponse {
    pub request_id: String,
    pub decision: ToolApprovalDecision,
    pub remember: ToolApprovalRemember,
}

/// Payload for `generation_request`.
///
/// Fields are mode-dependent:
/// - `mode == "image"`: uses `prompt` (required), `model`, `size`, `images`, `is_iteration`
/// - `mode == "3d"`:    uses `image_url` (required), `prompt` (optional hint)
///
/// Both modes accept `project_id` for artifact storage. 3D generation also
/// accepts `parent_id` to link a generated model to a source image artifact.
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
    pub parent_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub is_iteration: Option<bool>,
}
