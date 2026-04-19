//! Concrete [`AgentTool`](aura_os_agent_runtime::tools::AgentTool)
//! implementations, split out of `aura-os-agent-runtime` in Tier D so
//! the runtime crate no longer pulls in the domain dependency graph
//! (projects, tasks, sessions, orgs, billing, process, etc.) that
//! these tools require.
//!
//! The registry builders (`build_tier1_registry`, `build_all_tools_registry`,
//! `register_process_tools`) live in `crate`; the individual impls live
//! here, one file per functional domain.

pub mod agent_tools;
pub mod billing_tools;
pub mod exec_tools;
pub mod generation_tools;
pub mod helpers;
pub mod monitor_tools;
pub mod org_tools;
pub mod process_tools;
pub mod project_tools;
pub mod social_tools;
pub mod spec_tools;
pub mod system_tools;
pub mod task_tools;
#[cfg(test)]
mod tests;

pub use aura_os_agent_runtime::tools::{
    AgentTool, AgentToolContext, CapabilityRequirement, ToolRegistry, ToolResult,
};
