#![warn(missing_docs)]

pub mod config;
pub mod entities;
pub mod enums;
pub mod helpers;
pub mod ids;
pub mod prompts;
pub mod rust_signatures;
pub mod settings;

#[cfg(any(test, feature = "test-utils"))]
pub mod testutil;

pub use config::{EngineConfig, LlmConfig};
// TODO: replace with explicit re-exports
pub use entities::*;
pub use enums::{AgentStatus, ChatRole, OrgRole, ProjectStatus, SessionStatus, TaskStatus};
pub use helpers::{extract_fenced_json, fuzzy_search_replace, parse_dt};
pub use ids::{
    AgentId, AgentInstanceId, MessageId, OrgId, ProfileId, ProjectId, SessionId, SpecId, TaskId,
    UserId,
};
pub use prompts::{
    CHAT_SYSTEM_PROMPT_BASE, CONTEXT_SUMMARY_SYSTEM_PROMPT, RETRY_CORRECTION_PROMPT,
    SESSION_SUMMARY_SYSTEM_PROMPT, SPEC_GENERATION_SYSTEM_PROMPT, SPEC_OVERVIEW_SYSTEM_PROMPT,
    SPEC_SUMMARY_SYSTEM_PROMPT, TASK_EXTRACTION_SYSTEM_PROMPT, TITLE_GEN_SYSTEM_PROMPT,
};
pub use settings::{SettingsEntry, SettingsValue};
