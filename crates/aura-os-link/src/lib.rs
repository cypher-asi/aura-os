// ── Harness link (WebSocket-based abstraction) ──────────────────────
mod harness;
mod ws_bridge;
mod swarm_harness;
mod local_harness;
mod automaton_client;

pub use harness::{HarnessLink, HarnessSession, SessionConfig};
pub use swarm_harness::SwarmHarness;
pub use local_harness::LocalHarness;
pub use automaton_client::{AutomatonClient, AutomatonStartParams, AutomatonStartResult};

pub use aura_protocol::{
    InboundMessage as HarnessInbound,
    OutboundMessage as HarnessOutbound,
    UserMessage, SessionInit, ApprovalResponse, ConversationMessage,
    SessionReady, AssistantMessageStart, TextDelta, ThinkingDelta,
    ToolUseStart, ToolResultMsg, AssistantMessageEnd, ErrorMsg,
    SessionUsage, FilesChanged, FileOp, ToolInfo,
};
