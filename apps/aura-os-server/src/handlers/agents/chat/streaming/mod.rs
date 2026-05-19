//! SSE streaming plumbing for chat: harness → SSE bridge, response
//! header construction, attachment translation, and the
//! `open_harness_chat_stream` orchestrator that ties persistence,
//! session lookup, and the SSE response together. Split into focused
//! submodules so each file stays below the 500-line cap.
//!
//! See `PARALLEL_SESSIONS.md` for the parallel-session concurrency model and known caveats.

mod attachments;
mod bridge;
#[cfg(test)]
mod bridge_tests;
mod drop_guard;
mod orchestrator;
mod prefix;
mod session;
mod title;
mod tool_hints;

pub use bridge::harness_broadcast_to_sse;

// `SSE_HEARTBEAT_INTERVAL` is `pub(crate)` in `bridge.rs` and reached
// from outside `streaming/` (e.g. integration tests) via the
// `streaming::SSE_HEARTBEAT_INTERVAL` path — preserve that.
#[allow(unused_imports)]
pub(crate) use bridge::SSE_HEARTBEAT_INTERVAL;

pub(super) use orchestrator::{open_harness_chat_stream, OpenChatStreamArgs};
