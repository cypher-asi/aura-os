//! Pure mapping from harness wire events to dev-loop activity
//! transitions.
//!
//! Phase G2 / Section A. This module owns the logic that the server's
//! `dev_loop::streaming::activity` shim used to inline. The shim now
//! calls [`apply_loop_activity`] and forwards the resulting transition
//! into `LoopHandle::transition` (preserving the registry's 4 Hz
//! publish throttle and terminal-bypass rules — see
//! `crates/aura-os-loops/src/registry.rs`).
//!
//! ## Why pure
//!
//! The original mapping lived inside an async function in
//! `apps/aura-os-server`. That made it impossible to unit-test the
//! match arms in isolation, which is how the Section A regression
//! ("spinner stuck because match arms used stale `tool_call_start` /
//! `tool_invocation` strings") slipped through. A pure
//! `(current, event_kind) -> Option<Transition>` function keeps the
//! server-side adapter trivial and the tests cheap.
//!
//! ## What's not here
//!
//! * Terminal mark-completed / mark-failed flows. Those are driven by
//!   `RunCompletion` in the harness collector and live on
//!   `LoopHandle` directly; the shim handles them.
//! * Tool-name extraction. The pure mapper signals "this event moves
//!   us to `WaitingTool`" and the server-side shim pulls the tool
//!   name out of the event payload because that requires
//!   `serde_json::Value` access. Keeping `serde_json` out of the pure
//!   surface lets the test layer construct transitions with simple
//!   structs.

pub mod activity;

#[cfg(test)]
mod tests;

pub use activity::{apply_loop_activity, LoopActivityTransition};
