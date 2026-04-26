//! Wire-compatible types exchanged with aura-storage's HTTP API.
//!
//! Each submodule covers one entity family (process, project agent, spec,
//! task, session, log, session event, project artifact, project stats).
//! `lib.rs` re-exports everything from this module so external callers can
//! continue to use `aura_os_storage::Foo` (and `aura_os_storage::types::Foo`)
//! unchanged.

pub mod log_entry;
pub mod process;
pub mod project_agent;
pub mod project_artifact;
pub mod project_stats;
pub mod session;
pub mod session_event;
pub mod spec;
pub mod task;

pub use log_entry::{CreateLogEntryRequest, StorageLogEntry};
pub use process::{
    CreateProcessArtifactRequest, CreateProcessConnectionRequest, CreateProcessEventRequest,
    CreateProcessFolderRequest, CreateProcessNodeRequest, CreateProcessRequest,
    CreateProcessRunRequest, StorageProcess, StorageProcessArtifact, StorageProcessEvent,
    StorageProcessFolder, StorageProcessNode, StorageProcessNodeConnection, StorageProcessRun,
    UpdateProcessEventRequest, UpdateProcessFolderRequest, UpdateProcessNodeRequest,
    UpdateProcessRequest, UpdateProcessRunRequest,
};
pub use project_agent::{
    CreateProjectAgentRequest, StorageProjectAgent, UpdateProjectAgentRequest,
};
pub use project_artifact::{CreateProjectArtifactRequest, StorageProjectArtifact};
pub use project_stats::ProjectStats;
pub use session::{CreateSessionRequest, StorageSession, UpdateSessionRequest};
pub use session_event::{CreateSessionEventRequest, StorageSessionEvent};
pub use spec::{CreateSpecRequest, StorageSpec, UpdateSpecRequest};
pub use task::{
    CreateTaskRequest, StorageTask, StorageTaskFileChangeSummary, TransitionTaskRequest,
    UpdateTaskRequest,
};
