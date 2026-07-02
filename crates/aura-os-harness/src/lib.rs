//! Harness-facing adapter crate for aura-os.
//!
//! This crate is the single dependency target for code that talks to
//! aura-harness, including session streams, automaton APIs, and the
//! transaction-oriented node API.

mod automaton_client;
pub mod client;
mod error;
mod event_normalization;
mod harness;
mod harness_url;
mod local_harness;
pub mod runner;
pub mod session;
pub mod signals;
pub mod stability_metrics;
mod swarm_harness;
#[cfg(any(test, feature = "test-support"))]
pub mod test_support;
mod ws_bridge;
mod ws_reader_handle;

/// Re-exports for the harness WebSocket bridge tuning surface so
/// downstream crates (currently `aura-os-server`'s `/api/admin/health`
/// snapshot and the Phase 5 observability wiring) can read the
/// runtime-configured broadcast capacity without duplicating the
/// env-var name. The full module stays private.
pub mod ws_bridge_config {
    pub use crate::ws_bridge::{
        read_broadcast_capacity_from_env, BROADCAST_CAPACITY_ENV, DEFAULT_BROADCAST_CAPACITY,
    };
}

pub use automaton_client::{
    validate_automaton_start_identity, AutomatonStartError, AutomatonStartParams,
};
pub use client::{
    bearer_headers, GetHeadResponse, HarnessAutomatonStartParams, HarnessAutomatonStartResponse,
    HarnessClient, HarnessClientError, HarnessProbeResult, HarnessTxKind, SubmitTxResponse,
};
pub use error::HarnessError;
pub use harness::{
    build_runtime_request, validate_runtime_request_identity, CouncilMemberConfig,
    CouncilPresentation, HarnessCommandSender, HarnessLink, HarnessSession, RunHandle,
    SessionConfig,
};
pub use harness_url::local_harness_base_url;
pub use local_harness::LocalHarness;
pub use runner::automaton_event_kinds;
pub use runner::{
    collect_automaton_events, connect_with_retries, is_git_sync_event,
    is_process_progress_broadcast_event, is_process_stream_forward_event,
    normalize_process_tool_type_field, start_and_connect, submit_automaton_run, CollectedOutput,
    GitSyncMilestone, RunCompletion, RunStartError,
};
pub use session::{SessionBridge, SessionBridgeError, SessionBridgeStarted, SessionBridgeTurn};
pub use signals::{synthesize_failure_reason, FailureContext, HarnessFailureKind, HarnessSignal};
pub use swarm_harness::{CreateAgentResponse, SwarmHarness};
pub use ws_reader_handle::WsReaderHandle;

pub use aura_protocol::{
    ApprovalResponse, AssistantMessageEnd, AssistantMessageStart, ConversationMessage,
    CouncilMechanism, ErrorMsg, FileOp, FilesChanged, InboundMessage as HarnessInbound,
    InstalledIntegration, InstalledTool, InstalledToolIntegrationRequirement,
    InstalledToolRuntimeAuth, InstalledToolRuntimeExecution, InstalledToolRuntimeIntegration,
    InstalledToolRuntimeProviderExecution, MessageAttachment, OutboundMessage as HarnessOutbound,
    RuntimeRequest, RuntimeRequestType, RuntimeRunResponse, SessionModelOverrides, SessionReady,
    SessionUsage, SkillInfo, SubagentSpawned, SubagentStatus, TextDelta, ThinkingDelta, ToolAuth,
    ToolCallSnapshot, ToolInfo, ToolResultMsg, ToolUseStart, UserMessage,
};
