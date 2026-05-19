mod adapter;
mod control;
mod registry;
mod session;
mod signals;
mod start;
mod streaming;
mod types;

pub(crate) use adapter::{
    emit_domain_event, get_loop_status, pause_loop, resume_loop, run_single_task, start_loop,
    stop_loop,
};
pub(crate) use signals::{
    auto_decompose_disabled, build_dod_followup_prompt_for_tests,
    bump_project_push_failures_streak_for_tests, classify_dod_remediation_kind_for_tests,
    classify_push_failure_for_tests, completion_validation_failure_reason_for_tests,
    completion_validation_failure_reason_with_empty_path_writes_for_tests,
    completion_validation_failure_reason_with_tool_call_failures_for_tests,
    extract_task_failure_context, is_agent_stuck_terminal_signal_for_tests,
    is_completion_contract_failure_for_tests, is_empty_path_write_event_for_tests,
    is_git_push_timeout_failure_for_tests, is_insufficient_credits_failure_for_tests,
    is_provider_internal_error_for_tests, is_rate_limited_failure_for_tests,
    is_successful_test_run_event, is_truncation_failure_for_tests,
    looks_like_unclassified_transient_for_tests, max_dod_retries_per_task_for_tests,
    preflight_local_workspace_for_tests, push_failure_reset_rearms_stuck_emission_for_tests,
    recognized_test_runner_label, recovery_checkpoint_for_tests,
    should_restart_on_error_event_for_tests, should_task_complete_despite_push_failure_for_tests,
    successful_write_event_path_for_tests, task_done_declares_no_changes_needed_for_tests,
    task_done_missing_file_changes_reason_for_tests, tool_call_failed_should_retry_for_tests,
    tool_call_retry_budget_for_tests, CONSECUTIVE_PUSH_FAILURES_STUCK_THRESHOLD,
};
