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

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub(crate) struct TaskFailureContext {
    pub(crate) provider_request_id: Option<String>,
    pub(crate) model: Option<String>,
    pub(crate) sse_error_type: Option<String>,
    pub(crate) message_id: Option<String>,
}

impl TaskFailureContext {
    pub(crate) fn has_any(&self) -> bool {
        self.provider_request_id.is_some()
            || self.model.is_some()
            || self.sse_error_type.is_some()
            || self.message_id.is_some()
    }

    pub(crate) fn merge_into(&self, obj: &mut serde_json::Map<String, serde_json::Value>) {
        if let Some(ref v) = self.provider_request_id {
            obj.insert(
                "provider_request_id".into(),
                serde_json::Value::String(v.clone()),
            );
        }
        if let Some(ref v) = self.model {
            obj.insert("model".into(), serde_json::Value::String(v.clone()));
        }
        if let Some(ref v) = self.sse_error_type {
            obj.insert(
                "sse_error_type".into(),
                serde_json::Value::String(v.clone()),
            );
        }
        if let Some(ref v) = self.message_id {
            obj.insert("message_id".into(), serde_json::Value::String(v.clone()));
        }
    }
}

pub(crate) fn extract_task_failure_context(
    event: &serde_json::Value,
    reason: Option<&str>,
) -> TaskFailureContext {
    let mut ctx = TaskFailureContext::default();

    let read_str = |key: &str| -> Option<String> {
        event
            .get(key)
            .and_then(|v| v.as_str())
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(str::to_string)
    };

    ctx.provider_request_id = read_str("provider_request_id").or_else(|| read_str("request_id"));
    ctx.model = read_str("model");
    ctx.sse_error_type = read_str("sse_error_type").or_else(|| read_str("error_type"));
    ctx.message_id = read_str("message_id").or_else(|| read_str("msg_id"));

    if let Some(reason) = reason {
        let parsed = parse_failure_context_from_reason(reason);
        if ctx.provider_request_id.is_none() {
            ctx.provider_request_id = parsed.provider_request_id;
        }
        if ctx.model.is_none() {
            ctx.model = parsed.model;
        }
        if ctx.sse_error_type.is_none() {
            ctx.sse_error_type = parsed.sse_error_type;
        }
        if ctx.message_id.is_none() {
            ctx.message_id = parsed.message_id;
        }
    }

    ctx
}

fn parse_failure_context_from_reason(reason: &str) -> TaskFailureContext {
    let mut ctx = TaskFailureContext::default();

    if let (Some(open), Some(close)) = (reason.find('('), reason.find(')')) {
        if close > open {
            for raw in reason[open + 1..close].split(',') {
                let part = raw.trim();
                if let Some(value) = part.strip_prefix("model=") {
                    let value = value.trim();
                    if !value.is_empty() {
                        ctx.model = Some(value.to_string());
                    }
                } else if let Some(value) = part.strip_prefix("msg_id=") {
                    let value = value.trim();
                    if !value.is_empty() {
                        ctx.message_id = Some(value.to_string());
                    }
                } else if let Some(value) = part.strip_prefix("request_id=") {
                    let value = value.trim();
                    if !value.is_empty() {
                        ctx.provider_request_id = Some(value.to_string());
                    }
                }
            }
        }
    }

    if let Some(close) = reason.find(") :").or_else(|| reason.find("): ")) {
        let after = &reason[close + 2..];
        let after = after.trim_start_matches(|c: char| c == ':' || c.is_whitespace());
        if let Some(colon_idx) = after.find(':') {
            let candidate = after[..colon_idx].trim();
            if is_plausible_error_type(candidate) {
                ctx.sse_error_type = Some(candidate.to_string());
            }
        }
    }

    ctx
}

fn is_plausible_error_type(candidate: &str) -> bool {
    !candidate.is_empty()
        && candidate.len() <= 64
        && candidate
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_')
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

pub(crate) fn task_done_declares_no_changes_needed_for_tests(
    event_type: &str,
    event: &serde_json::Value,
) -> bool {
    event_type == "tool_call_completed"
        && event.get("is_error").and_then(|v| v.as_bool()) != Some(true)
        && event.get("name").and_then(|value| value.as_str()) == Some("task_done")
        && event
            .get("input")
            .and_then(|input| input.get("no_changes_needed"))
            .and_then(|value| value.as_bool())
            == Some(true)
}

/// True when a `tool_call_completed` event records a successful invocation
/// of a recognized test runner (cargo test, pnpm test, pytest, ...). This
/// is the third escape hatch the completion gate accepts: a `task_done`
/// without file edits is allowed when the cached run has at least one
/// such successful test invocation.
///
/// Recognition has three gates:
/// 1. The tool must be a shell-like runner (`run_command`, `bash`, ...);
///    direct typed tools like `write_file` are ignored even if the
///    `input.command` is set on them.
/// 2. The reported exit must be 0 (or absent — some runtimes don't carry
///    `exit_code`; in that case `is_error: true` is the disqualifier).
/// 3. The command text must contain a recognized test-runner needle and
///    must not be one of the deny-listed build/check forms (e.g.
///    `--no-run`, `cargo build`, `cargo check`).
pub(crate) fn is_successful_test_run_event(
    event_type: &str,
    event: &serde_json::Value,
) -> bool {
    if event_type != "tool_call_completed" {
        return false;
    }
    if event.get("is_error").and_then(|v| v.as_bool()) == Some(true) {
        return false;
    }
    if let Some(code) = exit_code_from_event(event) {
        if code != 0 {
            return false;
        }
    }
    let tool_name = event.get("name").and_then(|v| v.as_str()).unwrap_or("");
    if !is_shell_like_tool(tool_name) {
        return false;
    }
    let Some(command) = extract_command_text(event) else {
        return false;
    };
    is_recognized_test_command(&command)
}

/// Stable label identifying which runner satisfied
/// [`is_successful_test_run_event`]. Returned alongside the raw command
/// so the cache and `task_completed` payload can name the evidence
/// (e.g. "Completed via `cargo test`").
///
/// Returns `None` when the command does not match any known runner —
/// callers should not record evidence in that case.
pub(crate) fn recognized_test_runner_label(command: &str) -> Option<&'static str> {
    let lower = command.to_ascii_lowercase();
    if lower.contains("cargo nextest") {
        return Some("cargo nextest");
    }
    if lower.contains("cargo test") {
        return Some("cargo test");
    }
    if lower.contains("pnpm vitest") || lower.contains("vitest") {
        return Some("vitest");
    }
    if lower.contains("pnpm jest") || lower.contains("jest") {
        return Some("jest");
    }
    if lower.contains("pytest") {
        return Some("pytest");
    }
    if lower.contains("go test") {
        return Some("go test");
    }
    if lower.contains("mix test") {
        return Some("mix test");
    }
    if lower.contains("bun test") {
        return Some("bun test");
    }
    if lower.contains("yarn test") {
        return Some("yarn test");
    }
    if lower.contains("pnpm test") || lower.contains("npm test") || lower.contains("npm run test") {
        return Some("npm test");
    }
    None
}

fn is_shell_like_tool(name: &str) -> bool {
    matches!(
        name,
        "run_command"
            | "run_shell"
            | "shell"
            | "bash"
            | "sh"
            | "terminal"
            | "execute_command"
            | "command"
    )
}

fn exit_code_from_event(event: &serde_json::Value) -> Option<i64> {
    event
        .get("output")
        .and_then(|o| o.get("exit_code"))
        .and_then(|v| v.as_i64())
        .or_else(|| event.get("exit_code").and_then(|v| v.as_i64()))
        .or_else(|| {
            event
                .get("result")
                .and_then(|r| r.get("exit_code"))
                .and_then(|v| v.as_i64())
        })
}

fn extract_command_text(event: &serde_json::Value) -> Option<String> {
    let input = event.get("input")?;
    for key in ["command", "cmd", "shell_command"] {
        if let Some(value) = input.get(key).and_then(|v| v.as_str()) {
            let trimmed = value.trim();
            if !trimmed.is_empty() {
                return Some(trimmed.to_string());
            }
        }
    }
    if let Some(arr) = input.get("args").and_then(|v| v.as_array()) {
        let joined: Vec<String> = arr
            .iter()
            .filter_map(|v| v.as_str())
            .map(str::to_string)
            .collect();
        if !joined.is_empty() {
            return Some(joined.join(" "));
        }
    }
    None
}

fn is_recognized_test_command(command: &str) -> bool {
    let lower = command.to_ascii_lowercase();
    // Deny-list: build/check-only forms that compile tests but do not
    // run them. `cargo test --no-run` is the canonical false positive.
    if lower.contains("--no-run")
        || lower.contains("cargo check")
        || lower.contains("cargo build")
        || lower.contains("tsc --noemit")
        || lower.contains("type-check")
    {
        return false;
    }
    recognized_test_runner_label(&lower).is_some()
}

pub(crate) fn task_done_missing_file_changes_reason_for_tests(
    event_type: &str,
    event: &serde_json::Value,
    files_changed: &[&str],
) -> Option<&'static str> {
    if event_type != "tool_call_completed"
        || event.get("is_error").and_then(|v| v.as_bool()) == Some(true)
        || event.get("name").and_then(|value| value.as_str()) != Some("task_done")
        || !files_changed.is_empty()
        || task_done_declares_no_changes_needed_for_tests(event_type, event)
    {
        return None;
    }

    Some("task_done_without_file_changes")
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

#[cfg(test)]
mod test_evidence_tests {
    use super::*;
    use serde_json::json;

    fn run_command(name: &str, command: &str, exit_code: i64, is_error: bool) -> serde_json::Value {
        json!({
            "name": name,
            "is_error": is_error,
            "input": { "command": command },
            "output": { "exit_code": exit_code },
        })
    }

    #[test]
    fn detects_cargo_test_pass() {
        let event = run_command("run_command", "cargo test -p zero-crypto", 0, false);
        assert!(is_successful_test_run_event("tool_call_completed", &event));
        assert_eq!(
            recognized_test_runner_label("cargo test -p zero-crypto"),
            Some("cargo test")
        );
    }

    #[test]
    fn detects_pnpm_vitest_pytest_go() {
        for (cmd, label) in [
            ("pnpm vitest run", "vitest"),
            ("npx vitest --run", "vitest"),
            ("pnpm jest --runInBand", "jest"),
            ("pytest -xvs tests/", "pytest"),
            ("python -m pytest -q", "pytest"),
            ("uv run pytest", "pytest"),
            ("go test ./...", "go test"),
            ("mix test", "mix test"),
            ("bun test", "bun test"),
            ("yarn test", "yarn test"),
            ("pnpm test", "npm test"),
            ("npm test --silent", "npm test"),
            ("npm run test", "npm test"),
            ("cargo nextest run", "cargo nextest"),
        ] {
            let event = run_command("run_command", cmd, 0, false);
            assert!(
                is_successful_test_run_event("tool_call_completed", &event),
                "expected detection for {cmd}",
            );
            assert_eq!(recognized_test_runner_label(cmd), Some(label), "label for {cmd}");
        }
    }

    #[test]
    fn rejects_failing_or_errored_runs() {
        let nonzero_exit = run_command("run_command", "cargo test", 101, false);
        assert!(!is_successful_test_run_event(
            "tool_call_completed",
            &nonzero_exit
        ));
        let errored = run_command("run_command", "cargo test", 0, true);
        assert!(!is_successful_test_run_event("tool_call_completed", &errored));
    }

    #[test]
    fn rejects_build_only_forms() {
        for cmd in [
            "cargo build",
            "cargo check",
            "cargo test --no-run",
            "tsc --noemit",
            "pnpm type-check",
        ] {
            let event = run_command("run_command", cmd, 0, false);
            assert!(
                !is_successful_test_run_event("tool_call_completed", &event),
                "build/check-only form must not count as test evidence: {cmd}"
            );
        }
    }

    #[test]
    fn rejects_non_shell_tools() {
        // `write_file` calls sometimes carry a synthetic `input.command`
        // string in some adapters; the gate must ignore them regardless.
        let event = json!({
            "name": "write_file",
            "input": { "command": "cargo test", "path": "src/lib.rs" },
            "output": { "exit_code": 0 },
        });
        assert!(!is_successful_test_run_event("tool_call_completed", &event));
    }

    #[test]
    fn ignores_started_or_snapshot_events() {
        let event = run_command("run_command", "cargo test", 0, false);
        assert!(!is_successful_test_run_event("tool_call_started", &event));
        assert!(!is_successful_test_run_event("tool_call_snapshot", &event));
    }

    #[test]
    fn accepts_when_exit_code_absent_and_not_errored() {
        // Some runtimes don't carry exit_code; absence is fine as long as
        // `is_error` is not set.
        let event = json!({
            "name": "run_command",
            "input": { "command": "cargo test -p zero-crypto" },
        });
        assert!(is_successful_test_run_event("tool_call_completed", &event));
    }

    #[test]
    fn accepts_args_array_form() {
        let event = json!({
            "name": "bash",
            "input": { "args": ["cargo", "test", "--release"] },
            "output": { "exit_code": 0 },
        });
        assert!(is_successful_test_run_event("tool_call_completed", &event));
    }

    #[test]
    fn ignores_unrelated_commands() {
        for cmd in ["ls -la", "git status", "rg foo", "echo hello"] {
            let event = run_command("run_command", cmd, 0, false);
            assert!(
                !is_successful_test_run_event("tool_call_completed", &event),
                "non-test command must not count: {cmd}"
            );
        }
    }
}
