// ── Harness link (WebSocket-based abstraction) ──────────────────────
mod automaton_client;
mod harness;
mod harness_url;
mod local_harness;
pub mod runner;
mod swarm_harness;
mod ws_bridge;

pub use automaton_client::{
    AutomatonClient, AutomatonStartError, AutomatonStartParams, AutomatonStartResult,
};
pub use harness::{HarnessLink, HarnessSession, SessionConfig};
pub use harness_url::local_harness_base_url;
pub use local_harness::LocalHarness;
pub use runner::automaton_event_kinds;
pub use runner::{
    collect_automaton_events, connect_with_retries, is_process_progress_broadcast_event,
    is_process_stream_forward_event, normalize_process_tool_type_field, start_and_connect,
    CollectedOutput, RunCompletion, RunStartError,
};
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
