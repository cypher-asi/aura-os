//! Failure-class detectors used by the retry ladder and remediation router.

use super::FAILURE_REASON;

#[test]
fn classify_failure_recognizes_needs_decomposition_reason() {
    assert!(
        aura_os_server::phase7_test_support::is_truncation_failure(FAILURE_REASON),
        "Phase 2b-style reason string must classify as Truncation so \
         try_remediate_task_failure enters the remediation path",
    );
    assert!(
        !aura_os_server::phase7_test_support::is_truncation_failure(
            "tool execution failed: ENETUNREACH"
        ),
        "transport-level errors must not be auto-decomposed",
    );
}

#[test]
fn classify_push_timeout_as_post_commit_infra_not_truncation() {
    let reason = "git_commit_push timed out while waiting for git push to origin";
    assert!(
        aura_os_server::phase7_test_support::is_git_push_timeout_failure(reason),
        "push-leg timeouts must route to the non-fatal post-commit infra path",
    );
    assert!(
        !aura_os_server::phase7_test_support::is_truncation_failure(reason),
        "push timeouts must not burn truncation-remediation budget",
    );
}

#[test]
fn classify_stream_terminated_internal_as_provider_internal_error() {
    for reason in [
        "LLM error: stream terminated with error: Internal server error",
        "LLM error: HTTP 500 from provider",
        "upstream returned 502 Bad Gateway",
        "connection reset by peer while streaming",
    ] {
        assert!(
            aura_os_server::phase7_test_support::is_provider_internal_error(reason),
            "{reason:?} must classify as ProviderInternalError so Axis 3's \
             jittered escalation path runs instead of terminating the task",
        );
    }

    for reason in [
        "task reached implementation phase but no file operations completed — needs decomposition",
        "HTTP 429 too many requests",
    ] {
        assert!(
            !aura_os_server::phase7_test_support::is_provider_internal_error(reason),
            "{reason:?} is not a 5xx/stream-abort and must stay on its own \
             failure path",
        );
    }
}

#[test]
fn looks_like_unclassified_transient_detects_retry_miss_candidates() {
    for reason in [
        "dns lookup failed for api.example.com",
        "tls handshake failure while streaming response",
        "socket hang up",
    ] {
        assert!(
            aura_os_server::phase7_test_support::looks_like_unclassified_transient(reason),
            "{reason:?} looks transient but isn't classified — dev loop \
             must emit debug.retry_miss so the gap is visible in bundles",
        );
    }

    for reason in [
        "LLM error: stream terminated with error: Internal server error",
        "task reached implementation phase but no file operations completed — needs decomposition",
    ] {
        assert!(
            !aura_os_server::phase7_test_support::looks_like_unclassified_transient(reason),
            "{reason:?} is either already classified or not transient — \
             must not produce a spurious debug.retry_miss",
        );
    }
}
