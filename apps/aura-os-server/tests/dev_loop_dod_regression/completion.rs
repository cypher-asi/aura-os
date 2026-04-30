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
fn empty_path_misfire_without_recovery_defers_to_harness_dod() {
    // Pre-existing test, updated to reflect the harness-owns-DoD
    // design (`completion_validation_failure_reason_with_empty_path_writes_for_tests`
    // is intentionally inert — see the docstring on that function in
    // `dev_loop/signals.rs`). aura-os keeps empty-path-write history
    // for diagnostic display only; the harness decides whether the
    // run satisfied DoD. The matching positive case lives at
    // `completion_gate_accepts_harness_terminal_state_despite_empty_path_write_history`.
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
    );
    assert!(
        reason.is_none(),
        "aura-os defers DoD to the harness; an unreconciled empty-path write \
         is diagnostic history, not a DoD-blocking failure. Got rejection: \
         {reason:?}"
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

// ---------------------------------------------------------------------------
// Tests-as-truth completion gate
//
// Regression for task `4.4 Deterministic CBOR AAD builder` (run id
// 9995d958-c193-4998-b5d3-d5b9f4092a45), which failed with
// "agent execution error: task completed without any file operations —
// completion not verified" even though the implementation already
// existed and was covered by tests in `crates/zero-crypto`.
//
// The fix introduces a third valid completion path next to file-edit
// evidence and explicit `no_changes_needed: true`: a successful
// invocation of a recognized test runner (cargo test / pnpm vitest /
// pytest / ...) accumulated during the run is itself accepted as
// completion evidence. The reconciler then bridges the harness
// `CompletionContract` failure into a `mark_done` action with reason
// `test_evidence_accepted` rather than a terminal failure.
// ---------------------------------------------------------------------------

#[test]
fn test_runner_detector_accepts_canonical_passing_invocations() {
    for cmd in [
        "cargo test -p zero-crypto",
        "cargo nextest run --workspace",
        "pnpm vitest run",
        "pnpm jest --runInBand",
        "pytest -xvs tests/",
        "python -m pytest -q",
        "go test ./...",
        "mix test",
        "bun test",
        "yarn test",
        "pnpm test",
        "npm test --silent",
    ] {
        let event = json!({
            "name": "run_command",
            "input": { "command": cmd },
            "output": { "exit_code": 0 },
        });
        assert!(
            tsp::is_successful_test_run_event("tool_call_completed", &event),
            "{cmd}: must register as test-pass evidence"
        );
        assert!(
            tsp::recognized_test_runner_label(cmd).is_some(),
            "{cmd}: must produce a stable runner label"
        );
    }
}

#[test]
fn test_runner_detector_rejects_build_only_and_failing_runs() {
    let no_run = json!({
        "name": "run_command",
        "input": { "command": "cargo test --no-run" },
        "output": { "exit_code": 0 },
    });
    assert!(
        !tsp::is_successful_test_run_event("tool_call_completed", &no_run),
        "`cargo test --no-run` compiles tests but does not run them — must not gate completion"
    );

    let cargo_check = json!({
        "name": "run_command",
        "input": { "command": "cargo check --workspace" },
        "output": { "exit_code": 0 },
    });
    assert!(
        !tsp::is_successful_test_run_event("tool_call_completed", &cargo_check),
        "type-check-only commands must not gate completion"
    );

    let failing = json!({
        "name": "run_command",
        "input": { "command": "cargo test" },
        "output": { "exit_code": 101 },
    });
    assert!(
        !tsp::is_successful_test_run_event("tool_call_completed", &failing),
        "non-zero exit must disqualify the evidence"
    );

    let errored = json!({
        "name": "run_command",
        "is_error": true,
        "input": { "command": "cargo test" },
        "output": { "exit_code": 0 },
    });
    assert!(
        !tsp::is_successful_test_run_event("tool_call_completed", &errored),
        "tool-call error flag must disqualify the evidence even if exit_code is 0"
    );
}

#[test]
fn test_runner_detector_ignores_non_shell_tool_calls() {
    // `write_file` adapters occasionally carry a synthetic `command`
    // string in their input; the gate must ignore them so we don't
    // accidentally accept "wrote a file with the word `cargo test` in
    // it" as a passing test run.
    let write = json!({
        "name": "write_file",
        "input": { "command": "cargo test", "path": "src/lib.rs" },
        "output": { "exit_code": 0 },
    });
    assert!(!tsp::is_successful_test_run_event(
        "tool_call_completed",
        &write
    ));
}

#[test]
fn reconciler_overrides_completion_contract_when_test_evidence_present() {
    // Harness verdict says CompletionContract; without evidence we mark
    // the task terminal as "completion_contract".
    let without_evidence = tsp::reconcile_decision_with_test_evidence(
        &[],
        "completion_contract",
        0,
        3,
        false,
        false,
        /* has_test_pass_evidence */ false,
    );
    assert_eq!(
        without_evidence,
        json!({
            "action": "mark_terminal",
            "reason": "completion_contract",
        }),
        "no test evidence: keep harness verdict as a terminal completion-contract failure"
    );

    // With evidence we override into a successful no-edit completion.
    let with_evidence = tsp::reconcile_decision_with_test_evidence(
        &[],
        "completion_contract",
        0,
        3,
        false,
        false,
        /* has_test_pass_evidence */ true,
    );
    assert_eq!(
        with_evidence,
        json!({
            "action": "mark_done",
            "reason": "test_evidence_accepted",
        }),
        "test-pass evidence must override CompletionContract into a Done transition"
    );
}

#[test]
fn reconciler_does_not_override_other_failure_classes_with_test_evidence() {
    // Test-pass evidence is specifically for the "no file edits"
    // contract failure. It must not paper over other failure classes.
    for class in ["truncation", "rate_limited", "push_timeout", "other"] {
        let decision = tsp::reconcile_decision_with_test_evidence(
            &[],
            class,
            0,
            3,
            false,
            false,
            /* has_test_pass_evidence */ true,
        );
        let action = decision
            .get("action")
            .and_then(|v| v.as_str())
            .unwrap_or("");
        assert_ne!(
            action, "mark_done",
            "{class}: test-pass evidence must not override non-completion-contract failures"
        );
    }
}
