mod error;
mod chat;
mod chat_agent;
mod chat_context;
mod chat_sanitize;
mod chat_streaming;
mod chat_tool_executor;
mod chat_tool_handlers;
pub mod compaction;
pub mod message_metadata;
mod tool_loop_types;
mod tool_loop_helpers;
pub mod tool_loop;

pub use error::ChatError;
pub use chat::{ChatAttachment, ChatService, ChatStreamEvent};
pub use chat_tool_executor::{ChatToolExecutor, ToolExecResult};
pub use message_metadata::{encode_message_content, decode_message_content, DecodedMessage};
pub use tool_loop::{run_tool_loop, ToolCallResult, ToolExecutor, ToolLoopConfig, ToolLoopEvent, ToolLoopResult};
