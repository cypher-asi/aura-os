use std::path::Path;
use std::process::Stdio;

use tokio::process::Command;
use tracing::{info, warn};

use crate::error::EngineError;

#[derive(Debug, Clone)]
pub struct BuildResult {
    pub success: bool,
    pub stdout: String,
    pub stderr: String,
    pub exit_code: Option<i32>,
}

/// Maximum bytes of compiler output to capture and send back to the model.
const MAX_OUTPUT_BYTES: usize = 12_000;

fn truncate_output(s: &str, max: usize) -> String {
    if s.len() <= max {
        return s.to_string();
    }
    let half = max / 2;
    let start = &s[..half];
    let end = &s[s.len() - half..];
    format!("{start}\n\n... (truncated {0} bytes) ...\n\n{end}", s.len() - max)
}

/// Returns true if the command string contains shell operators that require
/// interpretation by a shell (&&, ||, pipes, redirects, semicolons, etc.).
fn needs_shell(cmd: &str) -> bool {
    cmd.contains("&&") || cmd.contains("||") || cmd.contains('|')
        || cmd.contains('>') || cmd.contains('<') || cmd.contains(';')
        || cmd.contains('$') || cmd.contains('`')
}

/// Run a build command in the project directory and capture the result.
///
/// Simple commands are split on whitespace and executed directly. Commands
/// containing shell operators (`&&`, `|`, etc.) are run through the system
/// shell (`cmd /C` on Windows, `sh -c` on Unix).
pub async fn run_build_command(
    project_dir: &Path,
    build_command: &str,
) -> Result<BuildResult, EngineError> {
    if build_command.split_whitespace().next().is_none() {
        return Err(EngineError::Parse("build_command is empty".into()));
    }

    info!(
        dir = %project_dir.display(),
        command = %build_command,
        "running build verification"
    );

    let output = if needs_shell(build_command) {
        #[cfg(target_os = "windows")]
        {
            Command::new("cmd")
                .args(["/C", build_command])
                .current_dir(project_dir)
                .stdout(Stdio::piped())
                .stderr(Stdio::piped())
                .output()
                .await
        }
        #[cfg(not(target_os = "windows"))]
        {
            Command::new("sh")
                .args(["-c", build_command])
                .current_dir(project_dir)
                .stdout(Stdio::piped())
                .stderr(Stdio::piped())
                .output()
                .await
        }
    } else {
        let parts: Vec<&str> = build_command.split_whitespace().collect();
        Command::new(parts[0])
            .args(&parts[1..])
            .current_dir(project_dir)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .output()
            .await
    }
    .map_err(|e| EngineError::Io(format!("failed to execute build command `{build_command}`: {e}")))?;

    let stdout_raw = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr_raw = String::from_utf8_lossy(&output.stderr).to_string();

    let result = BuildResult {
        success: output.status.success(),
        stdout: truncate_output(&stdout_raw, MAX_OUTPUT_BYTES),
        stderr: truncate_output(&stderr_raw, MAX_OUTPUT_BYTES),
        exit_code: output.status.code(),
    };

    if result.success {
        info!(command = %build_command, "build verification passed");
    } else {
        warn!(
            command = %build_command,
            exit_code = ?result.exit_code,
            stderr_len = stderr_raw.len(),
            "build verification failed"
        );
    }

    Ok(result)
}
