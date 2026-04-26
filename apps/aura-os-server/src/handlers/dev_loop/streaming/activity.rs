//! Translate harness events into [`LoopHandle`] activity transitions.

use std::str::FromStr;

use aura_os_core::TaskId;
use aura_os_events::LoopStatus;
use aura_os_loops::LoopHandle;

/// Translate a harness event type into a [`LoopActivity`] transition.
///
/// Only a subset of harness events are strong signals for progress
/// (status changes like `Running`/`WaitingTool`/`Compacting`).
/// Non-status-bearing events (token deltas, tool snapshots, usage
/// updates, etc.) fall through to the catch-all arm and intentionally
/// do nothing — they used to call `transition(|_| {})` just to poke
/// `last_event_at`, but that flooded the legacy `event_broadcast`
/// with `LoopActivityChanged` frames and caused `/ws/events` clients
/// to lag, dropping `task_started` / `task_completed` / `task_failed`
/// events that the stats dashboard depends on.
pub(super) async fn apply_loop_activity(
    handle: &LoopHandle,
    event_type: &str,
    event: &serde_json::Value,
) {
    match event_type {
        "task_started" | "run_started" | "session_started" => {
            let task_id = event
                .get("task_id")
                .and_then(|v| v.as_str())
                .and_then(|s| TaskId::from_str(s).ok());
            handle
                .transition(|activity| {
                    activity.status = LoopStatus::Running;
                    activity.percent = Some(0.05);
                    activity.current_step = Some("running".into());
                    if task_id.is_some() {
                        activity.current_task_id = task_id;
                    }
                })
                .await;
        }
        "text_delta" | "assistant_message_start" | "assistant_message_delta" => {
            handle.mark_running(None, Some("thinking".into())).await;
        }
        "tool_call_start" | "tool_invocation" => {
            let tool = event.get("tool").and_then(|v| v.as_str()).unwrap_or("tool");
            handle.mark_waiting_tool(tool).await;
        }
        "tool_call_end" | "tool_result" => {
            handle.mark_running(None, Some("processing".into())).await;
        }
        "compaction_started" | "context_compaction_started" => {
            handle
                .transition(|activity| {
                    activity.status = LoopStatus::Compacting;
                    activity.current_step = Some("compacting".into());
                })
                .await;
        }
        _ => {
            // Intentionally no-op: non-status-bearing harness events
            // (text_delta, token_usage, tool_call_snapshot, etc.) fire at
            // very high rates during streaming. Publishing a
            // `LoopActivityChanged` for each would flood the legacy
            // `event_broadcast` via `loop_events_bridge` and lag the
            // `/ws/events` client into skipping frames — including the
            // `task_started` / `task_completed` / `task_failed` the
            // stats dashboard depends on. The watchdog in the frontend
            // `loop-activity-store` still gets a `last_event_at` pulse
            // on every real status transition, which is enough.
        }
    }
}
