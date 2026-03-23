#![warn(missing_docs)]

pub mod entities;
pub mod enums;
pub mod helpers;
pub mod ids;
pub mod rust_signatures;
pub mod settings;

#[cfg(any(test, feature = "test-utils"))]
pub mod testutil;

// TODO: replace with explicit re-exports
pub use entities::*;
pub use enums::{AgentStatus, ChatRole, OrgRole, ProjectStatus, SessionStatus, TaskStatus};
pub use helpers::{extract_fenced_json, fuzzy_search_replace, parse_dt};
pub use ids::{
    AgentId, AgentInstanceId, MessageId, OrgId, ProfileId, ProjectId, SessionId, SpecId, TaskId,
    UserId,
};
pub use settings::{SettingsEntry, SettingsValue};
