//! Table-driven tests for the classifier family.
//!
//! Each table pairs a representative provider/harness reason string
//! with the expected boolean / label. The tables stay small (each
//! row pulled from a real production trace or a regression suite
//! comment) so adding a new failure pattern is a one-line change.
//!
//! These tests mirror the integration-test surface in
//! `apps/aura-os-server/tests/autonomous_recovery_replay/` but run
//! without the server, so a regression in the pure classifiers fails
//! fast at `cargo test -p aura-os-automation`.

use super::push::classify_push_failure;
use super::restart::{
    classify_restart_reason, should_restart_on_error, tool_call_failed_should_retry,
};
use super::transient::{
    is_agent_stuck_terminal_signal, is_git_push_timeout, is_insufficient_credits,
    is_provider_internal, is_rate_limited, looks_like_unclassified_transient,
};
use crate::budget::TOOL_CALL_RETRY_BUDGET;

#[test]
fn rate_limited_recognises_common_provider_phrasings() {
    let positives = [
        "rate limit exceeded",
        "rate_limited",
        "overloaded_error",
        "HTTP 429 Too Many Requests",
        "got 529 from upstream",
    ];
    for reason in positives {
        assert!(is_rate_limited(reason), "expected rate_limited: {reason}");
    }
    for reason in ["completion contract failure", "no_changes_needed"] {
        assert!(
            !is_rate_limited(reason),
            "must not be rate_limited: {reason}"
        );
    }
}

#[test]
fn insufficient_credits_recognises_402_payments() {
    let positives = [
        "Insufficient credits",
        "insufficient_credits",
        "payment_required",
        "402 payment required",
    ];
    for reason in positives {
        assert!(
            is_insufficient_credits(reason),
            "expected insufficient_credits: {reason}",
        );
    }
    assert!(!is_insufficient_credits("rate limit"));
}

#[test]
fn provider_internal_recognises_5xx_and_stream_aborts() {
    let positives = [
        "Internal server error",
        "upstream returned 500",
        "got 502 bad gateway",
        "upstream 503 service unavailable",
        "upstream 504 gateway timeout",
        "stream terminated unexpectedly",
        "connection reset by peer",
    ];
    for reason in positives {
        assert!(
            is_provider_internal(reason),
            "expected provider_internal: {reason}",
        );
    }
    assert!(!is_provider_internal("rate limit"));
}

#[test]
fn git_push_timeout_requires_push_and_timeout_tokens() {
    assert!(is_git_push_timeout(
        "git push orbit HEAD:main: timed out after 60s"
    ));
    assert!(is_git_push_timeout("git push timeout"));
    assert!(!is_git_push_timeout("cargo test timed out"));
    assert!(!is_git_push_timeout("git pull failed"));
}

#[test]
fn unclassified_transient_excludes_rate_and_internal() {
    let transient = [
        "dns lookup failed",
        "tls handshake error",
        "socket hang up",
        "service unavailable upstream",
        "please try again later",
        "operation timeout exceeded",
    ];
    for reason in transient {
        assert!(
            looks_like_unclassified_transient(reason),
            "expected unclassified transient: {reason}",
        );
    }
    assert!(
        !looks_like_unclassified_transient("rate limit exceeded"),
        "rate_limited reasons must take precedence",
    );
    assert!(
        !looks_like_unclassified_transient("internal server error"),
        "provider_internal reasons must take precedence",
    );
}

#[test]
fn agent_stuck_signals_match_harness_anti_waste_phrasings() {
    let stuck = [
        "agent appears stuck — no progress",
        "agent is stuck after consecutive errors",
        "10 consecutive errors observed",
        "stopping to prevent waste",
        "halting to conserve budget",
        "all tool calls have returned errors",
    ];
    for reason in stuck {
        assert!(
            is_agent_stuck_terminal_signal(reason),
            "expected agent_stuck: {reason}",
        );
    }
    assert!(!is_agent_stuck_terminal_signal("rate limit"));
}

#[test]
fn classify_restart_reason_returns_stable_labels() {
    let rows: &[(&str, Option<&str>)] = &[
        ("rate limit exceeded", Some("rate_limited")),
        (
            "upstream 500 internal server error",
            Some("provider_internal"),
        ),
        (
            "git push orbit HEAD:main: timed out after 60s",
            Some("git_push_timeout"),
        ),
        ("socket hang up", Some("transient")),
        ("agent appears stuck", None),
        ("syntax error in generated code", None),
    ];
    for (reason, expected) in rows {
        assert_eq!(
            classify_restart_reason(reason),
            *expected,
            "classify_restart_reason({reason:?})",
        );
    }
}

#[test]
fn should_restart_aligns_with_classify_restart_reason() {
    let reasons = [
        "rate limit",
        "internal server error",
        "agent is stuck",
        "syntax error",
        "git push timed out",
    ];
    for reason in reasons {
        assert_eq!(
            should_restart_on_error(reason),
            classify_restart_reason(reason).is_some(),
            "gate must mirror classifier for {reason:?}",
        );
    }
}

#[test]
fn tool_call_retry_respects_budget_and_classifier() {
    let reason = "rate limit exceeded";
    assert!(tool_call_failed_should_retry(reason, 0));
    assert!(tool_call_failed_should_retry(
        reason,
        TOOL_CALL_RETRY_BUDGET - 1
    ));
    assert!(!tool_call_failed_should_retry(
        reason,
        TOOL_CALL_RETRY_BUDGET
    ));
    assert!(!tool_call_failed_should_retry(reason, u32::MAX));

    let terminal = "syntax error in generated code";
    assert!(
        !tool_call_failed_should_retry(terminal, 0),
        "non-transient reasons must not retry",
    );

    let stuck = "agent is stuck after consecutive errors";
    assert!(
        !tool_call_failed_should_retry(stuck, 0),
        "agent-stuck signals must not retry",
    );
}

#[test]
fn classify_push_failure_returns_subclass_labels() {
    assert_eq!(
        classify_push_failure("git push orbit HEAD:main: timed out after 60s"),
        Some("push_timeout"),
    );
    assert_eq!(
        classify_push_failure("remote: error: No space left on device"),
        Some("remote_storage_exhausted"),
    );
    assert_eq!(
        classify_push_failure("git_push_failed: remote rejected (pre-receive hook declined)"),
        Some("push_failed"),
    );
    assert_eq!(
        classify_push_failure("syntax error in generated code"),
        None,
        "non-push reasons must not classify",
    );
}
