use std::path::Path;
use std::process::Stdio;
use std::time::Duration;

use tokio::io::AsyncBufReadExt;
use tokio::process::Command;
use tokio::sync::mpsc::UnboundedSender;
use tracing::{info, warn};

use crate::channel_ext::send_or_log;
use crate::error::EngineError;
use aura_core::IndividualTestResult;

#[derive(Debug, Clone)]
pub struct BuildResult {
    pub success: bool,
    pub stdout: String,
    pub stderr: String,
    pub exit_code: Option<i32>,
    pub timed_out: bool,
}

/// Maximum bytes of compiler output to capture and send back to the model.
const MAX_OUTPUT_BYTES: usize = 12_000;

/// Maximum time a build/run command is allowed to execute before being killed.
const BUILD_TIMEOUT: Duration = Duration::from_secs(120);

fn truncate_output(s: &str, max: usize) -> String {
    if s.len() <= max {
        return s.to_string();
    }
    let half = max / 2;
    let start = &s[..half];
    let end = &s[s.len() - half..];
    format!(
        "{start}\n\n... (truncated {0} bytes) ...\n\n{end}",
        s.len() - max
    )
}

/// Returns true if the command string contains shell operators that require
/// interpretation by a shell (&&, ||, pipes, redirects, semicolons, etc.).
fn needs_shell(cmd: &str) -> bool {
    cmd.contains("&&")
        || cmd.contains("||")
        || cmd.contains('|')
        || cmd.contains('>')
        || cmd.contains('<')
        || cmd.contains(';')
        || cmd.contains('$')
        || cmd.contains('`')
}

/// Run a build command in the project directory and capture the result.
///
/// Simple commands are split on whitespace and executed directly. Commands
/// containing shell operators (`&&`, `|`, etc.) are run through the system
/// shell (`cmd /C` on Windows, `sh -c` on Unix).
pub async fn run_build_command(
    project_dir: &Path,
    build_command: &str,
    output_tx: Option<UnboundedSender<String>>,
) -> Result<BuildResult, EngineError> {
    if build_command.split_whitespace().next().is_none() {
        return Err(EngineError::Parse("build_command is empty".into()));
    }

    info!(
        dir = %project_dir.display(),
        command = %build_command,
        "running build verification"
    );

    let mut child = if needs_shell(build_command) {
        #[cfg(target_os = "windows")]
        {
            Command::new("cmd")
                .args(["/C", build_command])
                .current_dir(project_dir)
                .stdout(Stdio::piped())
                .stderr(Stdio::piped())
                .spawn()
        }
        #[cfg(not(target_os = "windows"))]
        {
            Command::new("sh")
                .args(["-c", build_command])
                .current_dir(project_dir)
                .stdout(Stdio::piped())
                .stderr(Stdio::piped())
                .spawn()
        }
    } else {
        let parts: Vec<&str> = build_command.split_whitespace().collect();
        Command::new(parts[0])
            .args(&parts[1..])
            .current_dir(project_dir)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
    }
    .map_err(|e| {
        EngineError::Io(format!(
            "failed to execute build command `{build_command}`: {e}"
        ))
    })?;

    let stdout_pipe = child.stdout.take();
    let stderr_pipe = child.stderr.take();

    let stdout_tx = output_tx.clone();
    let stdout_handle = tokio::spawn(async move {
        let mut collected = String::new();
        if let Some(pipe) = stdout_pipe {
            let mut reader = tokio::io::BufReader::new(pipe).lines();
            while let Ok(Some(line)) = reader.next_line().await {
                if let Some(ref tx) = stdout_tx {
                    send_or_log(tx, format!("{line}\n"));
                }
                collected.push_str(&line);
                collected.push('\n');
            }
        }
        collected
    });
    let stderr_tx = output_tx;
    let stderr_handle = tokio::spawn(async move {
        let mut collected = String::new();
        if let Some(pipe) = stderr_pipe {
            let mut reader = tokio::io::BufReader::new(pipe).lines();
            while let Ok(Some(line)) = reader.next_line().await {
                if let Some(ref tx) = stderr_tx {
                    send_or_log(tx, format!("{line}\n"));
                }
                collected.push_str(&line);
                collected.push('\n');
            }
        }
        collected
    });

    let result = match tokio::time::timeout(BUILD_TIMEOUT, child.wait()).await {
        Ok(Ok(status)) => {
            let stdout_raw = stdout_handle.await.unwrap_or_default();
            let stderr_raw = stderr_handle.await.unwrap_or_default();
            BuildResult {
                success: status.success(),
                stdout: truncate_output(&stdout_raw, MAX_OUTPUT_BYTES),
                stderr: truncate_output(&stderr_raw, MAX_OUTPUT_BYTES),
                exit_code: status.code(),
                timed_out: false,
            }
        }
        Ok(Err(e)) => {
            return Err(EngineError::Io(format!(
                "IO error waiting for build command `{build_command}`: {e}"
            )));
        }
        Err(_) => {
            warn!(
                command = %build_command,
                timeout_secs = BUILD_TIMEOUT.as_secs(),
                "build command timed out, killing process"
            );
            if let Err(e) = child.kill().await {
                tracing::warn!(command = %build_command, error = %e, "failed to kill timed-out build process");
            }
            let partial_stderr = stderr_handle.await.unwrap_or_default();
            let timeout_msg = format!(
                "Build command timed out after {}s. The command may start a long-running \
                 process (e.g. a server). Use `cargo build` or `cargo check` instead of \
                 `cargo run` for build verification.",
                BUILD_TIMEOUT.as_secs()
            );
            let stderr = if partial_stderr.is_empty() {
                timeout_msg
            } else {
                format!(
                    "{}\n\n{}",
                    truncate_output(&partial_stderr, MAX_OUTPUT_BYTES),
                    timeout_msg
                )
            };
            BuildResult {
                success: false,
                stdout: stdout_handle.await.unwrap_or_default(),
                stderr,
                exit_code: None,
                timed_out: true,
            }
        }
    };

    if result.success {
        info!(command = %build_command, "build verification passed");
    } else {
        warn!(
            command = %build_command,
            exit_code = ?result.exit_code,
            stderr_len = result.stderr.len(),
            "build verification failed"
        );
    }

    Ok(result)
}

/// Parse test runner output into individual test results and a summary line.
///
/// Supports cargo test and Jest/npm test formats. Falls back to a single
/// aggregate result derived from the exit code when the format is unrecognised.
pub fn parse_test_output(
    stdout: &str,
    stderr: &str,
    success: bool,
) -> (Vec<IndividualTestResult>, String) {
    let combined = format!("{stdout}\n{stderr}");

    // Try cargo test format: `test module::name ... ok/FAILED/ignored`
    let cargo_results = parse_cargo_test(&combined);
    if !cargo_results.is_empty() {
        let passed = cargo_results
            .iter()
            .filter(|r| r.status == "passed")
            .count();
        let failed = cargo_results
            .iter()
            .filter(|r| r.status == "failed")
            .count();
        let ignored = cargo_results
            .iter()
            .filter(|r| r.status == "skipped")
            .count();
        let summary = format!("{passed} passed, {failed} failed, {ignored} ignored");
        return (cargo_results, summary);
    }

    // Try Jest format: `PASS src/foo.test.ts` / `FAIL src/bar.test.ts`
    let jest_results = parse_jest_output(&combined);
    if !jest_results.is_empty() {
        let passed = jest_results.iter().filter(|r| r.status == "passed").count();
        let failed = jest_results.iter().filter(|r| r.status == "failed").count();
        let summary = format!("{passed} passed, {failed} failed");
        return (jest_results, summary);
    }

    // Fallback: single aggregate result
    let status = if success { "passed" } else { "failed" };
    let summary = if success {
        "all tests passed".to_string()
    } else {
        "tests failed".to_string()
    };
    let result = IndividualTestResult {
        name: "(aggregate)".to_string(),
        status: status.to_string(),
        message: if !success {
            Some(truncate_output(&combined, 2000))
        } else {
            None
        },
    };
    (vec![result], summary)
}

fn parse_cargo_test(output: &str) -> Vec<IndividualTestResult> {
    let mut results = Vec::new();
    for line in output.lines() {
        let trimmed = line.trim();
        if !trimmed.starts_with("test ") {
            continue;
        }
        let rest = &trimmed[5..];
        if let Some(idx) = rest.find(" ... ") {
            let name = rest[..idx].trim().to_string();
            let outcome = rest[idx + 5..].trim();
            let status = match outcome {
                "ok" => "passed",
                "FAILED" => "failed",
                s if s.starts_with("ignored") => "skipped",
                _ => continue,
            };
            let message = if status == "failed" {
                Some(outcome.to_string())
            } else {
                None
            };
            results.push(IndividualTestResult {
                name,
                status: status.to_string(),
                message,
            });
        }
    }
    results
}

fn parse_jest_output(output: &str) -> Vec<IndividualTestResult> {
    let mut results = Vec::new();
    for line in output.lines() {
        let trimmed = line.trim();
        if let Some(rest) = trimmed.strip_prefix("PASS ") {
            results.push(IndividualTestResult {
                name: rest.trim().to_string(),
                status: "passed".to_string(),
                message: None,
            });
        } else if let Some(rest) = trimmed.strip_prefix("FAIL ") {
            results.push(IndividualTestResult {
                name: rest.trim().to_string(),
                status: "failed".to_string(),
                message: None,
            });
        } else if trimmed.starts_with("\u{2713} ") || trimmed.starts_with("✓ ") {
            results.push(IndividualTestResult {
                name: trimmed[2..].trim().to_string(),
                status: "passed".to_string(),
                message: None,
            });
        } else if trimmed.starts_with("\u{2717} ")
            || trimmed.starts_with("✕ ")
            || trimmed.starts_with("✗ ")
        {
            results.push(IndividualTestResult {
                name: trimmed[3..].trim().to_string(),
                status: "failed".to_string(),
                message: None,
            });
        }
    }
    results
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_cargo_test_output() {
        let stdout = "\
running 3 tests
test utils::tests::test_parse ... ok
test utils::tests::test_format ... FAILED
test utils::tests::test_skip ... ignored
";
        let (results, summary) = parse_test_output(stdout, "", true);
        assert_eq!(results.len(), 3);
        assert_eq!(results[0].status, "passed");
        assert_eq!(results[1].status, "failed");
        assert_eq!(results[2].status, "skipped");
        assert!(summary.contains("1 passed"));
        assert!(summary.contains("1 failed"));
        assert!(summary.contains("1 ignored"));
    }

    #[test]
    fn parse_jest_pass_fail() {
        let stdout = "\
PASS src/utils.test.ts
FAIL src/api.test.ts
PASS src/hooks.test.ts
";
        let (results, summary) = parse_test_output(stdout, "", true);
        assert_eq!(results.len(), 3);
        assert_eq!(results.iter().filter(|r| r.status == "passed").count(), 2);
        assert_eq!(results.iter().filter(|r| r.status == "failed").count(), 1);
        assert!(summary.contains("2 passed"));
    }

    #[test]
    fn parse_fallback_success() {
        let (results, summary) = parse_test_output("all ok", "", true);
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].status, "passed");
        assert!(summary.contains("all tests passed"));
    }

    #[test]
    fn parse_fallback_failure() {
        let (results, summary) = parse_test_output("boom", "something went wrong", false);
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].status, "failed");
        assert!(results[0].message.is_some());
        assert!(summary.contains("tests failed"));
    }

    #[test]
    fn truncate_short_output_unchanged() {
        assert_eq!(truncate_output("hello", 100), "hello");
    }

    #[test]
    fn truncate_long_output() {
        let long = "a".repeat(200);
        let result = truncate_output(&long, 50);
        assert!(result.len() < 200);
        assert!(result.contains("truncated"));
    }

    #[test]
    fn needs_shell_with_pipe() {
        assert!(needs_shell("cargo test | head"));
    }

    #[test]
    fn needs_shell_with_and() {
        assert!(needs_shell("cd foo && npm build"));
    }

    #[test]
    fn needs_shell_simple_command() {
        assert!(!needs_shell("cargo build --release"));
    }
}
