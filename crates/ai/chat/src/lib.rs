pub(crate) mod channel_ext;
mod chat;
mod chat_agent;
mod chat_context;
mod chat_event_forwarding;
mod chat_message_conversion;
mod chat_persistence;
mod chat_sanitize;
mod chat_spec_handler;
mod chat_streaming;
mod chat_streaming_helpers;
mod chat_tool_executor;
mod chat_tool_handlers;
mod chat_tool_loop_executor;
pub mod compaction;
pub(crate) mod constants;
mod error;
pub mod internal_runtime;
pub mod message_metadata;
pub mod runtime_conversions;
pub mod tool_loop;
mod tool_loop_blocking;
mod tool_loop_budget;
mod tool_loop_helpers;
mod tool_loop_read_guard;
mod tool_loop_streaming;
mod tool_loop_types;

pub use chat::{ChatAttachment, ChatService, ChatServiceDeps, ChatStreamEvent};
pub use chat_streaming::{AgentMessageParams, ChatMessageParams};
pub use chat_tool_executor::{ChatToolExecutor, ToolExecResult};
pub use error::ChatError;
// Deprecated: InternalRuntime is only kept for integration tests that rely on
// MockLlmProvider → MeteredLlm → run_tool_loop(). Production code now uses
// aura_link::LinkRuntime. Will be removed once tests are migrated.
pub use internal_runtime::InternalRuntime;
pub use message_metadata::{decode_message_content, encode_message_content, DecodedMessage};
pub use runtime_conversions::{
    map_runtime_event_to_chat_event, rich_messages_to_link, tool_defs_to_link,
    tool_loop_config_to_turn_config, turn_result_to_tool_loop_result, ChatToolExecutorAdapter,
};
pub use tool_loop::{
    run_tool_loop, AutoBuildResult, BuildBaseline, ToolCallResult, ToolExecutor, ToolLoopConfig,
    ToolLoopEvent, ToolLoopInput, ToolLoopResult,
};
