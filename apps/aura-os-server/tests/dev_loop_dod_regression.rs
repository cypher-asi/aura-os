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
            tsp::is_empty_path_write_event("tool_call_snapshot", &ev),
            "{name} with empty path must be flagged"
        );
    }
}

#[test]
fn empty_path_write_event_is_detected_when_path_is_missing() {
    let ev = json!({ "name": "write_file", "input": {} });
    assert!(
        tsp::is_empty_path_write_event("tool_call_snapshot", &ev),
        "write_file with no path key must be flagged"
    );
}

#[test]
fn empty_path_write_event_ignores_unrelated_tools() {
    let ev = json!({ "name": "run_command", "input": { "cmd": "ls" } });
    assert!(!tsp::is_empty_path_write_event("tool_call_snapshot", &ev));
}

#[test]
fn empty_path_write_event_accepts_pathed_write() {
    let ev = json!({
        "name": "write_file",
        "input": { "path": "crates/foo/src/lib.rs" }
    });
    assert!(!tsp::is_empty_path_write_event("tool_call_snapshot", &ev));
}

#[test]
fn completion_gate_rejects_any_empty_path_write_even_with_full_evidence() {
    // A task with *all* the usual DoD artefacts still fails the moment
    // it emits a single empty-path write — the rollback path is the
    // only way to force the automaton to retry with a real path.
    let reason = tsp::completion_validation_reason_with_empty_path_writes(
        "implementation complete",
        &["crates/zero-program/src/lib.rs"],
        /* build */ 1,
        /* test */ 1,
        /* fmt */ 1,
        /* clippy */ 1,
        /* empty-path writes */ 1,
    )
    .expect("empty-path write must fail the DoD gate");
    assert!(
        reason.contains("empty") || reason.contains("path"),
        "rejection reason must name the empty-path failure mode, got: {reason}"
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
///
/// The automaton in that run *did* retry — a `write_file` with no
/// input was immediately followed by a `write_file` to
/// `crates/zero-identity/src/secret.rs`, and later an `edit_file`
/// misfire was reconciled by an `edit_file` against
/// `crates/zero-identity/src/types.rs`. The old gate implementation
/// held a monotonic counter, so `task_done` was rejected even though
/// every actual file edit landed. This test replays the exact shape
/// and pins the new behaviour: a misfire that is reconciled by a
/// subsequent pathed completion does not poison the gate.
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
        "2.1 replay: misfires that were reconciled by a subsequent pathed write must not fail the gate, got rejection: {reason:?}"
    );
}

/// Companion to [`task_21_empty_path_misfire_then_retry_passes_the_gate`]:
/// if the automaton emits an empty-path write and *never* recovers
/// (no subsequent pathed completion), the gate must still fail —
/// otherwise the rollback path that forces a real retry disappears.
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
