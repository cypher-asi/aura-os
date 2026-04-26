//! `task_done` no-change contract and the completion gate.

use aura_os_server::phase7_test_support as tsp;
use serde_json::json;

#[test]
fn task_done_accepts_explicit_no_changes_needed_without_file_evidence() {
    let ev = json!({
        "name": "task_done",
        "input": {
            "no_changes_needed": true,
            "notes": "The requested implementation was already present and covered by tests."
        }
    });

    assert!(tsp::task_done_declares_no_changes_needed(
        "tool_call_completed",
        &ev
    ));
    assert_eq!(
        tsp::task_done_missing_file_changes_reason("tool_call_completed", &ev, &[]),
        None,
        "explicit no_changes_needed is the required success path for already-complete implementation tasks"
    );
}

#[test]
fn task_done_requires_file_evidence_when_no_changes_needed_is_absent() {
    let ev = json!({
        "name": "task_done",
        "input": {
            "notes": "Implementation complete"
        }
    });

    assert!(!tsp::task_done_declares_no_changes_needed(
        "tool_call_completed",
        &ev
    ));
    assert_eq!(
        tsp::task_done_missing_file_changes_reason("tool_call_completed", &ev, &[]),
        Some("task_done_without_file_changes"),
        "implementation completions still require write/edit/delete evidence unless they opt into no_changes_needed"
    );
}

#[test]
fn task_done_with_file_evidence_does_not_need_no_changes_flag() {
    let ev = json!({
        "name": "task_done",
        "input": {
            "notes": "Implementation complete"
        }
    });

    assert_eq!(
        tsp::task_done_missing_file_changes_reason(
            "tool_call_completed",
            &ev,
            &["crates/zero-network/src/program.rs"]
        ),
        None
    );
}

#[test]
fn task_done_no_change_contract_ignores_errored_or_unrelated_events() {
    let errored = json!({
        "name": "task_done",
        "is_error": true,
        "input": { "no_changes_needed": true }
    });
    assert!(!tsp::task_done_declares_no_changes_needed(
        "tool_call_completed",
        &errored
    ));
    assert_eq!(
        tsp::task_done_missing_file_changes_reason("tool_call_completed", &errored, &[]),
        None
    );

    let unrelated = json!({
        "name": "run_command",
        "input": { "cmd": "cargo test" }
    });
    assert_eq!(
        tsp::task_done_missing_file_changes_reason("tool_call_completed", &unrelated, &[]),
        None
    );
    assert_eq!(
        tsp::task_done_missing_file_changes_reason("tool_call_started", &unrelated, &[]),
        None
    );
}

#[test]
fn completion_gate_accepts_harness_terminal_state_despite_empty_path_write_history() {
    // Empty-path writes remain useful diagnostic history, but the harness
    // owns whether the task is complete. aura-os must not reject a harness
    // terminal event based on its own DoD interpretation.
    let reason = tsp::completion_validation_reason_with_empty_path_writes(
        "never wrote anything real",
        /* files_changed */ &[],
        /* build */ 1,
        /* test */ 1,
        /* fmt */ 1,
        /* clippy */ 1,
        /* empty-path writes */ 1,
    );
    assert!(
        reason.is_none(),
        "aura-os must defer completion semantics to the harness, got rejection: {reason:?}"
    );
}

#[test]
fn completion_gate_accepts_empty_path_write_when_recovered() {
    // Task 2.4 regression: the automaton emitted a handful of
    // empty-path write_file calls, the harness surfaced the error
    // inline, and the automaton recovered with a real-path write
    // that did land on disk. The history is display-only in aura-os;
    // the harness determines whether the recovery satisfied DoD.
    let reason = tsp::completion_validation_reason_with_empty_path_writes(
        "implementation complete after a misfire",
        &["crates/zero-program/src/lib.rs"],
        /* build */ 1,
        /* test */ 1,
        /* fmt */ 1,
        /* clippy */ 1,
        /* empty-path writes */ 3,
    );
    assert!(
        reason.is_none(),
        "aura-os must not fail recovered empty-path history, got rejection: {reason:?}"
    );
}

#[test]
fn completion_gate_accepts_fully_evidenced_run_with_no_empty_path_writes() {
    let reason = tsp::completion_validation_reason_with_empty_path_writes(
        "implementation complete",
        &["crates/zero-program/src/lib.rs"],
        1,
        1,
        1,
        1,
        0,
    );
    assert!(
        reason.is_none(),
        "a fully-evidenced run must pass the gate, got rejection: {reason:?}"
    );
}

/// Regression for task `2.1 Secret wrappers: NeuralKey, ShamirShare,
/// Secret<T>`, which failed on 2026-04-23 with the reason
/// "Automaton emitted write_file/edit_file tool call(s) with an empty
/// or missing \"path\" input; the harness must retry with a real
/// path before task_done".
#[test]
fn task_21_empty_path_misfire_then_retry_passes_the_gate() {
    let events = vec![
        (
            "tool_call_started".to_string(),
            json!({
                "id": "w1",
                "name": "write_file",
                "input": { "path": "" },
            }),
        ),
        (
            "tool_call_completed".to_string(),
            json!({
                "id": "w1",
                "name": "write_file",
                "input": { "path": "" },
            }),
        ),
        (
            "tool_call_started".to_string(),
            json!({
                "id": "w2",
                "name": "write_file",
                "input": { "path": "crates/zero-identity/src/secret.rs" },
            }),
        ),
        (
            "tool_call_completed".to_string(),
            json!({
                "id": "w2",
                "name": "write_file",
                "input": { "path": "crates/zero-identity/src/secret.rs" },
            }),
        ),
        (
            "tool_call_started".to_string(),
            json!({
                "id": "e1",
                "name": "edit_file",
                "input": { "path": "" },
            }),
        ),
        (
            "tool_call_completed".to_string(),
            json!({
                "id": "e1",
                "name": "edit_file",
                "input": { "path": "" },
            }),
        ),
        (
            "tool_call_started".to_string(),
            json!({
                "id": "e2",
                "name": "edit_file",
                "input": { "path": "crates/zero-identity/src/types.rs" },
            }),
        ),
        (
            "tool_call_completed".to_string(),
            json!({
                "id": "e2",
                "name": "edit_file",
                "input": { "path": "crates/zero-identity/src/types.rs" },
            }),
        ),
    ];
    let reason = tsp::replay_task_completion_gate(
        &events,
        "implementation complete",
        &[
            "crates/zero-identity/src/secret.rs",
            "crates/zero-identity/src/types.rs",
        ],
        1,
        1,
        1,
        1,
    );
    assert!(
        reason.is_none(),
        "reconciled empty-path misfires must not fail the gate, got rejection: {reason:?}"
    );
}

#[test]
fn empty_path_misfire_without_recovery_still_fails_the_gate() {
    let events = vec![
        (
            "tool_call_started".to_string(),
            json!({
                "id": "w1",
                "name": "write_file",
                "input": { "path": "" },
            }),
        ),
        (
            "tool_call_completed".to_string(),
            json!({
                "id": "w1",
                "name": "write_file",
                "input": { "path": "" },
            }),
        ),
    ];
    let reason = tsp::replay_task_completion_gate(
        &events,
        "implementation complete",
        &["crates/zero-program/src/lib.rs"],
        1,
        1,
        1,
        1,
    )
    .expect("unreconciled misfire must fail the gate");
    assert!(
        reason.contains("empty or missing \"path\""),
        "rejection must name the empty-path failure mode, got: {reason}"
    );
}

#[test]
fn completion_gate_accepts_source_edit_without_local_verification_evidence() {
    let reason = tsp::completion_validation_reason(
        "implementation complete",
        &["crates/zero-program/src/lib.rs"],
        0,
        0,
        0,
        0,
    );
    assert!(
        reason.is_none(),
        "aura-os must not reject source edits based on local verification counters"
    );
}
