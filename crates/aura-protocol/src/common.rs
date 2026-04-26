//! Wire types shared across both directions of the harness WebSocket.
//!
//! These small enums and structs appear on both inbound (client → server)
//! and outbound (server → client) payloads. Keeping them in one module
//! avoids cross-direction imports and keeps the per-direction modules
//! focused on their own envelope shapes.

use serde::{Deserialize, Serialize};

#[cfg(feature = "typescript")]
use ts_rs::TS;

/// Wire-compatible tri-state tool permission value.
///
/// Used by [`crate::AgentToolPermissionsWire`] (inbound) and
/// [`crate::ToolInfo`] (outbound) so the harness and clients can agree on
/// the effective state of a tool for a session.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "typescript", derive(TS), ts(export))]
pub enum ToolStateWire {
    #[serde(rename = "on")]
    On,
    #[serde(rename = "off")]
    Off,
    #[serde(rename = "ask")]
    Ask,
}

/// User decision for a live tool approval prompt.
///
/// Sent inbound on [`crate::ToolApprovalResponse`].
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "typescript", derive(TS), ts(export))]
pub enum ToolApprovalDecision {
    #[serde(rename = "on")]
    On,
    #[serde(rename = "off")]
    Off,
}

/// Scope for remembering a live tool approval decision.
///
/// Used inbound on [`crate::ToolApprovalResponse`] and offered
/// outbound by the harness on [`crate::ToolApprovalPrompt::remember_options`].
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "typescript", derive(TS), ts(export))]
#[serde(rename_all = "snake_case")]
pub enum ToolApprovalRemember {
    Once,
    Session,
    Forever,
}
