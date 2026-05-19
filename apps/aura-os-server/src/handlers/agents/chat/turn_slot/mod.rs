//! Per-partition turn slot: serializes user messages on a single
//! ChatSession partition so back-to-back sends queue instead of
//! racing the upstream harness turn-lock.
//!
//! Phase 3 of the robust-concurrent-agent-infra plan. The harness
//! enforces "one in-flight turn per agent_id". After Phase 1
//! `agent_id` is partitioned per AgentInstance, so cross-partition
//! traffic already runs in parallel; the remaining race is two
//! user messages arriving back-to-back on the SAME partition. The
//! WS writer accepts both into its mpsc, the harness rejects the
//! second with `code: turn_in_progress`, and Phase 2's SSE remap
//! cleans up the wording. This module prevents the race outright
//! by serializing the sends on the server side.
//!
//! Lifetime model: the HTTP handler returns immediately after
//! handing the SSE stream to axum, so a guard local to the handler
//! would unlock as soon as the first byte hit the wire. Instead we
//! hand the guard to a sentinel task that watches the harness
//! broadcast for the same terminal events the SSE forwarder treats
//! as `should_close` (`AssistantMessageEnd` / `Error`) and drops
//! the guard there, releasing the slot for the next queued turn.
//!
//! Queue depth is bounded at [`DEFAULT_MAX_PENDING_TURNS`] acquirers
//! (1 in-flight + 3 queued by default; tunable via
//! `AURA_PARTITION_TURN_QUEUE`, clamped to `[2, 1024]`). The N+1th
//! concurrent acquire returns `Err(TurnSlotQueueFull)` so the
//! orchestrator can surface `ApiError::agent_busy { reason: "queue
//! full" }` instead of letting the mutex pile up unbounded.

mod acquire;
mod config;
mod release;
mod watchdog;

pub use acquire::{acquire_turn_slot, TurnSlotAcquired, TurnSlotGuard, TurnSlotQueueFull};
pub use config::{max_pending_turns, DEFAULT_MAX_PENDING_TURNS};

// Phase 3 reserved knobs: surface-area is held stable for Phase 6
// (`tool_heartbeat_interval`) and for the SSE wiring that consumes
// `DEFAULT_FIRST_EVENT_TIMEOUT_SECS` / `DEFAULT_MAX_IDLE_TIMEOUT_SECS` /
// `DEFAULT_TOOL_HEARTBEAT_INTERVAL_SECS`, even when the current crate
// has no caller for the re-export itself yet. The `#[allow]` keeps
// `-D warnings` clean without dropping the public path.
#[allow(unused_imports)]
pub use config::{
    tool_heartbeat_interval, DEFAULT_FIRST_EVENT_TIMEOUT_SECS, DEFAULT_MAX_IDLE_TIMEOUT_SECS,
    DEFAULT_TOOL_HEARTBEAT_INTERVAL_SECS,
};

// `acquire_turn_slot_with_cap` only has in-module test callers today,
// but the test-friendly cap-override API is part of the documented
// crate-internal surface — keep the re-export pinned.
#[allow(unused_imports)]
pub(crate) use acquire::acquire_turn_slot_with_cap;
pub(crate) use release::spawn_turn_slot_release;
pub(crate) use watchdog::spawn_turn_watchdog;
