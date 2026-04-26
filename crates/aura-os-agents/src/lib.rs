//! Aura OS agents.
//!
//! This crate exposes two cooperating services that together back the
//! agent endpoints in `aura-os-server`:
//!
//! * [`AgentService`] - user-level agent templates. Authoritative
//!   source is aura-network when available; a local shadow under the
//!   `"agent:"` key prefix keeps reads working when the network is
//!   unreachable.
//! * [`AgentInstanceService`] - project-level agent instances backed
//!   by aura-storage. Merges three data sources (storage execution
//!   state, network agent template, in-memory runtime state) into a
//!   single [`aura_os_core::AgentInstance`].
//!
//! [`merge_agent_instance`] and [`parse_agent_status`] are the
//! conversion helpers consumers use directly when they already have
//! the constituent rows in hand and want to skip the service layer.

mod convert;
mod errors;
mod instance;
mod merge;
mod service;

use std::collections::HashMap;
use std::sync::Arc;

use aura_os_core::{AgentInstanceId, RuntimeAgentState};
use tokio::sync::Mutex;

pub use convert::parse_agent_status;
pub use errors::AgentError;
pub use instance::AgentInstanceService;
pub use merge::merge_agent_instance;
pub use service::AgentService;

/// Shared mutable map of volatile agent-instance runtime state
/// (current task / session). Owned by `app_builder` and threaded
/// through both [`AgentInstanceService`] and the chat handlers.
pub type RuntimeAgentStateMap = Arc<Mutex<HashMap<AgentInstanceId, RuntimeAgentState>>>;
