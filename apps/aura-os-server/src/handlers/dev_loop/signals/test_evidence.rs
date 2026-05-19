//! Detection of "the harness reported a successful test-runner invocation" used as the third escape hatch of the completion gate (alongside file edits and `no_changes_needed`).

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
pub(crate) fn is_successful_test_run_event(event_type: &str, event: &serde_json::Value) -> bool {
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
            assert_eq!(
                recognized_test_runner_label(cmd),
                Some(label),
                "label for {cmd}"
            );
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
        assert!(!is_successful_test_run_event(
            "tool_call_completed",
            &errored
        ));
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
