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
    CreateNoteCommentRequest,
    CreateNoteFolderRequest,
    CreateNoteRequest,
    // Process types
    CreateProcessArtifactRequest,
    CreateProcessConnectionRequest,
    CreateProcessEventRequest,
    CreateProcessFolderRequest,
    CreateProcessNodeRequest,
    CreateProcessRequest,
    CreateProcessRunRequest,
    CreateProjectAgentRequest,
    // Project artifact types
    CreateProjectArtifactRequest,
    CreateSessionEventRequest,
    CreateSessionRequest,
    CreateSpecRequest,
    CreateStorageSkillRequest,
    CreateTaskRequest,
    ProjectStats,
    StorageAgentSkillAssignment,
    StorageEnrichedSession,
    StorageLogEntry,
    StorageNote,
    StorageNoteComment,
    StorageNoteFolder,
    StorageProcess,
    StorageProcessArtifact,
    StorageProcessEvent,
    StorageProcessFolder,
    StorageProcessNode,
    StorageProcessNodeConnection,
    StorageProcessRun,
    StorageProjectAgent,
    StorageProjectArtifact,
    StorageSession,
    StorageSessionEvent,
    StorageSkill,
    StorageSpec,
    StorageTask,
    StorageTaskFileChangeSummary,
    TransitionNoteRequest,
    TransitionTaskRequest,
    UpdateNoteFolderRequest,
    UpdateNoteRequest,
    UpdateProcessEventRequest,
    UpdateProcessFolderRequest,
    UpdateProcessNodeRequest,
    UpdateProcessRequest,
    UpdateProcessRunRequest,
    UpdateProjectAgentRequest,
    UpdateSessionRequest,
    UpdateStorageSkillRequest,
    UpdateTaskRequest,
    SESSION_STATUS_ARCHIVED,
    SESSION_STATUS_DELETED,
};
