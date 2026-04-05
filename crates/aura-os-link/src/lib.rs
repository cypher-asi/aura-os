// ── Harness link (WebSocket-based abstraction) ──────────────────────
mod automaton_client;
mod harness;
mod local_harness;
mod swarm_harness;
mod ws_bridge;

pub use automaton_client::{
    AutomatonClient, AutomatonStartError, AutomatonStartParams, AutomatonStartResult,
};
pub use harness::{HarnessLink, HarnessSession, SessionConfig};
pub use harness::SessionProviderConfig;
pub use local_harness::LocalHarness;
pub use swarm_harness::{CreateAgentResponse, SwarmHarness};

pub use aura_protocol::{
    ApprovalResponse, AssistantMessageEnd, AssistantMessageStart, ConversationMessage, ErrorMsg,
    FileOp, FilesChanged, InboundMessage as HarnessInbound, InstalledTool, MessageAttachment,
    OutboundMessage as HarnessOutbound, SessionInit, SessionReady, SessionUsage, SkillInfo,
    TextDelta, ThinkingDelta, ToolAuth, ToolCallSnapshot, ToolInfo, ToolResultMsg, ToolUseStart,
    UserMessage,
};
