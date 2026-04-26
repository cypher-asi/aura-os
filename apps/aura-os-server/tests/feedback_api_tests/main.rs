//! Integration tests for the Aura OS feedback HTTP surface.
//!
//! A minimal in-process mock of aura-network stands in for the upstream service
//! so we can exercise list/create/comment/vote/status round-trips without
//! depending on a live Postgres or aura-network process. The mock tracks
//! per-profile votes in-memory so the vote contract (one active vote per user)
//! is exercised end-to-end through the Aura OS proxy.

#[path = "../common/mod.rs"]
#[allow(dead_code)]
mod common;

mod comments;
mod create;
mod list;
mod mock;
mod status;
mod voting;
