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
pub use runner::{
    collect_automaton_events, connect_with_retries, start_and_connect, CollectedOutput,
    RunCompletion, RunStartError,
};
pub use swarm_harness::{CreateAgentResponse, SwarmHarness};

pub use aura_protocol::{
    ApprovalResponse, AssistantMessageEnd, AssistantMessageStart, ConversationMessage, ErrorMsg,
    FileOp, FilesChanged, InboundMessage as HarnessInbound, InstalledTool, MessageAttachment,
    OutboundMessage as HarnessOutbound, SessionInit, SessionProviderConfig, SessionReady,
    SessionUsage, SkillInfo, TextDelta, ThinkingDelta, ToolAuth, ToolCallSnapshot, ToolInfo,
    ToolResultMsg, ToolUseStart, UserMessage,
};
