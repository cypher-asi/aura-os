//! Shared wire protocol types for the Aura harness WebSocket API.
//!
//! Defines the inbound (client → server) and outbound (server → client)
//! message format for the `/stream` WebSocket endpoint.
//!
//! This crate is consumed by both the harness server (`aura-node`) and
//! any client implementation (e.g. `aura-os-harness`).
//!
//! # Module layout
//!
//! - [`client`]: inbound (client → server) envelope and payloads.
//! - [`server`]: outbound (server → client) envelope and payloads.
//! - [`common`]: small enums shared across both directions.
//! - [`permissions`]: wire-compatible mirrors of the harness agent-permission model.
//! - [`installed`]: installed-tool / installed-integration definitions.
//!
//! Every public type is re-exported at the crate root so existing call
//! sites (`aura_protocol::SessionInit`, etc.) continue to resolve.
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

pub mod client;
pub mod common;
pub mod installed;
pub mod permissions;
pub mod server;

pub use client::{
    ApprovalResponse, ConversationMessage, GenerationRequest, InboundMessage, IntentClassifierRule,
    IntentClassifierSpec, MessageAttachment, SessionInit, SessionProviderConfig,
    ToolApprovalResponse, UserMessage,
};
pub use common::{ToolApprovalDecision, ToolApprovalRemember, ToolStateWire};
pub use installed::{
    InstalledIntegration, InstalledTool, InstalledToolIntegrationRequirement,
    InstalledToolRuntimeAuth, InstalledToolRuntimeExecution, InstalledToolRuntimeIntegration,
    InstalledToolRuntimeProviderExecution, ToolAuth,
};
pub use permissions::{
    AgentPermissionsWire, AgentScopeWire, AgentToolPermissionsWire, CapabilityWire,
};
pub use server::{
    AssistantMessageEnd, AssistantMessageStart, ErrorMsg, FileDiff, FileOp, FilesChanged,
    GenerationCompleted, GenerationErrorMsg, GenerationPartialImage, GenerationProgressMsg,
    GenerationStart, OutboundMessage, SessionReady, SessionUsage, SkillInfo, TextDelta,
    ThinkingDelta, ToolApprovalPrompt, ToolCallSnapshot, ToolInfo, ToolResultMsg, ToolUseStart,
};

#[cfg(all(test, feature = "typescript"))]
mod ts_export {
    use super::{InboundMessage, OutboundMessage};
    use ts_rs::TS;

    #[test]
    fn export_typescript_bindings() {
        InboundMessage::export_all().unwrap();
        OutboundMessage::export_all().unwrap();
    }
}
