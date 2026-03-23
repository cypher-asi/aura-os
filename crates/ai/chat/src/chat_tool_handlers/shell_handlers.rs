use std::path::Path;

use serde_json::{json, Value};
use tracing::{info, warn};

use aura_core::*;

use super::str_field;
use crate::chat_tool_executor::{ChatToolExecutor, ToolExecResult};
use crate::constants::{
    CMD_STDERR_TRUNCATE_CHARS, CMD_STDOUT_TRUNCATE_CHARS, DEFAULT_CMD_TIMEOUT_SECS,
    MAX_CMD_TIMEOUT_SECS, MAX_SEARCH_RESULTS, SEARCH_REGEX_SIZE_LIMIT,
};

impl ChatToolExecutor {
    pub(crate) async fn run_command(
        &self,
        project_id: &ProjectId,
        input: &Value,
    ) -> ToolExecResult {
        let command = match str_field(input, "command") {
            Some(c) if !c.trim().is_empty() => c,
            _ => return ToolExecResult::err("Missing required field: command"),
        };

        let working_dir_rel = str_field(input, "working_dir").unwrap_or_else(|| ".".to_string());
        let abs_dir = match self
            .resolve_project_path(project_id, &working_dir_rel)
            .await
        {
            Ok(p) => p,
            Err(e) => return e,
        };

        let timeout_secs = input
            .get("timeout_secs")
            .and_then(|v| v.as_u64())
            .unwrap_or(DEFAULT_CMD_TIMEOUT_SECS)
            .min(MAX_CMD_TIMEOUT_SECS);

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
            Ok(Ok(output)) => format_command_result(&output, &command),
            Ok(Err(e)) => ToolExecResult::err(format!("Failed to execute command: {e}")),
            Err(_) => {
                ToolExecResult::err(format!("Command timed out after {timeout_secs} seconds"))
            }
        }
    }

    pub(crate) async fn search_code(
        &self,
        project_id: &ProjectId,
        input: &Value,
    ) -> ToolExecResult {
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
            .size_limit(SEARCH_REGEX_SIZE_LIMIT)
            .build()
        {
            Ok(r) => r,
            Err(e) => return ToolExecResult::err(format!("Invalid regex: {e}")),
        };

        let include_clone = include_glob.clone();
        let abs_clone = abs.clone();
        let pattern_clone = pattern.clone();
        let (matches, files_scanned) = tokio::task::spawn_blocking(move || {
            let mut m: Vec<Value> = Vec::new();
            let mut stats = SearchStats::default();
            let sp = SearchParams {
                root: &abs_clone,
                regex: &regex,
                include_glob: include_clone.as_deref(),
                max_results,
                context_lines,
            };
            search_directory(&sp, &abs_clone, &mut m, &mut stats);
            (m, stats.files_scanned)
        })
        .await
        .unwrap_or_else(|e| {
            warn!(error = %e, "spawn_blocking panicked in search_code");
            Default::default()
        });

        build_search_result(
            &pattern,
            &pattern_clone,
            &abs,
            matches,
            max_results,
            files_scanned,
        )
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
                if found.len() >= MAX_SEARCH_RESULTS {
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

fn format_command_result(output: &std::process::Output, command: &str) -> ToolExecResult {
    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);
    let exit_code = output.status.code().unwrap_or(-1);

    let truncated_stdout = truncate_output(&stdout, CMD_STDOUT_TRUNCATE_CHARS);
    let truncated_stderr = truncate_output(&stderr, CMD_STDERR_TRUNCATE_CHARS);

    ToolExecResult {
        content: serde_json::to_string_pretty(&json!({
            "exit_code": exit_code,
            "stdout": truncated_stdout,
            "stderr": truncated_stderr,
            "command": command,
        }))
        .unwrap_or_default(),
        is_error: !output.status.success(),
        saved_spec: None,
        saved_task: None,
    }
}

fn build_search_result(
    pattern: &str,
    pattern_for_diag: &str,
    abs: &Path,
    matches: Vec<Value>,
    max_results: usize,
    files_scanned: usize,
) -> ToolExecResult {
    if matches.is_empty() {
        let diagnostics = build_search_diagnostics(pattern_for_diag, abs, files_scanned);
        ToolExecResult::ok(json!({
            "pattern": pattern,
            "match_count": 0,
            "truncated": false,
            "matches": [],
            "diagnostics": diagnostics,
        }))
    } else {
        ToolExecResult::ok(json!({
            "pattern": pattern,
            "match_count": matches.len(),
            "truncated": matches.len() >= max_results,
            "matches": matches
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
        let end: String = s
            .chars()
            .rev()
            .take(half)
            .collect::<String>()
            .chars()
            .rev()
            .collect();
        format!(
            "{start}\n\n... [truncated {len} chars] ...\n\n{end}",
            len = s.len() - max_chars
        )
    }
}

const SKIP_DIRS: &[&str] = &[
    "node_modules",
    "target",
    ".git",
    "__pycache__",
    ".next",
    "dist",
    "build",
    ".cargo",
    "vendor",
    ".venv",
    "venv",
];

fn should_skip_path(path: &str) -> bool {
    path.split('/').any(|segment| SKIP_DIRS.contains(&segment))
}

#[derive(Default)]
struct SearchStats {
    files_scanned: usize,
}

struct SearchParams<'a> {
    root: &'a Path,
    regex: &'a regex::Regex,
    include_glob: Option<&'a str>,
    max_results: usize,
    context_lines: usize,
}

fn search_directory(
    params: &SearchParams<'_>,
    dir: &Path,
    matches: &mut Vec<Value>,
    stats: &mut SearchStats,
) {
    let entries = match std::fs::read_dir(dir) {
        Ok(rd) => rd,
        Err(_) => return,
    };
    for entry in entries.flatten() {
        if matches.len() >= params.max_results {
            return;
        }
        let name = entry.file_name().to_string_lossy().to_string();
        if SKIP_DIRS.contains(&name.as_str()) || name.starts_with('.') {
            continue;
        }
        let path = entry.path();
        if path.is_dir() {
            search_directory(params, &path, matches, stats);
        } else if path.is_file() {
            let rel = path
                .strip_prefix(params.root)
                .unwrap_or(&path)
                .to_string_lossy()
                .replace('\\', "/");
            if let Some(glob_pat) = params.include_glob {
                if let Ok(matcher) = glob::Pattern::new(glob_pat) {
                    if !matcher.matches(&rel) && !matcher.matches(&name) {
                        continue;
                    }
                }
            }
            search_file(
                &path,
                &rel,
                params.regex,
                params.context_lines,
                params.max_results,
                matches,
                stats,
            );
        }
    }
}

fn search_file(
    path: &Path,
    rel: &str,
    regex: &regex::Regex,
    context_lines: usize,
    max_results: usize,
    matches: &mut Vec<Value>,
    stats: &mut SearchStats,
) {
    let content = match std::fs::read_to_string(path) {
        Ok(c) => c,
        Err(_) => return,
    };
    stats.files_scanned += 1;
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
                        format!(
                            "{marker}{ln:>5}| {}",
                            l.chars().take(200).collect::<String>()
                        )
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

fn build_search_diagnostics(pattern: &str, search_path: &Path, files_scanned: usize) -> Value {
    let path_exists = search_path.exists();
    let path_is_dir = search_path.is_dir();

    let has_unescaped_brackets = (pattern.contains('[') || pattern.contains(']'))
        && !pattern.contains("\\[")
        && !pattern.contains("\\]");
    let has_unescaped_parens = (pattern.contains('(') || pattern.contains(')'))
        && !pattern.contains("\\(")
        && !pattern.contains("\\)");

    let mut hints: Vec<String> = Vec::new();
    if !path_exists {
        hints.push(format!(
            "Search path '{}' does not exist.",
            search_path.display()
        ));
    } else if !path_is_dir {
        hints.push("Search path is a file, not a directory.".to_string());
    }
    if files_scanned == 0 && path_exists && path_is_dir {
        hints.push(
            "No files matched (directory may be empty or all files excluded by skip-dirs)."
                .to_string(),
        );
    }
    if has_unescaped_brackets {
        hints.push(format!(
            "Pattern contains unescaped '[' or ']' which creates a regex character class. \
             To match literal brackets, use '\\[' and '\\]'. Your pattern: {pattern}"
        ));
    }
    if has_unescaped_parens {
        hints.push(format!(
            "Pattern contains unescaped '(' or ')' which creates a regex group. \
             To match literal parens, use '\\(' and '\\)'. Your pattern: {pattern}"
        ));
    }
    if hints.is_empty() {
        hints.push(format!(
            "No matches found in {files_scanned} files. Try a broader pattern or different path."
        ));
    }

    json!({
        "path_exists": path_exists,
        "files_scanned": files_scanned,
        "hints": hints,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn run_echo() -> std::process::Output {
        #[cfg(windows)]
        let output = std::process::Command::new("cmd")
            .args(["/C", "echo hello world"])
            .output()
            .unwrap();
        #[cfg(not(windows))]
        let output = std::process::Command::new("sh")
            .args(["-c", "echo hello world"])
            .output()
            .unwrap();
        output
    }

    fn run_failing() -> std::process::Output {
        #[cfg(windows)]
        let output = std::process::Command::new("cmd")
            .args(["/C", "exit 1"])
            .output()
            .unwrap();
        #[cfg(not(windows))]
        let output = std::process::Command::new("sh")
            .args(["-c", "exit 1"])
            .output()
            .unwrap();
        output
    }

    // ── format_command_result ──────────────────────────────────────

    #[test]
    fn format_command_result_success() {
        let output = run_echo();
        let result = format_command_result(&output, "echo hello");
        assert!(!result.is_error);
        let v: Value = serde_json::from_str(&result.content).unwrap();
        assert_eq!(v["exit_code"], 0);
        assert!(v["stdout"].as_str().unwrap().contains("hello"));
    }

    #[test]
    fn format_command_result_failure() {
        let output = run_failing();
        let result = format_command_result(&output, "exit 1");
        assert!(result.is_error);
        let v: Value = serde_json::from_str(&result.content).unwrap();
        assert_ne!(v["exit_code"], 0);
    }

    // ── truncate_output ───────────────────────────────────────────

    #[test]
    fn truncate_output_short_input() {
        let input = "short text";
        assert_eq!(truncate_output(input, 100), input);
    }

    #[test]
    fn truncate_output_long_input() {
        let input = "a".repeat(1000);
        let result = truncate_output(&input, 100);
        assert!(result.len() < input.len());
        assert!(result.contains("truncated"));
    }

    #[test]
    fn truncate_output_exact_limit() {
        let input = "a".repeat(100);
        assert_eq!(truncate_output(&input, 100), input);
    }

    // ── build_search_result ───────────────────────────────────────

    #[test]
    fn build_search_result_with_matches() {
        let matches = vec![
            json!({"file": "a.rs", "line": 1, "content": "fn main() {}"}),
            json!({"file": "b.rs", "line": 5, "content": "fn test() {}"}),
        ];
        let abs = Path::new("/project");
        let result = build_search_result("fn", "fn", abs, matches, 50, 10);
        assert!(!result.is_error);
        let v: Value = serde_json::from_str(&result.content).unwrap();
        assert_eq!(v["match_count"], 2);
        assert_eq!(v["truncated"], false);
    }

    #[test]
    fn build_search_result_no_matches() {
        let abs = Path::new("/project");
        let result = build_search_result("missing", "missing", abs, vec![], 50, 10);
        assert!(!result.is_error);
        let v: Value = serde_json::from_str(&result.content).unwrap();
        assert_eq!(v["match_count"], 0);
        assert!(v["diagnostics"].is_object());
    }

    #[test]
    fn build_search_result_truncated() {
        let matches: Vec<Value> = (0..50)
            .map(|i| json!({"file": format!("f{i}.rs"), "line": i, "content": "match"}))
            .collect();
        let abs = Path::new("/project");
        let result = build_search_result("match", "match", abs, matches, 50, 100);
        let v: Value = serde_json::from_str(&result.content).unwrap();
        assert_eq!(v["truncated"], true);
    }

    // ── should_skip_path ──────────────────────────────────────────

    #[test]
    fn should_skip_path_skips_common_dirs() {
        assert!(should_skip_path("src/node_modules/foo.js"));
        assert!(should_skip_path("target/debug/build.rs"));
        assert!(should_skip_path(".git/config"));
    }

    #[test]
    fn should_skip_path_allows_normal_paths() {
        assert!(!should_skip_path("src/main.rs"));
        assert!(!should_skip_path("lib/utils.ts"));
    }

    // ── search_file ───────────────────────────────────────────────

    #[test]
    fn search_file_finds_matches() {
        let dir = TempDir::new().unwrap();
        let file = dir.path().join("test.rs");
        std::fs::write(&file, "fn main() {}\nfn test() {}\nfn other() {}").unwrap();

        let regex = regex::Regex::new("fn test").unwrap();
        let mut matches = Vec::new();
        let mut stats = SearchStats::default();
        search_file(&file, "test.rs", &regex, 0, 50, &mut matches, &mut stats);

        assert_eq!(matches.len(), 1);
        assert_eq!(stats.files_scanned, 1);
        assert_eq!(matches[0]["line"], 2);
    }

    #[test]
    fn search_file_with_context_lines() {
        let dir = TempDir::new().unwrap();
        let file = dir.path().join("ctx.rs");
        std::fs::write(&file, "line1\nline2\nMATCH\nline4\nline5").unwrap();

        let regex = regex::Regex::new("MATCH").unwrap();
        let mut matches = Vec::new();
        let mut stats = SearchStats::default();
        search_file(&file, "ctx.rs", &regex, 1, 50, &mut matches, &mut stats);

        assert_eq!(matches.len(), 1);
        let content = matches[0]["content"].as_str().unwrap();
        assert!(content.contains("line2"));
        assert!(content.contains("MATCH"));
        assert!(content.contains("line4"));
    }

    #[test]
    fn search_file_respects_max_results() {
        let dir = TempDir::new().unwrap();
        let file = dir.path().join("many.rs");
        let content: String = (0..100).map(|i| format!("fn f{i}() {{}}\n")).collect();
        std::fs::write(&file, content).unwrap();

        let regex = regex::Regex::new("fn f").unwrap();
        let mut matches = Vec::new();
        let mut stats = SearchStats::default();
        search_file(&file, "many.rs", &regex, 0, 5, &mut matches, &mut stats);

        assert_eq!(matches.len(), 5);
    }

    // ── build_search_diagnostics ──────────────────────────────────

    #[test]
    fn build_search_diagnostics_nonexistent_path() {
        let diag = build_search_diagnostics("test", Path::new("/nonexistent/path"), 0);
        assert_eq!(diag["path_exists"], false);
        let hints = diag["hints"].as_array().unwrap();
        assert!(hints
            .iter()
            .any(|h| h.as_str().unwrap().contains("does not exist")));
    }

    #[test]
    fn build_search_diagnostics_unescaped_brackets() {
        let dir = TempDir::new().unwrap();
        let diag = build_search_diagnostics("[test]", dir.path(), 5);
        let hints = diag["hints"].as_array().unwrap();
        assert!(hints
            .iter()
            .any(|h| h.as_str().unwrap().contains("character class")));
    }

    #[test]
    fn build_search_diagnostics_normal_no_matches() {
        let dir = TempDir::new().unwrap();
        let diag = build_search_diagnostics("test", dir.path(), 10);
        let hints = diag["hints"].as_array().unwrap();
        assert!(hints
            .iter()
            .any(|h| h.as_str().unwrap().contains("No matches found")));
    }
}
