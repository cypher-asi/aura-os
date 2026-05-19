//! Completion-validation no-op stubs and `task_done`/file-edit predicates used by the legacy phase7 test surface.

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
