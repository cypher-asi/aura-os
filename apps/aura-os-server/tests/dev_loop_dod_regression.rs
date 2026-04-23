//! Dev-loop hardening regressions.
//!
//! These tests lock in the behaviour added after the
//! `Create zero-program crate implementing GRID Program trait` task
//! failure that motivated the hardening plan:
//!
//! 1. **Empty workspace preflight** — starting a dev loop against a
//!    missing/empty/non-git directory must fail fast with a
//!    remediation hint *unless* a `git_repo_url` is configured, in
//!    which case the automaton is expected to clone into it.
//! 2. **Empty-path write rejection** — a `write_file` / `edit_file`
//!    tool call with a blank or missing `path` is classified as an
//!    empty-path write, and any non-zero count forces the DoD gate to
//!    reject `task_completed` with the dedicated error string.
//! 3. **Missing verification evidence** — a run that edited source but
//!    never issued build/test/fmt/clippy commands is rejected by the
//!    DoD gate even if every other field is plausible.
//!
//! The intent is explicitly *replay*-style: we don't spin up a live
//! server, task service, or automaton. We exercise the public
//! [`aura_os_server::phase7_test_support`] entry points that wrap the
//! exact functions production start paths call.

use aura_os_server::phase7_test_support as tsp;
use serde_json::json;
use std::fs;
use tempfile::TempDir;

// ---------------------------------------------------------------------------
// Workspace preflight
// ---------------------------------------------------------------------------

#[test]
fn preflight_rejects_missing_workspace_path_without_repo_url() {
    let tmp = TempDir::new().expect("tempdir");
    let missing = tmp.path().join("does-not-exist");
    let err = tsp::preflight_local_workspace(missing.to_str().unwrap(), None)
        .expect_err("missing directory must be rejected");
    // The remediation hint should name the missing path so the UI can
    // tell the user what to create.
    assert!(
        err.contains(missing.file_name().unwrap().to_str().unwrap()),
        "preflight error should mention the offending path, got: {err}"
    );
}

#[test]
fn preflight_rejects_empty_workspace_without_repo_url() {
    let tmp = TempDir::new().expect("tempdir");
    let err = tsp::preflight_local_workspace(tmp.path().to_str().unwrap(), None)
        .expect_err("empty directory must be rejected when no repo URL is set");
    assert!(
        !err.is_empty(),
        "preflight must return a non-empty remediation hint"
    );
}

#[test]
fn preflight_tolerates_empty_workspace_when_repo_url_is_set() {
    let tmp = TempDir::new().expect("tempdir");
    // Simulate a freshly-provisioned project directory where the
    // automaton will clone `git_repo_url` on first run.
    tsp::preflight_local_workspace(
        tmp.path().to_str().unwrap(),
        Some("https://example.com/acme/zero.git"),
    )
    .expect("empty workspace with configured repo URL should bootstrap");
}

#[test]
fn preflight_rejects_empty_string_path_even_with_repo_url() {
    // Defence-in-depth: an empty configured path is always a bug,
    // regardless of whether a repo URL is set.
    let err = tsp::preflight_local_workspace("", Some("https://example.com/acme/zero.git"))
        .expect_err("empty project path must always be rejected");
    assert!(err.to_lowercase().contains("workspace"));
}

#[test]
fn preflight_accepts_initialised_git_workspace() {
    let tmp = TempDir::new().expect("tempdir");
    fs::create_dir(tmp.path().join(".git")).expect("mkdir .git");
    fs::write(tmp.path().join("README.md"), "# hello\n").expect("seed a file");
    tsp::preflight_local_workspace(tmp.path().to_str().unwrap(), None)
        .expect("a workspace with .git and content must pass preflight");
}

// ---------------------------------------------------------------------------
// Empty-path write detection & DoD-gate short-circuit
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// files_changed inference from successful tool events (Task 2.6 regression)
// ---------------------------------------------------------------------------

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

#[test]
fn completion_gate_rejects_unrecovered_empty_path_write() {
    // Empty-path writes with no recovery (files_changed is empty) are
    // the unambiguous misfire case: the automaton emitted bogus
    // write_file calls and never produced a real write before
    // task_done. The gate must reject so the dev loop retries.
    let reason = tsp::completion_validation_reason_with_empty_path_writes(
        "never wrote anything real",
        /* files_changed */ &[],
        /* build */ 1,
        /* test */ 1,
        /* fmt */ 1,
        /* clippy */ 1,
        /* empty-path writes */ 1,
    )
    .expect("unrecovered empty-path write must fail the DoD gate");
    assert!(
        reason.contains("empty") || reason.contains("path"),
        "rejection reason must name the empty-path failure mode, got: {reason}"
    );
}

#[test]
fn completion_gate_accepts_empty_path_write_when_recovered() {
    // Task 2.4 regression: the automaton emitted a handful of
    // empty-path write_file calls, the harness surfaced the error
    // inline, and the automaton recovered with a real-path write
    // that did land on disk. The gate must treat the empty-path
    // events as benign history and let the run through — the
    // verification-step checks still enforce DoD on the real writes.
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
        "recovered empty-path writes must not fail the gate, got rejection: {reason:?}"
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

// ---------------------------------------------------------------------------
// Missing verification evidence
// ---------------------------------------------------------------------------

#[test]
fn completion_gate_rejects_source_edit_without_build_or_test_or_lint() {
    let reason = tsp::completion_validation_reason(
        "implementation complete",
        &["crates/zero-program/src/lib.rs"],
        0,
        0,
        0,
        0,
    )
    .expect("edited source with no verification must be rejected");
    // We don't pin the exact wording — just that the gate flagged
    // something actionable rather than silently passing.
    assert!(!reason.is_empty());
}

// ---------------------------------------------------------------------------
// Push-outcome vs task terminal status (Section 3 regression)
//
// Locks in the dev-loop invariant: push failures â whether a
// GitPushTimeout, a RemoteStorageExhausted, or a generic git_push_failed
// â MUST NOT demote a task from `done` to `failed` when the completion
// gate otherwise passes. The completion gate owns terminal state; push is
// best-effort infrastructure.
// ---------------------------------------------------------------------------

fn committed_git_steps() -> Vec<serde_json::Value> {
    vec![json!({
        "type": "git_committed",
        "commit_sha": "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
    })]
}

#[test]
fn gate_pass_with_push_timeout_keeps_task_done() {
    let git_steps = committed_git_steps();
    let done = tsp::should_task_complete_despite_push_failure(
        "implementation complete",
        &["crates/zero-program/src/lib.rs"],
        /* build */ 1,
        /* test */ 1,
        /* fmt */ 1,
        /* clippy */ 1,
        &git_steps,
        "timeout",
    );
    assert!(
        done,
        "a task that passed the DoD gate must stay `done` even if git push timed out"
    );
}

#[test]
fn gate_pass_with_remote_storage_exhausted_keeps_task_done() {
    let git_steps = committed_git_steps();
    let done = tsp::should_task_complete_despite_push_failure(
        "implementation complete",
        &["crates/zero-program/src/lib.rs"],
        1,
        1,
        1,
        1,
        &git_steps,
        "remote_storage_exhausted",
    );
    assert!(
        done,
        "a task that passed the DoD gate must stay `done` even when the remote is out of storage"
    );
}

#[test]
fn gate_pass_with_generic_push_failed_keeps_task_done() {
    let git_steps = committed_git_steps();
    let done = tsp::should_task_complete_despite_push_failure(
        "implementation complete",
        &["crates/zero-program/src/lib.rs"],
        1,
        1,
        1,
        1,
        &git_steps,
        "generic",
    );
    assert!(
        done,
        "a task that passed the DoD gate must stay `done` under any generic push failure"
    );
}

#[test]
fn gate_fail_with_push_timeout_still_falls_through_to_failed() {
    // No verification evidence AND no files_changed â the gate must
    // reject, and a push timeout on top of that must NOT silently
    // bypass the gate. The helper must return false so the handler
    // takes the normal `task_failed` terminal path.
    let git_steps = committed_git_steps();
    let done = tsp::should_task_complete_despite_push_failure(
        "",  /* live_output */
        &[], /* files_changed */
        0,
        0,
        0,
        0,
        &git_steps,
        "timeout",
    );
    assert!(
        !done,
        "when the completion gate itself fails, a push failure must not promote the task to `done`"
    );
}

#[test]
fn gate_pass_without_git_commit_does_not_complete_despite_push() {
    // Defence-in-depth: if there is no `git_committed` anchor, we have
    // nothing to stand the `done` claim on. The helper must say false
    // so the handler doesn't mark a task done for work that never
    // made it into a commit.
    let done = tsp::should_task_complete_despite_push_failure(
        "implementation complete",
        &["crates/zero-program/src/lib.rs"],
        1,
        1,
        1,
        1,
        &[], /* no git steps */
        "timeout",
    );
    assert!(
        !done,
        "no git_committed means no commit SHA to anchor `done` to; helper must return false"
    );
}

#[test]
fn classify_push_failure_routes_timeout_storage_and_generic_reasons() {
    assert_eq!(
        tsp::classify_push_failure("git push orbit HEAD:main: timed out after 60s"),
        Some("push_timeout"),
    );
    assert_eq!(
        tsp::classify_push_failure("remote: error: No space left on device"),
        Some("remote_storage_exhausted"),
    );
    assert_eq!(
        tsp::classify_push_failure("git_push_failed: remote rejected (pre-receive hook declined)"),
        Some("push_failed"),
    );
    // Unrelated failure reason must NOT classify as a push failure.
    assert_eq!(
        tsp::classify_push_failure("syntax error in generated code"),
        None,
    );
}

#[test]
fn consecutive_push_failures_emit_project_push_stuck_exactly_once() {
    // Bump well past the threshold; exactly one emission should land,
    // regardless of how many failures we pile on in the same streak.
    let threshold = tsp::consecutive_push_failures_stuck_threshold();
    let n = threshold + 5;
    let emissions = tsp::bump_project_push_failures_streak(n);
    assert_eq!(emissions.len() as u32, n);
    let emitted = emissions.iter().filter(|b| **b).count();
    assert_eq!(
        emitted, 1,
        "project_push_stuck must be emitted exactly once per streak, got {} across {} failures",
        emitted, n
    );
    // The emission must happen at the threshold boundary, not earlier.
    let first_true = emissions.iter().position(|b| *b).expect("one true");
    assert_eq!(
        first_true as u32 + 1,
        threshold,
        "emission must land exactly at the thresholdâth failure, not earlier"
    );
}

#[test]
fn reset_rearms_project_push_stuck_for_next_streak() {
    // After a successful push (simulated by resetting the counter),
    // a fresh streak must be able to emit `project_push_stuck` again.
    assert!(
        tsp::push_failure_reset_rearms_stuck_emission(),
        "reset_project_push_failures must re-arm the one-shot guard"
    );
}
