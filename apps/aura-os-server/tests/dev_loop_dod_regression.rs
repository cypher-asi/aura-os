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

// ---------------------------------------------------------------------------
// DoD gate: specific diagnostic for kernel-policy-denied `run_command`.
// `run_command` is on by default now, so this fires only when the
// harness is deliberately locked down (`AURA_STRICT_MODE=1` /
// `ENABLE_CMD_TOOLS=false`). The gate should surface that root cause
// instead of the misleading "no build step was run" message.
// ---------------------------------------------------------------------------

#[test]
fn gate_emits_policy_denial_diagnostic_when_run_command_denied() {
    // Rust source change, no build steps (because every `run_command`
    // was denied), and a tool_call_failures entry with the real reason.
    let reason = tsp::completion_validation_reason_with_tool_call_failures(
        "edited one Rust file",
        &["apps/aura-os-server/src/lib.rs"],
        0, // build steps
        0, // test steps
        0, // format steps
        0, // lint steps
        0, // empty-path writes
        &[(
            "run_command",
            "Tool 'run_command' is not allowed by the active policy",
        )],
    )
    .expect("gate should fire when no build step ran");

    assert!(
        reason.contains("run_command is denied by kernel policy"),
        "expected kernel-policy-denial diagnostic, got: {reason}"
    );
    assert!(
        reason.contains("AURA_STRICT_MODE=1") && reason.contains("ENABLE_CMD_TOOLS=false"),
        "diagnostic must name both lock-down knobs so the operator knows which to flip, got: {reason}"
    );
    assert!(
        !reason.contains("no build/compile step was run"),
        "policy-denial diagnostic must replace the generic no-build message, got: {reason}"
    );
}

#[test]
fn gate_emits_generic_no_build_when_no_policy_denial() {
    // Same synthetic run, but no tool_call_failures history: falls
    // through to the generic "no build" DoD message.
    let reason = tsp::completion_validation_reason_with_tool_call_failures(
        "edited one Rust file",
        &["apps/aura-os-server/src/lib.rs"],
        0,
        0,
        0,
        0,
        0,
        &[],
    )
    .expect("gate should still fire on a Rust edit with no build step");

    assert!(
        reason.contains("no build/compile step was run"),
        "expected generic no-build message when policy denial is absent, got: {reason}"
    );
    assert!(
        !reason.contains("run_command is denied by kernel policy"),
        "policy-denial diagnostic must not fire without a matching tool_call_failures entry, got: {reason}"
    );
}

// ---------------------------------------------------------------------------
// DoD gate: kernel-policy-denial diagnostic must cover ALL four DoD axes
// (build, test, fmt, lint), not just missing-build. Motivating incident:
// task 1.0 "Initialise Rust workspace" (409fa99a-274b-4cea-88ef-23cbc506ce93)
// where `run_command` was denied with the newer `requires allow_shell=true`
// string, `build_steps` was nonzero (auto-triggered signal), and the gate
// rejected at `!has_test`. The DoD retry tier then treated the generic
// "no test step was run" message as retryable and burned two retries
// against a wall no reprompt could move.
// ---------------------------------------------------------------------------

#[test]
fn gate_emits_policy_denial_for_missing_test_when_run_command_denied() {
    // Build=1 but test=0 with a run_command denial. The incident path:
    // the harness surfaced auto-triggered build evidence so the gate
    // sailed past `!has_build`, then rejected at `!has_test`. The
    // upgrade must still fire because the *underlying* cause is the
    // same harness lock-down, not a forgetful agent.
    let reason = tsp::completion_validation_reason_with_tool_call_failures(
        "edited one Rust file",
        &["apps/aura-os-server/src/lib.rs"],
        /* build */ 1,
        /* test */ 0,
        /* fmt */ 0,
        /* lint */ 0,
        0,
        &[(
            "run_command",
            "Tool 'run_command' is not allowed by the active policy",
        )],
    )
    .expect("gate should fire when test axis is missing");

    assert!(
        reason.contains("run_command is denied by kernel policy"),
        "expected kernel-policy-denial diagnostic at the test axis, got: {reason}"
    );
    assert!(
        !reason.contains("no test step was run"),
        "policy-denial must replace the generic no-test message, got: {reason}"
    );
}

#[test]
fn gate_emits_policy_denial_for_missing_fmt_when_run_command_denied() {
    // Rust change, build + test satisfied, fmt axis missing. The
    // pre-fix gate would have emitted the generic no-fmt message and
    // the retry tier would have classified it as `missing_fmt` and
    // retried — uselessly, because run_command is denied.
    let reason = tsp::completion_validation_reason_with_tool_call_failures(
        "edited one Rust file",
        &["apps/aura-os-server/src/lib.rs"],
        /* build */ 1,
        /* test */ 1,
        /* fmt */ 0,
        /* lint */ 1,
        0,
        &[(
            "run_command",
            "Tool 'run_command' is not allowed by the active policy",
        )],
    )
    .expect("gate should fire when fmt axis is missing");

    assert!(
        reason.contains("run_command is denied by kernel policy"),
        "expected kernel-policy-denial diagnostic at the fmt axis, got: {reason}"
    );
    assert!(
        !reason.contains("no format check was run"),
        "policy-denial must replace the generic no-fmt message, got: {reason}"
    );
}

#[test]
fn gate_emits_policy_denial_for_missing_lint_when_run_command_denied() {
    // Rust change, all axes but lint satisfied. Same reasoning as the
    // fmt case above.
    let reason = tsp::completion_validation_reason_with_tool_call_failures(
        "edited one Rust file",
        &["apps/aura-os-server/src/lib.rs"],
        /* build */ 1,
        /* test */ 1,
        /* fmt */ 1,
        /* lint */ 0,
        0,
        &[(
            "run_command",
            "Tool 'run_command' is not allowed by the active policy",
        )],
    )
    .expect("gate should fire when lint axis is missing");

    assert!(
        reason.contains("run_command is denied by kernel policy"),
        "expected kernel-policy-denial diagnostic at the lint axis, got: {reason}"
    );
    assert!(
        !reason.contains("no lint check was run"),
        "policy-denial must replace the generic no-lint message, got: {reason}"
    );
}

#[test]
fn gate_recognises_requires_allow_shell_as_policy_denial() {
    // The exact denial string the harness emitted during task 1.0
    // "Initialise Rust workspace" — captured verbatim so a future
    // change to the denial wording here is caught immediately.
    // The pre-fix gate's substring match ("is not allowed") missed
    // this entirely and let the generic no-test message through.
    let reason = tsp::completion_validation_reason_with_tool_call_failures(
        "edited one Rust file",
        &["zero-sdk/src/lib.rs"],
        /* build */ 4,
        /* test */ 0,
        /* fmt */ 0,
        /* lint */ 0,
        0,
        &[(
            "run_command",
            "'shell_script' requires allow_shell=true (per-call or in ToolConfig)",
        )],
    )
    .expect("gate should fire — build satisfied but test axis still missing");

    assert!(
        reason.contains("run_command is denied by kernel policy"),
        "requires-allow_shell denial must still surface the policy-denial diagnostic, got: {reason}"
    );
}

#[test]
fn dod_classifier_rejects_policy_denial_triggered_at_non_build_axis() {
    // End-to-end pin: when the gate emits the policy-denial reason
    // because the *test* axis failed (not just build), the DoD retry
    // classifier must still return None so the retry tier doesn't
    // burn attempts against the lock-down.
    let reason = tsp::completion_validation_reason_with_tool_call_failures(
        "edited one Rust file",
        &["zero-sdk/src/lib.rs"],
        /* build */ 1,
        /* test */ 0,
        /* fmt */ 0,
        /* lint */ 0,
        0,
        &[(
            "run_command",
            "'shell_script' requires allow_shell=true (per-call or in ToolConfig)",
        )],
    )
    .expect("policy-denied test-axis failure must fail the gate");
    assert_eq!(
        tsp::classify_dod_remediation_kind(&reason),
        None,
        "policy-denial reason (test axis) must not classify as DoD remediation; got: {reason}"
    );
}

// ---------------------------------------------------------------------------
// Per-tool-call infra-retry budget (server-retry-budget)
// ---------------------------------------------------------------------------
//
// The harness emits `tool_call_failed` once its own streaming-retry
// budget of 8 is exhausted (harness-retry-streaming, commit 9174501).
// The server forwarder then routes the event through
// `attempt_infra_retry` to buy one more fresh streaming request
// against the provider, capped per task at TOOL_CALL_RETRY_BUDGET.
// These tests pin:
//   1. the classifier wiring (only infra-transient reasons retry),
//   2. the budget constant (must stay at 8 to mirror the harness),
//   3. the counter monotonicity (8+1 must NOT retry).
//
// They do not replay the full forwarder — the live retry path needs
// a running automaton/task service — but they do lock in the gate
// that the forwarder consults before dispatching.

#[test]
fn tool_call_retry_budget_is_eight_and_matches_harness_retry_count() {
    // Harness emits `tool_call_failed` only after its internal
    // retry-with-backoff loop (default 8 attempts) runs out, so the
    // server-side budget should match to keep the worst-case
    // recovery ladder symmetric at 8 × 8 = 64 total provider
    // attempts. Changing this number is a wire-contract break and
    // must be coordinated with the harness side.
    assert_eq!(
        tsp::tool_call_retry_budget(),
        8,
        "TOOL_CALL_RETRY_BUDGET must stay aligned with aura-harness's streaming-retry budget"
    );
}

#[test]
fn provider_internal_error_triggers_tool_call_retry_when_under_budget() {
    // This is the exact reason string the reasoner emits when
    // Anthropic sends `stream terminated with error: Internal server
    // error` mid-`tool_use` — the motivating 4.6-class failure.
    let reason = "LLM error: stream terminated with error: Internal server error";
    assert!(
        tsp::tool_call_failed_should_retry(reason, 0),
        "first tool_call_failed with ProviderInternalError reason must retry"
    );
    assert!(
        tsp::tool_call_failed_should_retry(reason, 7),
        "7th prior retry must still be under budget (budget=8)"
    );
}

#[test]
fn rate_limit_reason_triggers_tool_call_retry() {
    // HTTP 429 and 529 both classify as `ProviderRateLimited`; the
    // forwarder must route both through the retry gate so a
    // temporary cooldown doesn't terminate the task.
    for reason in [
        "Anthropic 429 Too Many Requests",
        "upstream provider returned 529 overloaded",
    ] {
        assert!(
            tsp::tool_call_failed_should_retry(reason, 0),
            "rate-limit reason '{reason}' must retry"
        );
    }
}

#[test]
fn budget_exhaustion_stops_tool_call_retry_even_for_transient_reason() {
    // Once the per-task counter hits the budget the forwarder must
    // let the event fall through to the normal task_failed path,
    // even if the reason is classifier-positive — otherwise a
    // permanently-broken upstream would loop the task forever.
    let reason = "LLM error: stream terminated with error: Internal server error";
    let budget = tsp::tool_call_retry_budget();
    assert!(
        !tsp::tool_call_failed_should_retry(reason, budget),
        "prior_count == budget must NOT retry"
    );
    assert!(
        !tsp::tool_call_failed_should_retry(reason, budget + 1),
        "prior_count > budget must NOT retry"
    );
    assert!(
        !tsp::tool_call_failed_should_retry(reason, u32::MAX),
        "saturated counter must NOT retry"
    );
}

#[test]
fn non_transient_reason_never_triggers_tool_call_retry() {
    // Compile errors / syntax errors / kernel-policy denials are
    // deterministic; retrying them just wastes a provider call and
    // delays the task_failed surface.
    for reason in [
        "syntax error in generated code",
        "run_command tool is not allowed by kernel policy",
        "write_file: Permission denied (os error 13)",
        "",
    ] {
        assert!(
            !tsp::tool_call_failed_should_retry(reason, 0),
            "non-transient reason '{reason}' must NOT retry"
        );
    }
}

#[test]
fn push_timeout_reason_is_eligible_for_tool_call_retry() {
    // `git push` timeouts are classified as infra (see
    // `InfraFailureClass::GitPushTimeout`) and retried by the
    // error/task_failed paths; tool_call_failed for the same class
    // must line up so a push-during-tool-call is not treated
    // differently.
    assert!(
        tsp::tool_call_failed_should_retry("git push orbit HEAD:main: timed out after 60s", 0),
        "git push timeout reason must retry"
    );
}

// ---------------------------------------------------------------------------
// DoD remediation retry — classifier + follow-up prompt
//
// Pins the behaviour introduced after task 4.5 ("Implement incoming
// message handler", id a96689c0-a0e1-472b-a9e8-288402854f9a) failed
// because the agent emitted `task_done` without running `cargo build`.
// The gate correctly rejected the completion, but there was no retry
// tier between the infra-transient ladder and terminal failure, so the
// task transitioned straight to `failed` despite the fix being a
// single verification command away. The DoD retry tier closes that gap
// by re-engaging the agent with a targeted follow-up prompt.
// ---------------------------------------------------------------------------

#[test]
fn dod_classifier_maps_missing_build_reason() {
    // Exact reason string the gate emits for a source change without
    // a build step. The 4.5 regression depended on this bucket.
    let reason = tsp::completion_validation_reason(
        "implementation complete",
        &["crates/zero-sdk/src/messaging/direct/handler.rs"],
        /* build */ 0,
        /* test */ 1,
        /* fmt */ 1,
        /* clippy */ 1,
    )
    .expect("source change without build must fail the gate");
    assert_eq!(
        tsp::classify_dod_remediation_kind(&reason),
        Some("missing_build"),
        "a `no build step` reason must map to missing_build; got: {reason}"
    );
}

#[test]
fn dod_classifier_maps_missing_test_reason() {
    let reason = tsp::completion_validation_reason(
        "implementation complete",
        &["crates/zero-sdk/src/messaging/direct/handler.rs"],
        1,
        0,
        1,
        1,
    )
    .expect("source change without test must fail the gate");
    assert_eq!(
        tsp::classify_dod_remediation_kind(&reason),
        Some("missing_test"),
        "a `no test step` reason must map to missing_test; got: {reason}"
    );
}

#[test]
fn dod_classifier_maps_missing_fmt_and_lint_reasons() {
    let no_fmt = tsp::completion_validation_reason(
        "implementation complete",
        &["crates/zero-sdk/src/messaging/direct/handler.rs"],
        1,
        1,
        0,
        1,
    )
    .expect("Rust edit without fmt must fail the gate");
    assert_eq!(
        tsp::classify_dod_remediation_kind(&no_fmt),
        Some("missing_fmt"),
    );

    let no_lint = tsp::completion_validation_reason(
        "implementation complete",
        &["crates/zero-sdk/src/messaging/direct/handler.rs"],
        1,
        1,
        1,
        0,
    )
    .expect("Rust edit without clippy must fail the gate");
    assert_eq!(
        tsp::classify_dod_remediation_kind(&no_lint),
        Some("missing_lint"),
    );
}

#[test]
fn dod_classifier_rejects_non_remediable_reasons() {
    // Unrecovered empty-path writes and baseline "no activity"
    // failures are structural — another turn with the same agent
    // won't fix them. They must fall through to terminal handling,
    // not bounce through the DoD retry tier.
    let empty_path = tsp::completion_validation_reason_with_empty_path_writes(
        "",
        &[],
        1,
        1,
        1,
        1,
        /* empty-path writes */ 2,
    )
    .expect("unrecovered empty-path writes must fail the gate");
    assert_eq!(
        tsp::classify_dod_remediation_kind(&empty_path),
        None,
        "empty-path-write reasons must not classify as DoD remediation; got: {empty_path}"
    );

    let baseline = tsp::completion_validation_reason("", &[], 0, 0, 0, 0)
        .expect("baseline no-activity must fail the gate");
    assert_eq!(
        tsp::classify_dod_remediation_kind(&baseline),
        None,
        "baseline activity reasons must not classify as DoD remediation; got: {baseline}"
    );

    // The `run_command` kernel-policy-denial upgrade is also not
    // retryable: another turn hits the same policy wall.
    let policy = tsp::completion_validation_reason_with_tool_call_failures(
        "edited one Rust file",
        &["apps/aura-os-server/src/lib.rs"],
        0,
        0,
        0,
        0,
        0,
        &[(
            "run_command",
            "Tool 'run_command' is not allowed by the active policy",
        )],
    )
    .expect("policy-denied run must fail the gate");
    assert_eq!(
        tsp::classify_dod_remediation_kind(&policy),
        None,
        "policy-denial reasons must not classify as DoD remediation; got: {policy}"
    );
}

#[test]
fn dod_followup_prompt_echoes_gate_reason_verbatim() {
    // The gate's own reason string is the authoritative piece of
    // feedback: it already names the canonical command ("cargo build
    // or equivalent must pass" on the Rust path, etc.) and was written
    // by the gate author with language neutrality in mind. The retry
    // follow-up must carry that text forward so the agent sees the
    // exact rejection it has to address.
    let reason = tsp::completion_validation_reason(
        "implementation complete",
        &["crates/zero-sdk/src/messaging/direct/handler.rs"],
        0,
        1,
        1,
        1,
    )
    .expect("source change without build must fail the gate");
    let prompt = tsp::build_dod_followup_prompt("missing_build", 1, &reason)
        .expect("known kind must return a prompt");
    // Pick a distinctive substring from the reason so a cosmetic
    // tweak to the prompt scaffolding doesn't silently drop the
    // passthrough.
    let needle = "no build/compile step was run";
    assert!(
        prompt.contains(needle),
        "prompt must echo the gate reason substring `{needle}`; got: {prompt}"
    );
}

#[test]
fn dod_followup_prompt_does_not_hardcode_cargo_for_non_rust_reasons() {
    // A TypeScript-only edit produces a gate reason that says "cargo
    // build or equivalent must pass" — still Rust-scented on the
    // "equivalent" clause, but not an instruction to run cargo in a
    // TS workspace. The retry prompt must not promote that hint into
    // a directive: we want the scaffolding text itself to stay
    // language-neutral and let the agent pick the workspace's real
    // command (pnpm, npm, make, etc.).
    //
    // Pass a previous reason that does NOT mention cargo at all to
    // simulate a future gate iteration with a fully language-neutral
    // message, and assert the scaffolding adds no cargo command of
    // its own.
    let prompt = tsp::build_dod_followup_prompt(
        "missing_build",
        1,
        "Task modified source code but no build/compile step was run",
    )
    .expect("known kind must return a prompt");
    // The scaffolding is allowed to list cargo as *one example* among
    // several tool chains, but must not tell the agent to run a
    // specific cargo command verbatim. Any of the canonical cargo
    // invocations appearing as a standalone directive would be a
    // regression.
    for forbidden in [
        "cargo build --workspace --all-targets",
        "cargo test --workspace --all-features",
        "cargo fmt --all -- --check",
        "cargo clippy --workspace --all-targets -- -D warnings",
    ] {
        assert!(
            !prompt.contains(forbidden),
            "prompt must not inject the cargo command `{forbidden}` when the gate reason \
             doesn't; got: {prompt}"
        );
    }
    // Positive assertion: the prompt should still tell the agent to
    // use `run_command` to re-run the missing step, just without
    // prescribing the binary.
    assert!(
        prompt.contains("run_command"),
        "prompt must instruct the agent to invoke the verification step via run_command; got: {prompt}"
    );
}

#[test]
fn dod_followup_prompt_names_the_missing_axis_in_prose() {
    // Each remediation kind must surface the axis label in prose so
    // UI consumers and the agent can tell at a glance which gate
    // check failed without having to parse the full reason. The axis
    // label is also encoded in the `[aura-dod-retry attempt=N axis=...]`
    // marker for machine consumption.
    let expectations = [
        ("missing_build", "build step"),
        ("missing_test", "test step"),
        ("missing_fmt", "format check"),
        ("missing_lint", "lint check"),
    ];
    for (kind, axis) in expectations {
        let prompt = tsp::build_dod_followup_prompt(kind, 2, "previous gate reason")
            .expect("known kind must return a prompt");
        assert!(
            prompt.contains(axis),
            "prompt for {kind} must name the axis `{axis}` in prose; got: {prompt}"
        );
        let marker = format!("[aura-dod-retry attempt=2 axis={kind}]");
        assert!(
            prompt.contains(&marker),
            "prompt must carry the stable marker `{marker}`; got: {prompt}"
        );
    }
}

#[test]
fn dod_followup_prompt_truncates_oversized_previous_reason() {
    // A pathological previous reason (e.g. a provider error dump)
    // must not bloat the prompt beyond a handful of lines. The
    // implementation caps the included reason and appends an ellipsis
    // so the prompt stays predictable across retries.
    let huge = "x".repeat(4096);
    let prompt = tsp::build_dod_followup_prompt("missing_build", 2, &huge)
        .expect("known kind must return a prompt");
    assert!(
        prompt.contains("…"),
        "oversized previous reason must be truncated with an ellipsis; got: {prompt}"
    );
    // Defensive upper bound: prompt stays well below 1 KB so it
    // doesn't eat the next turn's context budget. 900 is generous
    // given the fixed scaffolding is ~300 chars plus the 240-char
    // reason budget.
    assert!(
        prompt.len() < 900,
        "prompt must stay compact after truncation; got {} bytes",
        prompt.len()
    );
}

#[test]
fn dod_followup_prompt_rejects_unknown_kind_label() {
    // A typo in the kind label must surface as `None` instead of
    // silently producing a misleading prompt — the retry path relies
    // on the classifier returning a known variant.
    assert!(tsp::build_dod_followup_prompt("missing_foo", 1, "whatever").is_none());
}

#[test]
fn dod_retry_budget_is_positive_and_bounded() {
    // Pins the budget so an accidental zeroing silently disables the
    // whole retry tier, and so a runaway bump above 8 is caught too.
    let budget = tsp::max_dod_retries_per_task();
    assert!(
        budget > 0,
        "MAX_DOD_RETRIES_PER_TASK must be positive or the whole tier is dead"
    );
    assert!(
        budget <= 8,
        "MAX_DOD_RETRIES_PER_TASK must stay bounded to avoid runaway token spend; got {budget}"
    );
}
