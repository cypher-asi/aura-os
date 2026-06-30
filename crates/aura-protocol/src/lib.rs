//! Shared wire protocol types for the Aura harness HTTP + WebSocket API.
//!
//! Defines the canonical request shape ([`RuntimeRequest`]) for the
//! `POST /v1/run` endpoint plus the inbound (client → server) and
//! outbound (server → client) message format for the per-run
//! `WS /stream/:run_id` WebSocket endpoint.
//!
//! This crate is the aura-os mirror of `aura_harness::aura_protocol`.
//! Both repos must stay in lockstep on the wire shape — Phase A of
//! the cross-repo refactor lands `RuntimeRequest` in both at once.
//!
//! # Module layout
//!
//! - [`runtime_request`]: canonical `POST /v1/run` body.
//! - [`agent_identity`]: [`AgentPersona`] persona bundle nested
//!   inside [`runtime_request::AgentIdentity`].
//! - [`client`]: inbound (client → server) WS envelope and payloads.
//! - [`server`]: outbound (server → client) WS envelope and payloads.
//! - [`common`]: small enums shared across both directions.
//! - [`permissions`]: wire-compatible mirrors of the harness
//!   agent-permission model.
//! - [`installed`]: installed-tool / installed-integration
//!   definitions.
//!
//! # Agent permissions model
//!
//! [`RuntimeRequest::agent_permissions`] is **required** on every
//! run. The harness enforces these permissions unconditionally —
//! there is no role-based fallback, no named preset, and no legacy
//! "no-permissions" default. Every caller submitting a run must
//! send an explicit [`AgentPermissionsWire`] value describing the
//! scope + capability bundle the run is allowed to exercise.

pub mod agent_identity;
pub mod automaton;
pub mod chat_project_info;
pub mod client;
pub mod common;
pub mod context;
pub mod installed;
pub mod permissions;
pub mod runtime_request;
pub mod server;

pub use agent_identity::AgentPersona;
pub use automaton::AutomatonEvent;
pub use chat_project_info::ChatProjectInfoWire;
pub use client::{
    ApprovalResponse, ConversationMessage, GenerationRequest, InboundMessage, IntentClassifierRule,
    IntentClassifierSpec, MessageAttachment, SessionModelOverrides, ToolApprovalResponse,
    UserMessage,
};
pub use common::{ToolApprovalDecision, ToolApprovalRemember, ToolStateWire};
pub use context::{ContextBreakdown, ContextContents, ContextSegment};
pub use installed::{
    InstalledIntegration, InstalledTool, InstalledToolIntegrationRequirement,
    InstalledToolRuntimeAuth, InstalledToolRuntimeExecution, InstalledToolRuntimeIntegration,
    InstalledToolRuntimeProviderExecution, ToolAuth,
};
pub use permissions::{
    AgentPermissionsWire, AgentScopeWire, AgentToolPermissionsWire, CapabilityWire,
};
pub use runtime_request::{
    AgentCapabilities, AgentIdentity, CouncilMechanism, CouncilMember, CouncilMemberRole,
    ModelSelection, ProjectContext, ReasoningEffort, RuntimeRequest, RuntimeRequestType,
    RuntimeRunResponse, WorkspaceLocation,
};
pub use server::{
    AssistantMessageEnd, AssistantMessageStart, ErrorMsg, FileDiff, FileOp, FilesChanged,
    GenerationCompleted, GenerationErrorMsg, GenerationPartialImage, GenerationProgressMsg,
    GenerationStart, OutboundMessage, ProgressMsg, SessionReady, SessionUsage, SkillInfo,
    SubagentSpawned, SubagentStatus, TextDelta, ThinkingDelta, ToolApprovalPrompt,
    ToolCallSnapshot, ToolInfo, ToolResultMsg, ToolUseStart,
};

#[cfg(all(test, feature = "typescript"))]
mod ts_export {
    use super::{InboundMessage, OutboundMessage, RuntimeRequest, RuntimeRunResponse};
    use ts_rs::TS;

    #[test]
    fn export_typescript_bindings() {
        InboundMessage::export_all().unwrap();
        OutboundMessage::export_all().unwrap();
        RuntimeRequest::export_all().unwrap();
        RuntimeRunResponse::export_all().unwrap();
    }
}
