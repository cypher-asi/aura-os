pub mod agent;
pub mod auth;
pub mod chat;
pub mod chat_tool_executor;
pub mod chat_tools;
pub mod claude;
pub mod error;
pub mod github;
pub mod org;
pub mod project;
pub mod session;
pub mod spec_gen;
pub mod task;
pub mod task_extraction;
pub mod tools;

pub use agent::AgentService;
pub use auth::AuthService;
pub use chat::{ChatService, ChatStreamEvent};
pub use chat_tool_executor::{ChatToolExecutor, ToolExecResult};
pub use claude::{
    ClaudeClient, ClaudeStreamEvent, ContentBlock, MessageContent, RichMessage, ToolCall,
    ToolDefinition, ToolStreamResponse,
};
pub use error::{
    AgentError, AuthError, ChatError, ClaudeClientError, GitHubError, OrgError, ProjectError,
    SessionError, SpecGenError, TaskError,
};
pub use github::GitHubService;
pub use org::OrgService;
pub use project::{CreateProjectInput, ProjectService, UpdateProjectInput};
pub use session::SessionService;
pub use spec_gen::{ProgressTx, SpecGenerationService, SpecStreamEvent};
pub use task::TaskService;
pub use task_extraction::TaskExtractionService;
pub use tools::{core_tool_definitions, chat_tool_definitions, engine_tool_definitions};
