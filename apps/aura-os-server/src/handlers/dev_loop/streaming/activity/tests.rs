//! Server-side regression tests for the dev-loop activity shim.
//!
//! Section A regression: the previous shim matched harness events
//! against stale type strings (`tool_call_start`, `tool_invocation`,
//! `tool_call_end`, ...). Real `tool_use_start` / `tool_call_started`
//! events fired no transition and the UI spinner stayed pinned to the
//! initial `Starting / "connecting"` snapshot. These tests pin the
//! end-to-end behaviour through the live `LoopRegistry` so the stall
//! cannot return.

use aura_os_core::{AgentId, AgentInstanceId, ProjectId, UserId};
use aura_os_events::{EventHub, LoopId, LoopKind, LoopStatus};
use aura_os_loops::{LoopHandle, LoopRegistry};

use super::apply_loop_activity_event;
use aura_os_automation::event_kinds as ek;

fn make_handle() -> (LoopRegistry, LoopHandle) {
    let registry = LoopRegistry::new(EventHub::new());
    let loop_id = LoopId::new(
        UserId::new(),
        Some(ProjectId::new()),
        Some(AgentInstanceId::new()),
        AgentId::new(),
        LoopKind::Automation,
    );
    let handle = registry.open(loop_id);
    (registry, handle)
}

async fn send(handle: &LoopHandle, event_type: &str, payload: serde_json::Value) {
    apply_loop_activity_event(handle, event_type, &payload).await;
}

#[tokio::test]
async fn happy_path_running_to_waiting_tool_to_running() {
    let (registry, handle) = make_handle();

    send(&handle, ek::TEXT_DELTA, serde_json::json!({})).await;
    let snap = registry.snapshot_one(handle.loop_id()).expect("registered");
    assert_eq!(snap.activity.status, LoopStatus::Running);
    assert_eq!(snap.activity.current_step.as_deref(), Some("thinking"));

    send(
        &handle,
        ek::TOOL_USE_START,
        serde_json::json!({ "tool": "read_file" }),
    )
    .await;
    let snap = registry.snapshot_one(handle.loop_id()).expect("registered");
    assert_eq!(snap.activity.status, LoopStatus::WaitingTool);
    assert_eq!(
        snap.activity.current_step.as_deref(),
        Some("tool: read_file"),
    );

    send(&handle, ek::TOOL_RESULT, serde_json::json!({})).await;
    let snap = registry.snapshot_one(handle.loop_id()).expect("registered");
    assert_eq!(snap.activity.status, LoopStatus::Running);
    assert_eq!(snap.activity.current_step.as_deref(), Some("processing"));

    handle.mark_completed().await;
}

#[tokio::test]
async fn tool_call_started_alias_drives_waiting_tool() {
    let (registry, handle) = make_handle();
    send(
        &handle,
        ek::TOOL_CALL_STARTED,
        serde_json::json!({ "name": "edit_file" }),
    )
    .await;
    let snap = registry.snapshot_one(handle.loop_id()).expect("registered");
    assert_eq!(snap.activity.status, LoopStatus::WaitingTool);
    assert_eq!(
        snap.activity.current_step.as_deref(),
        Some("tool: edit_file"),
    );
    handle.mark_completed().await;
}

#[tokio::test]
async fn legacy_stale_event_kinds_do_not_fire_a_transition() {
    let (registry, handle) = make_handle();
    let baseline = registry.snapshot_one(handle.loop_id()).unwrap().activity;
    assert_eq!(baseline.status, LoopStatus::Starting);

    for stale in [
        "tool_call_start",
        "tool_invocation",
        "tool_call_end",
        "compaction_started",
        "context_compaction_started",
    ] {
        send(&handle, stale, serde_json::json!({ "tool": "x" })).await;
        let snap = registry.snapshot_one(handle.loop_id()).expect("registered");
        assert_eq!(snap.activity.status, LoopStatus::Starting, "stale: {stale}");
        assert_eq!(snap.activity.current_step, baseline.current_step);
    }
    handle.mark_completed().await;
}
