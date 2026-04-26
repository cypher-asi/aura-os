//! Harness-facing adapter crate for aura-os.
//!
//! This crate is the single dependency target for code that talks to
//! aura-harness, including session streams, automaton APIs, and the
//! transaction-oriented node API.

mod automaton_client;
pub mod client;
mod error;
mod harness;
mod harness_url;
mod local_harness;
pub mod runner;
pub mod session;
pub mod signals;
mod swarm_harness;
#[cfg(any(test, feature = "test-support"))]
pub mod test_support;
mod ws_bridge;

pub use automaton_client::{
    AutomatonClient, AutomatonStartError, AutomatonStartParams, AutomatonStartResult,
    WsReaderHandle,
};
pub use client::{
    bearer_headers, GetHeadResponse, HarnessAutomatonStartParams, HarnessAutomatonStartResponse,
    HarnessClient, HarnessClientError, HarnessProbeResult, HarnessTxKind, SubmitTxResponse,
};
pub use error::HarnessError;
pub use harness::{
    build_remote_handshake, build_session_init, HarnessCommandSender, HarnessLink, HarnessSession,
    SessionConfig,
};
pub use harness_url::local_harness_base_url;
pub use local_harness::LocalHarness;
pub use runner::automaton_event_kinds;
pub use runner::{
    collect_automaton_events, connect_with_retries, is_git_sync_event,
    is_process_progress_broadcast_event, is_process_stream_forward_event,
    normalize_process_tool_type_field, start_and_connect, CollectedOutput, GitSyncMilestone,
    RunCompletion, RunStartError,
};
pub use session::{SessionBridge, SessionBridgeError, SessionBridgeStarted, SessionBridgeTurn};
pub use signals::{HarnessFailureKind, HarnessSignal};
pub use swarm_harness::{CreateAgentResponse, SwarmHarness};

pub use aura_protocol::{
    ApprovalResponse, AssistantMessageEnd, AssistantMessageStart, ConversationMessage, ErrorMsg,
    FileOp, FilesChanged, InboundMessage as HarnessInbound, InstalledIntegration, InstalledTool,
    InstalledToolIntegrationRequirement, InstalledToolRuntimeAuth, InstalledToolRuntimeExecution,
    InstalledToolRuntimeIntegration, InstalledToolRuntimeProviderExecution, MessageAttachment,
    OutboundMessage as HarnessOutbound, SessionInit, SessionProviderConfig, SessionReady,
    SessionUsage, SkillInfo, TextDelta, ThinkingDelta, ToolAuth, ToolCallSnapshot, ToolInfo,
    ToolResultMsg, ToolUseStart, UserMessage,
};
