//! Push-failure heuristics, DoD-followup stubs, and the recovery-checkpoint coarse classifier used by the legacy phase7 test surface.

pub(crate) const CONSECUTIVE_PUSH_FAILURES_STUCK_THRESHOLD: u32 = 3;
const MAX_DOD_RETRIES_PER_TASK: u32 = 0;

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
        && super::completion::completion_validation_failure_reason_for_tests(
            live_output,
            files_changed,
            n_build_steps,
            n_test_steps,
            n_format_steps,
            n_lint_steps,
        )
        .is_none()
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
