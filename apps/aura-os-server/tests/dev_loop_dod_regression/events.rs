//! Empty-path write detection and `files_changed` inference from
//! successful tool events (Task 2.6 regression).

use aura_os_server::phase7_test_support as tsp;
use serde_json::json;

#[test]
fn empty_path_write_event_is_detected_for_write_and_edit() {
    for name in ["write_file", "edit_file"] {
        let ev = json!({
            "name": name,
            "input": { "path": "" }
        });
        assert!(
            tsp::is_empty_path_write_event("tool_call_completed", &ev),
            "{name} with empty path must be flagged"
        );
    }
}

#[test]
fn empty_path_write_event_is_detected_when_path_is_missing() {
    let ev = json!({ "name": "write_file", "input": {} });
    assert!(
        tsp::is_empty_path_write_event("tool_call_completed", &ev),
        "write_file with no path key must be flagged"
    );
}

#[test]
fn empty_path_write_event_ignores_unrelated_tools() {
    let ev = json!({ "name": "run_command", "input": { "cmd": "ls" } });
    assert!(!tsp::is_empty_path_write_event("tool_call_completed", &ev));
}

#[test]
fn empty_path_write_event_accepts_pathed_write() {
    let ev = json!({
        "name": "write_file",
        "input": { "path": "crates/foo/src/lib.rs" }
    });
    assert!(!tsp::is_empty_path_write_event("tool_call_completed", &ev));
}

#[test]
fn empty_path_write_event_ignores_started_and_snapshot_events() {
    // A single malformed tool call fires tool_call_started ->
    // tool_call_snapshot* -> tool_call_completed. Only the final
    // completed event counts toward empty_path_writes; otherwise a
    // single misfire would be counted 2-3x and mask recovery.
    let ev = json!({ "name": "write_file", "input": { "path": "" } });
    assert!(!tsp::is_empty_path_write_event("tool_call_started", &ev));
    assert!(!tsp::is_empty_path_write_event("tool_call_snapshot", &ev));
    assert!(tsp::is_empty_path_write_event("tool_call_completed", &ev));
}

#[test]
fn successful_write_event_path_extracts_real_path_writes() {
    let ev = json!({
        "name": "write_file",
        "input": { "path": "crates/zero-identity/src/identity.rs" }
    });
    let (path, op) = tsp::successful_write_event_path("tool_call_completed", &ev)
        .expect("a successful write_file must be recorded");
    assert_eq!(path, "crates/zero-identity/src/identity.rs");
    assert_eq!(op, "modify");
}

#[test]
fn successful_write_event_path_handles_edit_and_delete_tools() {
    let edit = json!({
        "name": "edit_file",
        "input": { "path": "crates/zero-identity/src/store/memory.rs" }
    });
    let (path, op) = tsp::successful_write_event_path("tool_call_completed", &edit)
        .expect("edit_file must be recorded");
    assert_eq!(path, "crates/zero-identity/src/store/memory.rs");
    assert_eq!(op, "modify");

    let delete = json!({
        "name": "delete_file",
        "input": { "path": "docs/legacy.md" }
    });
    let (path, op) = tsp::successful_write_event_path("tool_call_completed", &delete)
        .expect("delete_file must be recorded");
    assert_eq!(path, "docs/legacy.md");
    assert_eq!(op, "delete");
}

#[test]
fn successful_write_event_path_skips_errored_or_empty_events() {
    let errored = json!({
        "name": "write_file",
        "is_error": true,
        "input": { "path": "src/lib.rs" }
    });
    assert!(tsp::successful_write_event_path("tool_call_completed", &errored).is_none());

    let empty = json!({
        "name": "write_file",
        "input": { "path": "   " }
    });
    assert!(tsp::successful_write_event_path("tool_call_completed", &empty).is_none());

    let wrong_event = json!({
        "name": "write_file",
        "input": { "path": "src/lib.rs" }
    });
    assert!(tsp::successful_write_event_path("tool_call_started", &wrong_event).is_none());

    let wrong_tool = json!({
        "name": "read_file",
        "input": { "path": "src/lib.rs" }
    });
    assert!(tsp::successful_write_event_path("tool_call_completed", &wrong_tool).is_none());
}
