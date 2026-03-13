pub mod agent;
pub mod auth;
pub mod chat;
pub mod claude;
pub mod error;
pub mod org;
pub mod project;
pub mod session;
pub mod spec_gen;
pub mod task;
pub mod task_extraction;

pub use agent::AgentService;
pub use auth::AuthService;
pub use chat::{ChatService, ChatStreamEvent};
pub use claude::ClaudeClient;
pub use error::{
    AgentError, AuthError, ChatError, ClaudeClientError, OrgError, ProjectError, SessionError,
    SpecGenError, TaskError,
};
pub use org::OrgService;
pub use project::{CreateProjectInput, ProjectService, UpdateProjectInput};
pub use session::SessionService;
pub use spec_gen::{ProgressTx, SpecGenerationService, SpecStreamEvent};
pub use task::TaskService;
pub use task_extraction::TaskExtractionService;
