pub mod agent;
pub mod claude;
pub mod error;
pub mod project;
pub mod session;
pub mod spec_gen;
pub mod task;
pub mod task_extraction;

pub use agent::AgentService;
pub use claude::{ClaudeClient, ClaudeStreamEvent};
pub use error::{
    AgentError, ClaudeClientError, ProjectError, SessionError, SpecGenError, TaskError,
};
pub use project::{CreateProjectInput, ProjectService, UpdateProjectInput};
pub use session::SessionService;
pub use spec_gen::{ProgressTx, SpecGenerationService, SpecStreamEvent};
pub use task::TaskService;
pub use task_extraction::TaskExtractionService;
