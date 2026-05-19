//! Chat handler module — converted from the former
//! `apps/aura-os-server/src/handlers/agents/chat.rs` monolith into a
//! collection of focused submodules. Each submodule is responsible for
//! one concern; this `mod.rs` re-exports the public surface that the
//! rest of the server depends on.

mod agent_route;
mod busy;
mod compaction;
mod constants;
mod cross_agent_reply;
mod dev_loop_persist;
mod discovery;
pub(crate) mod errors;
mod event_bus;
mod events;
mod identity_preamble;
mod instance_route;
mod loaders;
mod persist;
mod persist_task;
mod persist_task_dispatch;
mod request;
mod setup;
mod streaming;
mod tools;
pub(crate) mod turn_slot;
mod types;

#[cfg(test)]
mod tests;

pub(crate) use agent_route::send_agent_event_stream;
pub(crate) use dev_loop_persist::spawn_dev_loop_persist_task;
pub(crate) use discovery::{find_matching_project_agents, storage_session_sort_key};
pub(crate) use event_bus::{publish_assistant_message_end_event, publish_user_message_event};
pub(crate) use events::{
    list_agent_events, list_agent_events_paginated, list_agent_session_events, list_events,
};
pub(crate) use instance_route::{build_project_system_prompt, send_event_stream};
#[cfg(test)]
pub(crate) use instance_route::{render_project_context, render_project_context_fallback};
pub(crate) use persist::{persist_user_message, ChatPersistCtx, ChatPersistRequest};
pub(crate) use persist_task::persist_event;
pub(crate) use setup::{
    cancel_agent_turn, cancel_instance_turn, reset_agent_session, reset_instance_session,
    setup_agent_chat_persistence, setup_project_chat_persistence,
};

pub use busy::{evaluate_partition_busy, BusyMatch, BusyScope};
pub use compaction::{session_events_to_agent_history, session_events_to_conversation_history};
pub use loaders::{
    load_current_session_events_for_agent, load_current_session_events_for_instance,
};
pub use streaming::harness_broadcast_to_sse;
pub use turn_slot::{
    acquire_turn_slot, max_pending_turns, TurnSlotAcquired, TurnSlotGuard, TurnSlotQueueFull,
    DEFAULT_MAX_PENDING_TURNS,
};
