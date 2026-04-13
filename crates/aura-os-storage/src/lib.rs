pub mod client;
mod conversions;
pub mod error;
pub mod types;

#[cfg(any(test, feature = "test-utils"))]
pub mod testutil;

pub use client::StorageClient;
pub use error::StorageError;
pub use types::{
    CreateLogEntryRequest,
    // Process types
    CreateProcessArtifactRequest,
    CreateProcessConnectionRequest,
    CreateProcessEventRequest,
    CreateProcessFolderRequest,
    CreateProcessNodeRequest,
    CreateProcessRequest,
    CreateProcessRunRequest,
    CreateProjectAgentRequest,
    CreateSessionEventRequest,
    CreateSessionRequest,
    CreateSpecRequest,
    CreateTaskRequest,
    ProjectStats,
    StorageLogEntry,
    StorageProcess,
    StorageProcessArtifact,
    StorageProcessEvent,
    StorageProcessFolder,
    StorageProcessNode,
    StorageProcessNodeConnection,
    StorageProcessRun,
    StorageProjectAgent,
    StorageSession,
    StorageSessionEvent,
    StorageSpec,
    StorageTask,
    StorageTaskFileChangeSummary,
    TransitionTaskRequest,
    UpdateProcessEventRequest,
    UpdateProcessFolderRequest,
    UpdateProcessNodeRequest,
    UpdateProcessRequest,
    UpdateProcessRunRequest,
    UpdateProjectAgentRequest,
    UpdateSessionRequest,
    UpdateTaskRequest,
};
