//! HTTP + WebSocket client for the harness automaton REST API.
//!
//! Provides typed methods for starting, stopping, pausing automatons and
//! subscribing to their event streams -- used by `dev_loop.rs` instead of the
//! old chat-session-based approach.

mod client;
mod event_normalization;
mod identity;
mod start_params;
mod ws_reader;
mod ws_reader_handle;

#[cfg(test)]
mod tests;

pub use client::AutomatonClient;
pub use identity::validate_automaton_start_identity;
pub use start_params::{AutomatonStartError, AutomatonStartParams, AutomatonStartResult};
pub use ws_reader_handle::WsReaderHandle;

// Brought into the `automaton_client` namespace so the `tests` submodule
// can reach `normalize_automaton_event` through `super::normalize_automaton_event`
// without exposing it as part of the crate's public API.
#[cfg(test)]
use event_normalization::normalize_automaton_event;
