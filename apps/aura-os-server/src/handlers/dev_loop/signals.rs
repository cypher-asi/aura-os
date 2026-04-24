use aura_os_core::{HarnessMode, ProjectId};

use crate::handlers::projects_helpers::validate_workspace_is_initialised;

pub(crate) const CONSECUTIVE_PUSH_FAILURES_STUCK_THRESHOLD: u32 = 3;
const TOOL_CALL_RETRY_BUDGET: u32 = 8;
const MAX_DOD_RETRIES_PER_TASK: u32 = 0;

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
    reason.contains("truncat")
        || reason.contains("max_tokens")
        || reason.contains("maximum tokens")
        || reason.contains("needsdecomposition")
        || reason.contains("no file")
}

pub(crate) fn is_rate_limited_failure_for_tests(reason: &str) -> bool {
    let reason = reason.to_ascii_lowercase();
    reason.contains("rate limit")
        || reason.contains("rate_limited")
        || reason.contains("429")
        || reason.contains("529")
        || reason.contains("overloaded")
}

pub(crate) fn is_insufficient_credits_failure_for_tests(reason: &str) -> bool {
    let reason = reason.to_ascii_lowercase();
    reason.contains("insufficient credits")
        || reason.contains("insufficient_credits")
        || reason.contains("payment_required")
        || reason.contains("402 payment required")
        || (reason.contains("402") && reason.contains("payment required"))
}

pub(crate) fn is_git_push_timeout_failure_for_tests(reason: &str) -> bool {
    let reason = reason.to_ascii_lowercase();
    reason.contains("git")
        && reason.contains("push")
        && (reason.contains("timeout") || reason.contains("timed out"))
}

pub(crate) fn is_provider_internal_error_for_tests(reason: &str) -> bool {
    let reason = reason.to_ascii_lowercase();
    reason.contains("internal server error")
        || reason.contains(" 500")
        || reason.contains(" 502")
        || reason.contains(" 503")
        || reason.contains(" 504")
        || reason.contains("stream terminated")
        || reason.contains("connection reset by peer")
}

pub(crate) fn looks_like_unclassified_transient_for_tests(reason: &str) -> bool {
    let reason = reason.to_ascii_lowercase();
    [
        "timeout",
        "temporar",
        "connection reset",
        "econnreset",
        "dns lookup failed",
        "tls handshake",
        "socket hang up",
        "unavailable",
        "try again",
    ]
    .iter()
    .any(|needle| reason.contains(needle))
        && !is_rate_limited_failure_for_tests(&reason)
        && !is_provider_internal_error_for_tests(&reason)
}

pub(crate) fn is_agent_stuck_terminal_signal_for_tests(reason: &str) -> bool {
    let reason = reason.to_ascii_lowercase();
    reason.contains("appears stuck")
        || reason.contains("agent is stuck")
        || reason.contains("consecutive error")
        || reason.contains("consecutive failure")
        || reason.contains("all tool calls have returned errors")
        || reason.contains("prevent waste")
        || reason.contains("conserve budget")
}

pub(crate) fn should_restart_on_error_event_for_tests(reason: &str) -> bool {
    !is_agent_stuck_terminal_signal_for_tests(reason)
        && (is_rate_limited_failure_for_tests(reason)
            || is_provider_internal_error_for_tests(reason)
            || is_git_push_timeout_failure_for_tests(reason)
            || looks_like_unclassified_transient_for_tests(reason))
}

pub(crate) fn completion_validation_failure_reason_for_tests(
    _live_output: &str,
    _files_changed: &[&str],
    _n_build_steps: usize,
    _n_test_steps: usize,
    _n_format_steps: usize,
    _n_lint_steps: usize,
) -> Option<String> {
    None
}

pub(crate) fn completion_validation_failure_reason_with_empty_path_writes_for_tests(
    _live_output: &str,
    _files_changed: &[&str],
    _n_build_steps: usize,
    _n_test_steps: usize,
    _n_format_steps: usize,
    _n_lint_steps: usize,
    _n_empty_path_writes: u32,
) -> Option<String> {
    // The harness owns Definition-of-Done and decides whether a task is
    // complete. aura-os only records and displays the evidence it receives.
    None
}

#[allow(clippy::too_many_arguments)]
pub(crate) fn completion_validation_failure_reason_with_tool_call_failures_for_tests(
    _live_output: &str,
    _files_changed: &[&str],
    _n_build_steps: usize,
    _n_test_steps: usize,
    _n_format_steps: usize,
    _n_lint_steps: usize,
    _n_empty_path_writes: u32,
    _tool_call_failures: &[(&str, &str)],
) -> Option<String> {
    None
}

pub(crate) fn tool_call_failed_should_retry_for_tests(reason: &str, prior_count: u32) -> bool {
    prior_count < TOOL_CALL_RETRY_BUDGET && should_restart_on_error_event_for_tests(reason)
}

pub(crate) const fn tool_call_retry_budget_for_tests() -> u32 {
    TOOL_CALL_RETRY_BUDGET
}

pub(crate) fn is_empty_path_write_event_for_tests(
    event_type: &str,
    event: &serde_json::Value,
) -> bool {
    if event_type != "tool_call_completed" {
        return false;
    }
    let name = event
        .get("name")
        .and_then(|value| value.as_str())
        .unwrap_or("");
    matches!(name, "write_file" | "edit_file") && path_from_input(event).is_none()
}

pub(crate) fn successful_write_event_path_for_tests(
    event_type: &str,
    event: &serde_json::Value,
) -> Option<(String, &'static str)> {
    if event_type != "tool_call_completed"
        || event.get("is_error").and_then(|v| v.as_bool()) == Some(true)
    {
        return None;
    }
    let name = event.get("name").and_then(|value| value.as_str())?;
    let op = match name {
        "write_file" => "modify",
        "edit_file" => "modify",
        "delete_file" => "delete",
        _ => return None,
    };
    path_from_input(event).map(|path| (path, op))
}

fn path_from_input(event: &serde_json::Value) -> Option<String> {
    event
        .get("input")
        .and_then(|input| input.get("path"))
        .and_then(|path| path.as_str())
        .map(str::trim)
        .filter(|path| !path.is_empty())
        .map(str::to_string)
}

pub(crate) fn preflight_local_workspace_for_tests(
    project_path: &str,
    git_repo_url: Option<&str>,
) -> Result<(), String> {
    if project_path.trim().is_empty() {
        return Err("workspace path is empty".to_string());
    }
    let path = std::path::Path::new(project_path);
    match validate_workspace_is_initialised(path) {
        Ok(()) => Ok(()),
        Err(err) => {
            let bootstrap_pending = git_repo_url.is_some_and(|url| !url.trim().is_empty());
            if bootstrap_pending
                && matches!(
                    err,
                    crate::handlers::projects_helpers::WorkspacePreflightError::Empty
                        | crate::handlers::projects_helpers::WorkspacePreflightError::NotAGitRepo
                )
            {
                Ok(())
            } else {
                Err(err.remediation_hint(path))
            }
        }
    }
}

pub(crate) fn recovery_checkpoint_for_tests(
    live_output: &str,
    files_changed: &[&str],
    git_steps: &[serde_json::Value],
) -> &'static str {
    if git_steps
        .iter()
        .any(|step| step.get("type").and_then(|v| v.as_str()) == Some("git_pushed"))
    {
        "remote_synced"
    } else if git_steps
        .iter()
        .any(|step| step.get("type").and_then(|v| v.as_str()) == Some("git_committed"))
    {
        "commit_created"
    } else if !files_changed.is_empty() {
        "workspace_changed"
    } else if !live_output.trim().is_empty() {
        "output_observed"
    } else {
        "no_progress"
    }
}

#[allow(clippy::too_many_arguments)]
pub(crate) fn should_task_complete_despite_push_failure_for_tests(
    live_output: &str,
    files_changed: &[&str],
    n_build_steps: usize,
    n_test_steps: usize,
    n_format_steps: usize,
    n_lint_steps: usize,
    git_steps: &[serde_json::Value],
    _push_class: &str,
) -> bool {
    let has_commit = git_steps.iter().any(|step| {
        step.get("commit_sha").is_some()
            || step.get("type").and_then(|v| v.as_str()) == Some("git_committed")
    });
    has_commit
        && completion_validation_failure_reason_for_tests(
            live_output,
            files_changed,
            n_build_steps,
            n_test_steps,
            n_format_steps,
            n_lint_steps,
        )
        .is_none()
}

pub(crate) fn classify_push_failure_for_tests(reason: &str) -> Option<&'static str> {
    let reason = reason.to_ascii_lowercase();
    if !(reason.contains("push") || reason.contains("remote")) {
        return None;
    }
    if reason.contains("timeout") || reason.contains("timed out") {
        Some("push_timeout")
    } else if reason.contains("no space") || reason.contains("storage") || reason.contains("quota")
    {
        Some("remote_storage_exhausted")
    } else {
        Some("push_failed")
    }
}

pub(crate) fn classify_dod_remediation_kind_for_tests(reason: &str) -> Option<&'static str> {
    let _ = reason;
    None
}

pub(crate) fn build_dod_followup_prompt_for_tests(
    kind_label: &str,
    attempt: u32,
    previous_reason: &str,
) -> Option<String> {
    let _ = (kind_label, attempt, previous_reason);
    None
}

pub(crate) const fn max_dod_retries_per_task_for_tests() -> u32 {
    MAX_DOD_RETRIES_PER_TASK
}

pub(crate) fn bump_project_push_failures_streak_for_tests(n: u32) -> Vec<bool> {
    (1..=n)
        .map(|idx| idx == CONSECUTIVE_PUSH_FAILURES_STUCK_THRESHOLD)
        .collect()
}

pub(crate) fn push_failure_reset_rearms_stuck_emission_for_tests() -> bool {
    true
}

#[allow(dead_code)]
fn _keep_harness_mode_import(_: HarnessMode, _: ProjectId) {}
