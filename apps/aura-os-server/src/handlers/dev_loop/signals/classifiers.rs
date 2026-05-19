//! Thin wrappers that route the legacy `signals::*_for_tests` helpers
//! through `aura_os_automation`'s classifier family.
//!
//! Phase G1: the classifier family lives in `aura-os-automation`. These
//! thin wrappers preserve the server's `_for_tests` call sites
//! (adapter.rs, start.rs, side_effects.rs, credits.rs, preflight.rs,
//! the `phase7_test_support` re-exports, the dev-loop DoD regression
//! suite) without renaming any of them. They will be retired in a
//! later cleanup pass once every direct caller imports from
//! `aura_os_automation` directly.

pub(crate) fn auto_decompose_disabled() -> bool {
    std::env::var("AURA_AUTO_DECOMPOSE_DISABLED")
        .ok()
        .map(|value| {
            matches!(
                value.trim().to_ascii_lowercase().as_str(),
                "1" | "true" | "yes" | "on"
            )
        })
        .unwrap_or(false)
}

pub(crate) fn is_truncation_failure_for_tests(reason: &str) -> bool {
    let reason = reason.to_ascii_lowercase();
    !is_completion_contract_failure_reason(&reason)
        && (reason.contains("truncat")
            || reason.contains("max_tokens")
            || reason.contains("maximum tokens")
            || reason.contains("needsdecomposition")
            || reason.contains("needs decomposition"))
}

pub(crate) fn is_completion_contract_failure_for_tests(reason: &str) -> bool {
    is_completion_contract_failure_reason(&reason.to_ascii_lowercase())
}

fn is_completion_contract_failure_reason(reason: &str) -> bool {
    let mentions_task_done =
        reason.contains("task_done") || reason.contains("completing this task");
    let mentions_missing_edits = reason.contains("not made any file changes")
        || reason.contains("no file changes")
        || reason.contains("no files changed")
        || reason.contains("no file edited")
        || reason.contains("no file edits");
    let mentions_no_change_escape_hatch = reason.contains("no_changes_needed");

    mentions_task_done && (mentions_missing_edits || mentions_no_change_escape_hatch)
}

pub(crate) fn is_rate_limited_failure_for_tests(reason: &str) -> bool {
    aura_os_automation::is_rate_limited(reason)
}

pub(crate) fn is_insufficient_credits_failure_for_tests(reason: &str) -> bool {
    aura_os_automation::is_insufficient_credits(reason)
}

pub(crate) fn is_git_push_timeout_failure_for_tests(reason: &str) -> bool {
    aura_os_automation::is_git_push_timeout(reason)
}

pub(crate) fn is_provider_internal_error_for_tests(reason: &str) -> bool {
    aura_os_automation::is_provider_internal(reason)
}

pub(crate) fn looks_like_unclassified_transient_for_tests(reason: &str) -> bool {
    aura_os_automation::looks_like_unclassified_transient(reason)
}

pub(crate) fn is_agent_stuck_terminal_signal_for_tests(reason: &str) -> bool {
    aura_os_automation::is_agent_stuck_terminal_signal(reason)
}

pub(crate) fn should_restart_on_error_event_for_tests(reason: &str) -> bool {
    aura_os_automation::should_restart_on_error(reason)
}

pub(crate) fn tool_call_failed_should_retry_for_tests(reason: &str, prior_count: u32) -> bool {
    aura_os_automation::tool_call_failed_should_retry(reason, prior_count)
}

pub(crate) const fn tool_call_retry_budget_for_tests() -> u32 {
    aura_os_automation::TOOL_CALL_RETRY_BUDGET
}

pub(crate) fn classify_push_failure_for_tests(reason: &str) -> Option<&'static str> {
    aura_os_automation::classify_push_failure(reason)
}
