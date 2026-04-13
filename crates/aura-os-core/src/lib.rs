pub mod entities;
pub mod enums;
pub mod helpers;
pub mod ids;
pub mod rust_signatures;
pub mod settings;

#[cfg(any(test, feature = "test-utils"))]
pub mod testutil;

/// Provides access to the current user's JWT for authenticating against
/// remote services (aura-storage, aura-network, etc.).
pub trait JwtProvider: Send + Sync {
    fn get_jwt(&self) -> Option<String>;
}

// TODO: replace with explicit re-exports
pub use entities::*;
pub use enums::{
    AgentStatus, ArtifactType, ChatRole, HarnessMode, OrchestrationStatus, OrgRole,
    ProcessEventStatus, ProcessNodeType, ProcessRunStatus, ProcessRunTrigger, ProjectStatus,
    SessionStatus, StepStatus, TaskStatus, ToolDomain,
};
pub use helpers::{extract_fenced_json, fuzzy_search_replace, parse_dt};
pub use ids::{
    AgentId, AgentInstanceId, OrgId, ProcessArtifactId, ProcessEventId, ProcessFolderId, ProcessId,
    ProcessNodeConnectionId, ProcessNodeId, ProcessRunId, ProfileId, ProjectId, SessionEventId,
    SessionId, SpecId, TaskId, UserId,
};
pub use settings::{SettingsEntry, SettingsValue};
