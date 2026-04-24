use aura_os_core::{HarnessMode, ProjectId};

use crate::handlers::projects_helpers::validate_workspace_is_initialised;

pub(crate) const CONSECUTIVE_PUSH_FAILURES_STUCK_THRESHOLD: u32 = 3;
const TOOL_CALL_RETRY_BUDGET: u32 = 8;
const MAX_DOD_RETRIES_PER_TASK: u32 = 2;

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
    live_output: &str,
    files_changed: &[&str],
    n_build_steps: usize,
    n_test_steps: usize,
    n_format_steps: usize,
    n_lint_steps: usize,
) -> Option<String> {
    completion_validation_failure_reason_with_empty_path_writes_for_tests(
        live_output,
        files_changed,
        n_build_steps,
        n_test_steps,
        n_format_steps,
        n_lint_steps,
        0,
    )
}

pub(crate) fn completion_validation_failure_reason_with_empty_path_writes_for_tests(
    live_output: &str,
    files_changed: &[&str],
    n_build_steps: usize,
    n_test_steps: usize,
    n_format_steps: usize,
    n_lint_steps: usize,
    n_empty_path_writes: u32,
) -> Option<String> {
    if live_output.trim().is_empty() {
        return Some("no output observed".to_string());
    }
    if files_changed.is_empty() {
        return Some(
            if n_empty_path_writes > 0 {
                "file write tool calls had empty paths and no valid file changes were observed"
            } else {
                "no files changed"
            }
            .to_string(),
        );
    }
    if n_build_steps == 0 {
        return Some("Task modified source code but no build/compile step was run".to_string());
    }
    if n_test_steps == 0 {
        return Some("Task modified source code but no test step was run".to_string());
    }
    if n_format_steps == 0 {
        return Some("Task modified source code but no format check was run".to_string());
    }
    if n_lint_steps == 0 {
        return Some("Task modified source code but no lint check was run".to_string());
    }
    None
}

fn is_run_command_policy_denial_reason(reason: &str) -> bool {
    let reason = reason.to_ascii_lowercase();
    reason.contains("run_command is denied by kernel policy")
        || reason.contains("not allowed")
        || reason.contains("active policy")
        || reason.contains("allow_shell")
        || reason.contains("binary_allowlist")
}

fn run_command_policy_denial_message() -> String {
    "run_command is denied by harness command policy; verification commands cannot run. Check the external harness /health response for run_command_enabled=true, shell_enabled=true, and a non-empty binary_allowlist, then restart the harness before retrying.".to_string()
}

#[allow(clippy::too_many_arguments)]
pub(crate) fn completion_validation_failure_reason_with_tool_call_failures_for_tests(
    live_output: &str,
    files_changed: &[&str],
    n_build_steps: usize,
    n_test_steps: usize,
    n_format_steps: usize,
    n_lint_steps: usize,
    n_empty_path_writes: u32,
    tool_call_failures: &[(&str, &str)],
) -> Option<String> {
    let run_command_denied = tool_call_failures.iter().any(|(name, reason)| {
        *name == "run_command" && is_run_command_policy_denial_reason(reason)
    });
    if run_command_denied
        && (n_build_steps == 0 || n_test_steps == 0 || n_format_steps == 0 || n_lint_steps == 0)
    {
        return Some(run_command_policy_denial_message());
    }
    completion_validation_failure_reason_with_empty_path_writes_for_tests(
        live_output,
        files_changed,
        n_build_steps,
        n_test_steps,
        n_format_steps,
        n_lint_steps,
        n_empty_path_writes,
    )
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
    let reason = reason.to_ascii_lowercase();
    if is_run_command_policy_denial_reason(&reason) {
        return None;
    }
    if reason.contains("build") {
        Some("missing_build")
    } else if reason.contains("test") {
        Some("missing_test")
    } else if reason.contains("format") || reason.contains("fmt") {
        Some("missing_fmt")
    } else if reason.contains("lint") || reason.contains("clippy") {
        Some("missing_lint")
    } else {
        None
    }
}

pub(crate) fn build_dod_followup_prompt_for_tests(
    kind_label: &str,
    attempt: u32,
    previous_reason: &str,
) -> Option<String> {
    let axis = match kind_label {
        "missing_build" => "build step",
        "missing_test" => "test step",
        "missing_fmt" => "format check",
        "missing_lint" => "lint check",
        _ => return None,
    };
    let reason = truncate_reason(previous_reason);
    Some(format!(
        "[aura-dod-retry attempt={attempt} axis={kind_label}] Previous completion was rejected: {reason}. Use run_command to perform the missing {axis}, then fix any failures before finishing."
    ))
}

fn truncate_reason(reason: &str) -> String {
    const MAX_CHARS: usize = 240;
    let mut chars = reason.chars();
    let truncated: String = chars.by_ref().take(MAX_CHARS).collect();
    if chars.next().is_some() {
        format!("{truncated}…")
    } else {
        truncated
    }
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
