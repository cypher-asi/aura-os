pub mod client;
mod conversions;
pub mod error;
pub mod types;

#[cfg(any(test, feature = "test-utils"))]
pub mod testutil;

pub use client::StorageClient;
pub use error::StorageError;
pub use types::{
    CreateLogEntryRequest, CreateProjectAgentRequest, CreateSessionEventRequest,
    CreateSessionRequest, CreateSpecRequest, CreateTaskRequest, ProjectStats, StorageLogEntry,
    StorageProjectAgent, StorageSession, StorageSessionEvent, StorageSpec, StorageTask,
    StorageTaskFileChangeSummary, TransitionTaskRequest, UpdateProjectAgentRequest,
    UpdateSessionRequest, UpdateTaskRequest,
    // Process types
    CreateProcessArtifactRequest, CreateProcessConnectionRequest, CreateProcessEventRequest,
    CreateProcessFolderRequest, CreateProcessNodeRequest, CreateProcessRequest,
    CreateProcessRunRequest, StorageProcess, StorageProcessArtifact, StorageProcessEvent,
    StorageProcessFolder, StorageProcessNode, StorageProcessNodeConnection, StorageProcessRun,
    UpdateProcessEventRequest, UpdateProcessFolderRequest, UpdateProcessNodeRequest,
    UpdateProcessRequest, UpdateProcessRunRequest,
};
