//! Completion / recovery / restart gate decisions.

use serde_json::json;

#[test]
fn completion_validation_defers_unverified_source_changes_to_harness() {
    let reason = aura_os_server::phase7_test_support::completion_validation_reason(
        "edited source",
        &["src/lib.rs"],
        0,
        0,
        0,
        0,
    );
    assert!(
        reason.is_none(),
        "aura-os should not reject source changes using local verification counters",
    );
}

#[test]
fn recovery_checkpoint_marks_commit_created_when_push_fails() {
    let git_steps = vec![
        json!({"type": "git_committed", "commit_sha": "abc123"}),
        json!({"type": "git_push_failed", "reason": "timeout"}),
    ];
    assert_eq!(
        aura_os_server::phase7_test_support::recovery_checkpoint(
            "implementation completed",
            &["src/lib.rs"],
            &git_steps,
        ),
        "commit_created",
        "post-commit push failures should preserve the durable local-work checkpoint",
    );
}

#[test]
fn completion_gate_failure_routes_tracked_transient_reason_to_retry() {
    let gate_reason =
        "Automaton reported task_completed without output, file changes, or verification evidence";
    let transient_reason = "LLM error: stream terminated with error: Internal server error";

    assert!(
        !aura_os_server::phase7_test_support::is_provider_internal_error(gate_reason),
        "gate reason must NOT look like an infra transient on its own — \
         otherwise the fix is load-bearing on the classifier rather than \
         on the `last_transient_reason` breadcrumb",
    );
    assert!(
        aura_os_server::phase7_test_support::is_provider_internal_error(transient_reason),
        "pre-completion `error` reason must classify as ProviderInternalError \
         so the gate-failure branch's retry ladder fires on a tracked breadcrumb",
    );
}

#[test]
fn error_event_gate_matrix_restart_only_on_actual_transients() {
    let cases: &[(&str, bool, &str)] = &[
        (
            "CRITICAL: All tool calls have returned errors for 5 consecutive \
             iterations. The agent appears stuck. Stopping to prevent waste.",
            false,
            "verbatim incident reason — terminal agent-stuck signal",
        ),
        (
            "CRITICAL: Agent is stuck after provider error. Stopping.",
            false,
            "agent-stuck + provider-error overlap must still be treated as \
             terminal; the harness already gave up",
        ),
        (
            "LLM error: stream terminated with error: Internal server error",
            true,
            "provider 5xx / stream abort — must restart",
        ),
        (
            "rate limited: 429 too many requests",
            true,
            "provider rate limit — must restart after cooldown",
        ),
        (
            "git push timed out after 60s",
            true,
            "git push timeout — must restart (push is retried by the harness)",
        ),
        (
            "tls handshake failure while streaming response",
            true,
            "unclassified transient (TLS) — must still restart via the \
             `looks_like_unclassified_transient` safety net",
        ),
        (
            "socket hang up",
            true,
            "unclassified transient (socket) — safety net restart",
        ),
        (
            "write_file returned permission denied",
            false,
            "tool-level error — deterministic, restart is pure waste",
        ),
        (
            "compile error: cannot find type `Foo` in module `bar`",
            false,
            "compile error — deterministic, restart is pure waste",
        ),
        (
            "task reached implementation phase but no file operations completed",
            false,
            "decomposition hint — handled by remediation path, not by restart",
        ),
    ];

    for (reason, expected_restart, context) in cases {
        let actual = aura_os_server::phase7_test_support::should_restart_on_error_event(reason);
        assert_eq!(
            actual, *expected_restart,
            "should_restart_on_error_event({reason:?}) returned {actual}, \
             expected {expected_restart} — {context}",
        );
    }
}
