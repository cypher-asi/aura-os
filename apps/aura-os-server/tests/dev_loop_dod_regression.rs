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
//! 2. **Empty-path write tracking** — a `write_file` / `edit_file`
//!    tool call with a blank or missing `path` is classified as an
//!    empty-path write for diagnostics, without letting aura-os reject
//!    a harness terminal event.
//! 3. **Harness-owned verification** — a run that edited source but
//!    lacks local build/test/fmt/clippy counters is still accepted by
//!    aura-os; the harness owns Definition-of-Done.
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

// ---------------------------------------------------------------------------
// task_done no-change contract
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Missing verification evidence
// ---------------------------------------------------------------------------

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
// Harness-owned Definition-of-Done
// ---------------------------------------------------------------------------

#[test]
fn tool_call_failures_are_diagnostic_history_not_aura_os_dod_failures() {
    let reason = tsp::completion_validation_reason_with_tool_call_failures(
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
    );

    assert!(
        reason.is_none(),
        "aura-os must not convert harness tool failures into server-owned DoD rejection"
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
fn insufficient_credits_reason_is_terminal_not_retryable() {
    let reason = "agent execution error: LLM error: kernel reason_streaming error: reasoner error: Insufficient credits: Anthropic API error: 402 Payment Required - {\"error\":{\"code\":\"INSUFFICIENT_CREDITS\",\"message\":\"Insufficient credits: balance=4, required=5\"}}";
    assert!(
        tsp::is_insufficient_credits_failure(reason),
        "exact provider 402 insufficient-credits reason must be classified"
    );
    assert!(
        !tsp::tool_call_failed_should_retry(reason, 0),
        "credits exhaustion must stop the loop instead of entering infra retry"
    );
    assert!(
        !tsp::should_restart_on_error_event(reason),
        "credits exhaustion must not restart the automaton"
    );
}

#[test]
fn insufficient_credits_classifier_covers_api_code_forms() {
    for reason in [
        "upstream returned payment_required",
        "body code=insufficient_credits",
        "402 Payment Required",
        "Insufficient credits: balance=0",
    ] {
        assert!(
            tsp::is_insufficient_credits_failure(reason),
            "credits classifier missed '{reason}'"
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
// Retired aura-os DoD remediation retry surface
// ---------------------------------------------------------------------------

#[test]
fn dod_classifier_is_inert_because_harness_owns_remediation() {
    for reason in [
        "Task modified source code but no build/compile step was run",
        "Task modified source code but no test step was run",
        "Task modified source code but no format check was run",
        "Task modified source code but no lint check was run",
        "run_command is denied by harness command policy",
    ] {
        assert_eq!(
            tsp::classify_dod_remediation_kind(reason),
            None,
            "aura-os must not classify harness DoD remediation reason: {reason}"
        );
    }
}

#[test]
fn task_done_no_file_reason_is_completion_contract_not_truncation() {
    let reason = "ERROR: You are completing this task but have not made any file changes \
                  (write_file, edit_file, or delete_file). Implementation tasks must produce \
                  file changes. If this task genuinely requires no file changes, call \
                  task_done again with \"no_changes_needed\": true and explain why in the \
                  notes field.";

    assert!(
        tsp::is_completion_contract_failure(reason),
        "task_done no-file failures should be labeled as completion-contract errors"
    );
    assert!(
        !tsp::is_truncation_failure(reason),
        "task_done no-file failures must not trigger truncation decomposition"
    );
}

#[test]
fn completion_contract_failure_reconciles_to_terminal_reason() {
    let decision = tsp::reconcile_decision(&[], "completion_contract", 0, 3, false, false);

    assert_eq!(
        decision,
        json!({
            "action": "mark_terminal",
            "reason": "completion_contract",
        }),
        "missing file-edit evidence is an agent/tool contract failure, not a decomposition candidate"
    );
}

#[test]
fn dod_followup_prompt_and_retry_budget_are_retired() {
    assert!(tsp::build_dod_followup_prompt(
        "missing_test",
        1,
        "Task modified source code but no test step was run"
    )
    .is_none());
    assert_eq!(
        tsp::max_dod_retries_per_task(),
        0,
        "aura-os must not retry harness-owned DoD failures"
    );
}
