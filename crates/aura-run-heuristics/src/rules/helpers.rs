//! Shared helpers used by several rule modules. Kept deliberately
//! minimal so each rule module stays independently readable.

use aura_os_core::TaskId;
use serde_json::Value;

/// Extract a `task_id` UUID from an event, if present. `loop_log.rs`
/// serialises `TaskId` as a plain string, so this parses straight
/// from the JSON string form.
pub(super) fn event_task_id(event: &Value) -> Option<TaskId> {
    event
        .get("task_id")
        .and_then(|v| v.as_str())
        .and_then(|s| s.parse::<TaskId>().ok())
}

/// Extract the raw string form of `task_id`. Useful when grouping
/// events whose ids may not be valid UUIDs (synthetic tests etc).
pub(super) fn event_task_id_str(event: &Value) -> Option<&str> {
    event.get("task_id").and_then(|v| v.as_str())
}

pub(super) fn event_u64(event: &Value, key: &str) -> Option<u64> {
    event.get(key).and_then(|v| v.as_u64())
}

pub(super) fn event_str<'a>(event: &'a Value, key: &str) -> Option<&'a str> {
    event.get(key).and_then(|v| v.as_str())
}
