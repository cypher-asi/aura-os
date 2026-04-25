//! Per-connection loop registry and activity tracking.
//!
//! Owns the lifecycle of every chat / automation / task-run / spec-gen
//! loop in the system. Each loop is tracked by a [`LoopId`] (composite
//! tuple including a fresh per-loop UUID) and exposes a typed
//! [`LoopActivityChanged`](aura_os_events::LoopActivityChanged) stream
//! through the shared [`EventHub`](aura_os_events::EventHub).
//!
//! ## Concurrency model
//!
//! - One [`LoopHandle`] per running loop. No reuse: every HTTP request,
//!   SSE stream, or automation start gets its own handle and its own
//!   downstream resources.
//! - Activity transitions are throttled by a per-loop publish budget
//!   (default 4 Hz) so high-frequency events (token deltas) don't
//!   produce render storms in the UI.
//! - The registry is `Clone` (Arc-backed) so it can live on `AppState`
//!   and be shared across handlers.

#![warn(missing_docs)]

pub mod registry;

pub use registry::{LoopHandle, LoopRegistry, LoopRegistryError, LoopSnapshot};
