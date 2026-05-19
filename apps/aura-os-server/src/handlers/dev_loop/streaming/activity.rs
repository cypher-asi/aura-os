//! Thin shim that drives [`LoopHandle`] activity transitions from
//! harness wire events.
//!
//! The pure mapping lives in
//! [`aura_os_automation::progress::apply_loop_activity`]. This module
//! is the App-layer adapter: it snapshots the live `LoopHandle`,
//! delegates to the pure mapper, and forwards the resulting
//! [`LoopActivityTransition`] into `LoopHandle::transition` so the
//! registry's 4 Hz publish throttle and terminal-status bypass rules
//! still apply (see `crates/aura-os-loops/src/registry.rs`).
//!
//! Section A regression: the previous shim hard-coded match arms
//! against stale event-type strings (`tool_call_start`,
//! `tool_invocation`, ...) so the harness's real `tool_use_start` /
//! `tool_call_started` events fired no transition and the UI spinner
//! got stuck on the initial `Starting / "connecting"` snapshot. The
//! pure mapper matches against
//! [`aura_os_automation::event_kinds`] constants which mirror the
//! harness module byte-for-byte (pinned by an invariant test in the
//! automation crate).

use aura_os_automation::progress::{apply_loop_activity, LoopActivityTransition};
use aura_os_loops::LoopHandle;

#[cfg(test)]
mod tests;

/// Apply the activity transition implied by `event_type` to `handle`.
///
/// No-op when the loop has already terminated (the `LoopHandle`
/// snapshot returns `None`) or when the pure mapper decides the event
/// is non-status-bearing / would not change the observable activity.
pub(super) async fn apply_loop_activity_event(
    handle: &LoopHandle,
    event_type: &str,
    event: &serde_json::Value,
) {
    let Some(current) = handle.snapshot() else {
        return;
    };
    let Some(transition) = apply_loop_activity(&current, event_type) else {
        return;
    };
    match transition {
        LoopActivityTransition::Running { step } => {
            handle.mark_running(None, Some(step.to_string())).await;
        }
        LoopActivityTransition::WaitingTool => {
            let tool = event_tool_name(event);
            handle.mark_waiting_tool(tool).await;
        }
    }
}

/// Pull the tool name from a harness `tool_use_start` /
/// `tool_call_started` payload, falling back to a generic label when
/// the field is missing or non-string. The harness has at least two
/// shapes (`tool` and `name`) depending on the event family; we read
/// both before giving up.
fn event_tool_name(event: &serde_json::Value) -> &str {
    event
        .get("tool")
        .and_then(|v| v.as_str())
        .or_else(|| event.get("name").and_then(|v| v.as_str()))
        .unwrap_or("tool")
}
