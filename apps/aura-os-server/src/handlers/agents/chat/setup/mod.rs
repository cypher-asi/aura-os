//! Chat-session setup, live-session registry helpers, and the
//! `/reset` and `/cancel-turn` endpoints for both agent-scoped and
//! instance-scoped chats. Public surface is re-exported through this
//! `mod.rs`; implementation is split across focused submodules so each
//! file stays below the 500-line cap.

mod cancel;
mod persistence;
mod registry;
mod reset;

pub(crate) use cancel::{cancel_agent_turn, cancel_instance_turn};
pub(crate) use persistence::{
    setup_agent_chat_persistence, setup_agent_chat_persistence_with_matched,
    setup_project_chat_persistence,
};
pub(crate) use reset::{reset_agent_session, reset_instance_session};

pub(super) use persistence::lazy_repair_home_project_binding;
pub(super) use registry::has_live_session;
