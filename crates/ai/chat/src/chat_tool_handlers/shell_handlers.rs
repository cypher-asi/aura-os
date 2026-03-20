use std::path::Path;

use serde_json::{json, Value};
use tracing::info;

use aura_core::*;

use crate::chat_tool_executor::{ChatToolExecutor, ToolExecResult};
use super::str_field;

impl ChatToolExecutor {
    pub(crate) async fn run_command(&self, project_id: &ProjectId, input: &Value) -> ToolExecResult {
        let command = match str_field(input, "command") {
            Some(c) if !c.trim().is_empty() => c,
            _ => return ToolExecResult::err("Missing required field: command"),
        };

        let working_dir_rel = str_field(input, "working_dir").unwrap_or_else(|| ".".to_string());
        let abs_dir = match self.resolve_project_path(project_id, &working_dir_rel).await {
            Ok(p) => p,
            Err(e) => return e,
        };

        let timeout_secs = input
            .get("timeout_secs")
            .and_then(|v| v.as_u64())
            .unwrap_or(60)
            .min(300);

        info!(command = %command, cwd = %abs_dir.display(), timeout_secs, "Running shell command");

        let (shell, flag) = if cfg!(windows) {
            ("cmd", "/C")
        } else {
            ("sh", "-c")
        };

        let result = tokio::time::timeout(
            std::time::Duration::from_secs(timeout_secs),
            tokio::process::Command::new(shell)
                .arg(flag)
                .arg(&command)
                .current_dir(&abs_dir)
                .output(),
        )
        .await;

        match result {
            Ok(Ok(output)) => {
                let stdout = String::from_utf8_lossy(&output.stdout);
                let stderr = String::from_utf8_lossy(&output.stderr);
                let exit_code = output.status.code().unwrap_or(-1);

                let truncated_stdout = truncate_output(&stdout, 8000);
                let truncated_stderr = truncate_output(&stderr, 4000);

                let is_error = !output.status.success();
                ToolExecResult {
                    content: serde_json::to_string_pretty(&json!({
                        "exit_code": exit_code,
                        "stdout": truncated_stdout,
                        "stderr": truncated_stderr,
                        "command": command,
                    }))
                    .unwrap_or_default(),
                    is_error,
                    saved_spec: None,
                    saved_task: None,
                }
            }
            Ok(Err(e)) => ToolExecResult::err(format!("Failed to execute command: {e}")),
            Err(_) => ToolExecResult::err(format!(
                "Command timed out after {timeout_secs} seconds"
            )),
        }
    }

    pub(crate) async fn search_code(&self, project_id: &ProjectId, input: &Value) -> ToolExecResult {
        let pattern = str_field(input, "pattern").unwrap_or_default();
        if pattern.is_empty() {
            return ToolExecResult::err("Missing required field: pattern");
        }
        let rel = str_field(input, "path").unwrap_or_else(|| ".".to_string());
        let abs = match self.resolve_project_path(project_id, &rel).await {
            Ok(p) => p,
            Err(e) => return e,
        };
        let include_glob = str_field(input, "include");
        let max_results = input
            .get("max_results")
            .and_then(|v| v.as_u64())
            .unwrap_or(50) as usize;
        let context_lines = input
            .get("context_lines")
            .and_then(|v| v.as_u64())
            .unwrap_or(0)
            .min(10) as usize;

        let regex = match regex::RegexBuilder::new(&pattern)
            .size_limit(1_000_000) // 1 MB compiled size limit to prevent ReDoS
            .build()
        {
            Ok(r) => r,
            Err(e) => return ToolExecResult::err(format!("Invalid regex: {e}")),
        };

        let include_clone = include_glob.clone();
        let abs_clone = abs.clone();
        let matches = tokio::task::spawn_blocking(move || {
            let mut m: Vec<Value> = Vec::new();
            search_directory(&abs_clone, &abs_clone, &regex, include_clone.as_deref(), max_results, context_lines, &mut m);
            m
        })
        .await
        .unwrap_or_default();

        ToolExecResult::ok(json!({
            "pattern": pattern,
            "match_count": matches.len(),
            "truncated": matches.len() >= max_results,
            "matches": matches
        }))
    }

    pub(crate) async fn find_files(&self, project_id: &ProjectId, input: &Value) -> ToolExecResult {
        let pattern = str_field(input, "pattern").unwrap_or_default();
        if pattern.is_empty() {
            return ToolExecResult::err("Missing required field: pattern");
        }
        let rel = str_field(input, "path").unwrap_or_else(|| ".".to_string());
        let abs = match self.resolve_project_path(project_id, &rel).await {
            Ok(p) => p,
            Err(e) => return e,
        };

        let glob_pattern = if pattern.contains('/') || pattern.contains('\\') {
            pattern.clone()
        } else if pattern.starts_with("*.") || pattern.starts_with("**") {
            format!("**/{pattern}")
        } else {
            format!("**/{pattern}")
        };

        let full_glob = format!("{}/{}", abs.display(), glob_pattern);
        let mut found: Vec<String> = Vec::new();
        if let Ok(paths) = glob::glob(&full_glob.replace('\\', "/")) {
            for entry in paths.flatten() {
                if let Ok(rel_path) = entry.strip_prefix(&abs) {
                    let p = rel_path.to_string_lossy().replace('\\', "/");
                    if !should_skip_path(&p) {
                        found.push(p);
                    }
                }
                if found.len() >= 200 {
                    break;
                }
            }
        }

        ToolExecResult::ok(json!({
            "pattern": pattern,
            "file_count": found.len(),
            "files": found
        }))
    }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn truncate_output(s: &str, max_chars: usize) -> String {
    if s.len() <= max_chars {
        s.to_string()
    } else {
        let half = max_chars / 2;
        let start: String = s.chars().take(half).collect();
        let end: String = s.chars().rev().take(half).collect::<String>().chars().rev().collect();
        format!("{start}\n\n... [truncated {len} chars] ...\n\n{end}", len = s.len() - max_chars)
    }
}

const SKIP_DIRS: &[&str] = &[
    "node_modules", "target", ".git", "__pycache__", ".next", "dist",
    "build", ".cargo", "vendor", ".venv", "venv",
];

fn should_skip_path(path: &str) -> bool {
    path.split('/').any(|segment| SKIP_DIRS.contains(&segment))
}

fn search_directory(
    root: &Path,
    dir: &Path,
    regex: &regex::Regex,
    include_glob: Option<&str>,
    max_results: usize,
    context_lines: usize,
    matches: &mut Vec<Value>,
) {
    let entries = match std::fs::read_dir(dir) {
        Ok(rd) => rd,
        Err(_) => return,
    };
    for entry in entries.flatten() {
        if matches.len() >= max_results {
            return;
        }
        let name = entry.file_name().to_string_lossy().to_string();
        if SKIP_DIRS.contains(&name.as_str()) || name.starts_with('.') {
            continue;
        }
        let path = entry.path();
        if path.is_dir() {
            search_directory(root, &path, regex, include_glob, max_results, context_lines, matches);
        } else if path.is_file() {
            let rel = path
                .strip_prefix(root)
                .unwrap_or(&path)
                .to_string_lossy()
                .replace('\\', "/");
            if let Some(glob_pat) = include_glob {
                if let Ok(matcher) = glob::Pattern::new(glob_pat) {
                    if !matcher.matches(&rel) && !matcher.matches(&name) {
                        continue;
                    }
                }
            }

            if let Ok(content) = std::fs::read_to_string(&path) {
                let all_lines: Vec<&str> = content.lines().collect();
                for (line_num, line) in all_lines.iter().enumerate() {
                    if matches.len() >= max_results {
                        return;
                    }
                    if regex.is_match(line) {
                        if context_lines > 0 {
                            let start = line_num.saturating_sub(context_lines);
                            let end = (line_num + context_lines + 1).min(all_lines.len());
                            let context: Vec<String> = all_lines[start..end]
                                .iter()
                                .enumerate()
                                .map(|(i, l)| {
                                    let ln = start + i + 1;
                                    let marker = if start + i == line_num { ">" } else { " " };
                                    format!("{marker}{ln:>5}| {}", l.chars().take(200).collect::<String>())
                                })
                                .collect();
                            matches.push(json!({
                                "file": rel,
                                "line": line_num + 1,
                                "content": context.join("\n"),
                            }));
                        } else {
                            matches.push(json!({
                                "file": rel,
                                "line": line_num + 1,
                                "content": line.chars().take(200).collect::<String>(),
                            }));
                        }
                    }
                }
            }
        }
    }
}
