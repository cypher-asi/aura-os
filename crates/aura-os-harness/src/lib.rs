//! Harness-facing adapter crate for aura-os.
//!
//! This crate is the single dependency target for code that talks to
//! aura-harness. During the migration it re-exports the existing link-layer
//! types while adding the transaction-oriented [`HarnessClient`] used by the
//! new node API.

pub mod client;
pub mod session;
pub mod signals;

pub use aura_os_link::{
    automaton_event_kinds, build_remote_handshake, build_session_init, collect_automaton_events,
    connect_with_retries, is_git_sync_event, is_process_progress_broadcast_event,
    is_process_stream_forward_event, local_harness_base_url, normalize_process_tool_type_field,
    start_and_connect, ApprovalResponse, AssistantMessageEnd, AssistantMessageStart,
    AutomatonClient, AutomatonStartError, AutomatonStartParams, AutomatonStartResult,
    CollectedOutput, ConversationMessage, CreateAgentResponse, ErrorMsg, FileOp, FilesChanged,
    GitSyncMilestone, HarnessInbound, HarnessLink, HarnessOutbound, HarnessSession,
    InstalledIntegration, InstalledTool, InstalledToolIntegrationRequirement,
    InstalledToolRuntimeAuth, InstalledToolRuntimeExecution, InstalledToolRuntimeIntegration,
    InstalledToolRuntimeProviderExecution, LocalHarness, MessageAttachment, RunCompletion,
    RunStartError, SessionConfig, SessionProviderConfig, SessionReady, SessionUsage, SkillInfo,
    SwarmHarness, TextDelta, ThinkingDelta, ToolAuth, ToolCallSnapshot, ToolInfo, ToolResultMsg,
    ToolUseStart, UserMessage, WsReaderHandle,
};

pub use client::{
    bearer_headers, GetHeadResponse, HarnessAutomatonStartParams, HarnessAutomatonStartResponse,
    HarnessClient, HarnessClientError, HarnessProbeResult, HarnessTxKind, SubmitTxResponse,
};
pub use session::{SessionBridge, SessionBridgeError, SessionBridgeStarted, SessionBridgeTurn};
pub use signals::{HarnessFailureKind, HarnessSignal};
