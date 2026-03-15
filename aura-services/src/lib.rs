// Thin re-export layer: all actual implementations live in individual crates.
// This crate exists for backward compatibility during migration.

pub mod claude {
    pub use aura_claude::*;
}
pub mod pricing {
    pub use aura_billing::pricing::*;
}
pub mod tools {
    pub use aura_tools::*;
}
pub mod chat_tools {
    pub use aura_tools::agent_tool_definitions;
}
pub mod org {
    pub use aura_orgs::*;
}
pub mod project {
    pub use aura_projects::*;
}
pub mod agent {
    pub use aura_agents::*;
}
pub mod auth {
    pub use aura_auth::*;
}
pub mod github {
    pub use aura_github::*;
}
pub mod task {
    pub use aura_tasks::*;
}
pub mod session {
    pub use aura_sessions::*;
}
pub mod spec_gen {
    pub use aura_specs::*;
}
pub mod chat {
    pub use aura_chat::ChatService;
    pub use aura_chat::ChatStreamEvent;
}
pub mod chat_tool_executor {
    pub use aura_chat::ChatToolExecutor;
    pub use aura_chat::ToolExecResult;
}
pub mod error {
    pub use aura_claude::ClaudeClientError;
    pub use aura_orgs::OrgError;
    pub use aura_projects::ProjectError;
    pub use aura_agents::AgentError;
    pub use aura_auth::AuthError;
    pub use aura_github::GitHubError;
    pub use aura_tasks::TaskError;
    pub use aura_sessions::SessionError;
    pub use aura_specs::SpecGenError;
    pub use aura_chat::ChatError;
}

// Top-level re-exports for backward compatibility
pub use aura_agents::{AgentService, AgentInstanceService};
pub use aura_auth::AuthService;
pub use aura_chat::{ChatService, ChatStreamEvent, ChatToolExecutor, ToolExecResult};
pub use aura_claude::{
    ClaudeClient, ClaudeStreamEvent, ContentBlock, MessageContent, RichMessage, ThinkingConfig,
    ToolCall, ToolDefinition, ToolStreamResponse, estimate_tokens, estimate_message_tokens,
};
pub use aura_github::GitHubService;
pub use aura_orgs::OrgService;
pub use aura_billing::PricingService;
pub use aura_projects::{CreateProjectInput, ProjectService, UpdateProjectInput};
pub use aura_sessions::SessionService;
pub use aura_specs::{ProgressTx, SpecGenerationService, SpecStreamEvent};
pub use aura_tasks::{TaskExtractionService, TaskService};
pub use aura_tools::{core_tool_definitions, chat_tool_definitions, engine_tool_definitions};

pub use error::{
    AgentError, AuthError, ChatError, ClaudeClientError, GitHubError, OrgError, ProjectError,
    SessionError, SpecGenError, TaskError,
};
