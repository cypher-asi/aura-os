//! Chat handler module — converted from the former
//! `apps/aura-os-server/src/handlers/agents/chat.rs` monolith into a
//! collection of focused submodules. Each submodule is responsible for
//! one concern; this `mod.rs` re-exports the public surface that the
//! rest of the server depends on.

mod agent_route;
mod busy;
mod compaction;
mod constants;
mod discovery;
mod errors;
mod event_bus;
mod events;
mod instance_route;
mod loaders;
mod persist;
mod persist_task;
mod persist_task_dispatch;
mod request;
mod setup;
mod streaming;
mod tools;
mod turn_slot;
mod types;

#[cfg(test)]
mod tests;

pub(crate) use agent_route::send_agent_event_stream;
pub(crate) use discovery::{find_matching_project_agents, storage_session_sort_key};
pub(crate) use events::{list_agent_events, list_agent_events_paginated, list_events};
pub(crate) use instance_route::send_event_stream;
pub(crate) use setup::{reset_agent_session, reset_instance_session};

pub use busy::{evaluate_partition_busy, BusyMatch};
pub use compaction::{session_events_to_agent_history, session_events_to_conversation_history};
pub use loaders::{
    load_current_session_events_for_agent, load_current_session_events_for_instance,
};
pub use streaming::harness_broadcast_to_sse;
pub use turn_slot::{
    acquire_turn_slot, TurnSlotAcquired, TurnSlotGuard, TurnSlotQueueFull, MAX_PENDING_TURNS,
};
