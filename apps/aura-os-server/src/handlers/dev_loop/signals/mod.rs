//! Legacy server-side signal helpers (classifier shims, failure-context extraction, completion-validation stubs, test-evidence detection, push-failure heuristics, preflight). Behaviour preserved verbatim from the pre-split `signals.rs`; new code should import the underlying primitives from `aura_os_automation` directly.

mod classifiers;
mod completion;
mod failure_context;
mod preflight;
mod push_failures;
mod test_evidence;

pub(crate) use classifiers::{
    auto_decompose_disabled, classify_push_failure_for_tests,
    is_agent_stuck_terminal_signal_for_tests, is_completion_contract_failure_for_tests,
    is_git_push_timeout_failure_for_tests, is_insufficient_credits_failure_for_tests,
    is_provider_internal_error_for_tests, is_rate_limited_failure_for_tests,
    is_truncation_failure_for_tests, looks_like_unclassified_transient_for_tests,
    should_restart_on_error_event_for_tests, tool_call_failed_should_retry_for_tests,
    tool_call_retry_budget_for_tests,
};
pub(crate) use completion::{
    completion_validation_failure_reason_for_tests,
    completion_validation_failure_reason_with_empty_path_writes_for_tests,
    completion_validation_failure_reason_with_tool_call_failures_for_tests,
    is_empty_path_write_event_for_tests, successful_write_event_path_for_tests,
    task_done_declares_no_changes_needed_for_tests,
    task_done_missing_file_changes_reason_for_tests,
};
pub(crate) use failure_context::extract_task_failure_context;
pub(crate) use preflight::preflight_local_workspace_for_tests;
pub(crate) use push_failures::{
    build_dod_followup_prompt_for_tests, bump_project_push_failures_streak_for_tests,
    classify_dod_remediation_kind_for_tests, max_dod_retries_per_task_for_tests,
    push_failure_reset_rearms_stuck_emission_for_tests, recovery_checkpoint_for_tests,
    should_task_complete_despite_push_failure_for_tests, CONSECUTIVE_PUSH_FAILURES_STUCK_THRESHOLD,
};
pub(crate) use test_evidence::{is_successful_test_run_event, recognized_test_runner_label};
