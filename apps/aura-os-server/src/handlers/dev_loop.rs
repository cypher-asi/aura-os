mod adapter;
mod control;
#[allow(dead_code)]
mod event_kinds;
#[allow(dead_code)]
pub(crate) mod health;
mod limits;
mod progress;
mod registry;
mod run;
mod run_handles;
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
    auto_decompose_disabled, extract_task_failure_context, is_agent_stuck_terminal_signal,
    is_completion_contract_failure, is_empty_path_write_event, is_git_push_timeout_failure,
    is_insufficient_credits_failure, is_provider_internal_error, is_successful_test_run_event,
    is_truncation_failure, looks_like_unclassified_transient, recognized_test_runner_label,
    should_restart_on_error_event, successful_write_event_path,
    task_done_declares_no_changes_needed, task_done_missing_file_changes_reason,
    task_done_workspace_health_gate_reason,
};
