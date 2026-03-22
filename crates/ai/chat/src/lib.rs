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
pub mod message_metadata;
pub mod runtime_conversions;

pub use chat::{ChatAttachment, ChatService, ChatServiceDeps, ChatStreamEvent};
pub use chat_streaming::{AgentMessageParams, ChatMessageParams};
pub use chat_tool_executor::{ChatToolExecutor, ToolExecResult};
pub use error::ChatError;
pub use message_metadata::{decode_message_content, encode_message_content, DecodedMessage};
pub use runtime_conversions::{
    map_runtime_event_to_chat_event, rich_messages_to_link, tool_defs_to_link,
};
