//! Push-outcome vs task terminal status (Section 3 regression).
//!
//! Locks in the dev-loop invariant: push failures — whether a
//! GitPushTimeout, a RemoteStorageExhausted, or a generic git_push_failed
//! — MUST NOT demote a task from `done` to `failed` when the completion
//! gate otherwise passes. The completion gate owns terminal state; push is
//! best-effort infrastructure.

use aura_os_server::phase7_test_support as tsp;
use serde_json::json;

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
        "a harness-completed task must stay `done` even if git push timed out"
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
        "a harness-completed task must stay `done` even when the remote is out of storage"
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
        "a harness-completed task must stay `done` under any generic push failure"
    );
}

#[test]
fn harness_completion_with_commit_survives_push_timeout_even_without_local_evidence() {
    // The harness owns completion and the commit is the recovery anchor.
    // aura-os must not demote the task because its local verification
    // counters are empty.
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
        done,
        "a committed harness completion must stay done even when aura-os has no local DoD evidence"
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
fn classify_push_failure_recognises_real_orbit_enospc_reason() {
    // The user-visible reason string the harness actually emits when
    // orbit hits ENOSPC. Captured verbatim from a live incident so the
    // orbit capacity guard never silently drops classification for the
    // one pattern it is specifically built to handle.
    let reason = "Commit+push failed: remote storage exhausted on git push; \
                  free space on the remote or switch remotes. server reported: \
                  remote: fatal: write error: No space left on device \
                  error: remote unpack failed: index-pack abnormal exit \
                  error: RPC failed; curl 18 transfer closed with outstanding \
                  read data remaining Everything up-to-date";
    assert_eq!(
        tsp::classify_push_failure(reason),
        Some("remote_storage_exhausted"),
        "live orbit ENOSPC reason must classify as remote_storage_exhausted so \
         the OrbitCapacityGuard trips on it"
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
        "emission must land exactly at the threshold-th failure, not earlier"
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
