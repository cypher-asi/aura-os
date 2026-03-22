use std::path::Path;

use serde_json::{json, Value};

use aura_core::*;

use super::str_field;
use crate::chat_tool_executor::{ChatToolExecutor, ToolExecResult};

/// Heuristic: unbalanced braces/brackets or content that ends mid-line.
fn looks_truncated(content: &str) -> bool {
    if content.len() < 200 {
        return false;
    }
    let mut brace_depth: i64 = 0;
    let mut bracket_depth: i64 = 0;
    let mut paren_depth: i64 = 0;
    for ch in content.chars() {
        match ch {
            '{' => brace_depth += 1,
            '}' => brace_depth -= 1,
            '[' => bracket_depth += 1,
            ']' => bracket_depth -= 1,
            '(' => paren_depth += 1,
            ')' => paren_depth -= 1,
            _ => {}
        }
    }
    let significantly_unbalanced =
        brace_depth.abs() > 2 || bracket_depth.abs() > 2 || paren_depth.abs() > 2;
    let ends_abruptly = !content.ends_with('\n')
        && !content.ends_with('}')
        && !content.ends_with(';')
        && !content.ends_with('\r');
    significantly_unbalanced || ends_abruptly
}

const MAX_FILE_SIZE: u64 = 10 * 1024 * 1024; // 10 MB

fn normalize_line_endings(content: &str, uses_crlf: bool) -> String {
    let normalized = content.replace("\r\n", "\n");
    if uses_crlf {
        normalized.replace('\n', "\r\n")
    } else {
        normalized
    }
}

fn format_line_range(
    content: &str,
    start_line: Option<usize>,
    end_line: Option<usize>,
    rel: &str,
) -> ToolExecResult {
    let lines: Vec<&str> = content.lines().collect();
    let total = lines.len();
    let start = start_line.unwrap_or(1).max(1) - 1;
    let end = end_line.unwrap_or(total).min(total);
    if start >= total {
        return ToolExecResult::err(format!(
            "start_line {} is beyond end of file ({} lines)",
            start + 1,
            total,
        ));
    }
    let selected: Vec<String> = lines[start..end]
        .iter()
        .enumerate()
        .map(|(i, line)| format!("{:>5}| {}", start + i + 1, line))
        .collect();
    ToolExecResult::ok(json!({
        "path": rel,
        "start_line": start + 1,
        "end_line": end,
        "total_lines": total,
        "content": selected.join("\n"),
    }))
}

async fn validate_write_size(abs: &Path, content: &str, rel: &str) -> Result<(), ToolExecResult> {
    if !abs.exists() {
        return Ok(());
    }
    if let Ok(meta) = tokio::fs::metadata(abs).await {
        let cur_size = meta.len() as usize;
        if cur_size > 500 && content.len() < cur_size / 10 {
            return Err(ToolExecResult::err(format!(
                "REJECTED: Content is {} bytes for a {cur_size}-byte file (<10%). \
                 Your output was likely truncated. File is unchanged on disk. \
                 Break the write into smaller parts: write a skeleton first, \
                 then use edit_file to fill in sections. \
                 Or run `git checkout -- {rel}` if the file was previously corrupted.",
                content.len()
            )));
        }
        if cur_size > 200 && content.len() < cur_size / 2 && looks_truncated(content) {
            return Err(ToolExecResult::err(format!(
                "REJECTED: Content appears truncated ({} bytes for a {cur_size}-byte file, \
                 with unbalanced delimiters). File is unchanged. Use edit_file for \
                 targeted changes instead of rewriting the full file.",
                content.len()
            )));
        }
    }
    Ok(())
}

async fn verify_post_write(abs: &Path, content: &str, rel: &str) -> Result<(), ToolExecResult> {
    match tokio::fs::metadata(abs).await {
        Ok(meta) if meta.len() as usize != content.len() => Err(ToolExecResult::err(format!(
            "Post-write verification failed for {rel}: wrote {} bytes but \
                 file on disk is {} bytes. The file may be corrupted.",
            content.len(),
            meta.len()
        ))),
        _ => Ok(()),
    }
}

fn perform_replacement(
    content: &str,
    norm_old: &str,
    norm_new: &str,
    replace_all: bool,
    rel: &str,
) -> Result<(String, usize), ToolExecResult> {
    let occurrence_count = content.matches(norm_old).count();

    if occurrence_count == 0 {
        match fuzzy_search_replace(content, norm_old, norm_new) {
            Some(c) => Ok((c, 1)),
            None => Err(ToolExecResult::err(format!(
                "old_text not found in {rel}. Make sure it matches the file content exactly, \
                 including whitespace. Use read_file to see current content."
            ))),
        }
    } else if !replace_all && occurrence_count > 1 {
        Err(ToolExecResult::err(format!(
            "old_text matches {occurrence_count} locations in {rel}. \
             Provide more surrounding context to make the match unique, \
             or set replace_all to true."
        )))
    } else if replace_all {
        Ok((content.replace(norm_old, norm_new), occurrence_count))
    } else {
        Ok((content.replacen(norm_old, norm_new, 1), 1))
    }
}

async fn read_and_validate_size(abs: &Path, rel: &str) -> Result<String, ToolExecResult> {
    if let Ok(meta) = tokio::fs::metadata(abs).await {
        if meta.len() > MAX_FILE_SIZE {
            return Err(ToolExecResult::err(format!(
                "File {rel} is too large ({:.1} MB, limit is 10 MB).",
                meta.len() as f64 / (1024.0 * 1024.0),
            )));
        }
    }
    tokio::fs::read_to_string(abs)
        .await
        .map_err(|e| ToolExecResult::err(format!("Failed to read {rel}: {e}")))
}

fn check_shrinkage(raw_content: &str, new_content: &str, rel: &str) -> Result<(), ToolExecResult> {
    if raw_content.len() > 200 && new_content.len() < raw_content.len() / 5 {
        return Err(ToolExecResult::err(format!(
            "REJECTED: This edit would shrink '{rel}' from {} to {} bytes (>80% reduction). \
             The file is unchanged. Use a more targeted old_text/new_text pair.",
            raw_content.len(),
            new_content.len()
        )));
    }
    Ok(())
}

async fn assemble_write_result(
    abs: &Path,
    content: &str,
    rel: &str,
    truncation_warning: Option<&str>,
) -> ToolExecResult {
    let line_count = content.lines().count();
    if let Err(e) = verify_post_write(abs, content, rel).await {
        return e;
    }
    let mut message = format!(
        "Successfully wrote {} lines ({} bytes) to {}. \
         Proceed to compilation to catch any issues.",
        line_count,
        content.len(),
        rel,
    );
    if let Some(warn) = truncation_warning {
        message.push(' ');
        message.push_str(warn);
    }
    ToolExecResult::ok(json!({
        "status": "ok",
        "path": rel,
        "bytes_written": content.len(),
        "line_count": line_count,
        "message": message,
    }))
}

async fn write_and_report_edit(
    abs: &Path,
    final_content: &str,
    rel: &str,
    replacements: usize,
) -> ToolExecResult {
    match tokio::fs::write(abs, final_content).await {
        Ok(()) => ToolExecResult::ok(json!({
            "status": "ok",
            "path": rel,
            "replacements": replacements,
            "new_size": final_content.len(),
            "message": format!(
                "Edit applied successfully ({} replacement{}). Do NOT re-read to verify.",
                replacements,
                if replacements != 1 { "s" } else { "" },
            ),
        })),
        Err(e) => ToolExecResult::err(format!("Failed to write {rel}: {e}")),
    }
}

impl ChatToolExecutor {
    pub(crate) async fn read_file(&self, project_id: &ProjectId, input: &Value) -> ToolExecResult {
        let rel = str_field(input, "path").unwrap_or_default();
        let abs = match self.resolve_project_path(project_id, &rel).await {
            Ok(p) => p,
            Err(e) => return e,
        };
        let start_line = input
            .get("start_line")
            .and_then(|v| v.as_u64())
            .map(|n| n as usize);
        let end_line = input
            .get("end_line")
            .and_then(|v| v.as_u64())
            .map(|n| n as usize);

        if let Ok(meta) = tokio::fs::metadata(&abs).await {
            if meta.len() > MAX_FILE_SIZE {
                return ToolExecResult::err(format!(
                    "File {rel} is too large ({:.1} MB, limit is 10 MB). Use start_line/end_line to read a section.",
                    meta.len() as f64 / (1024.0 * 1024.0),
                ));
            }
        }

        match tokio::fs::read_to_string(&abs).await {
            Ok(content) => {
                let content = content.replace("\r\n", "\n");
                if start_line.is_some() || end_line.is_some() {
                    format_line_range(&content, start_line, end_line, &rel)
                } else {
                    ToolExecResult::ok(json!({ "path": rel, "content": content }))
                }
            }
            Err(e) => {
                let hint = if e.kind() == std::io::ErrorKind::NotFound {
                    " Path does not exist. Use list_files to see the current project structure."
                } else {
                    ""
                };
                ToolExecResult::err(format!("Failed to read {rel}: {e}.{hint}"))
            }
        }
    }

    pub(crate) async fn write_file(&self, project_id: &ProjectId, input: &Value) -> ToolExecResult {
        let rel = str_field(input, "path").unwrap_or_default();
        let content = str_field(input, "content").unwrap_or_default();
        let abs = match self.resolve_project_path(project_id, &rel).await {
            Ok(p) => p,
            Err(e) => return e,
        };

        let existing_uses_crlf = if abs.exists() {
            tokio::fs::read_to_string(&abs)
                .await
                .map(|s| s.contains("\r\n"))
                .unwrap_or(false)
        } else {
            false
        };

        let content = normalize_line_endings(&content, existing_uses_crlf);

        if let Err(e) = validate_write_size(&abs, &content, &rel).await {
            return e;
        }

        if let Some(parent) = abs.parent() {
            if let Err(e) = tokio::fs::create_dir_all(parent).await {
                return ToolExecResult::err(format!("Failed to create directories: {e}"));
            }
        }

        let is_new_file = !abs.exists();
        let truncation_warning = if is_new_file && looks_truncated(&content) {
            Some(
                "Warning: content may be truncated (unbalanced delimiters). \
                  Consider using read_file to verify, or use edit_file to append missing sections.",
            )
        } else {
            None
        };

        match tokio::fs::write(&abs, &content).await {
            Ok(()) => assemble_write_result(&abs, &content, &rel, truncation_warning).await,
            Err(e) => ToolExecResult::err(format!("Failed to write {rel}: {e}")),
        }
    }

    pub(crate) async fn delete_file(
        &self,
        project_id: &ProjectId,
        input: &Value,
    ) -> ToolExecResult {
        let rel = str_field(input, "path").unwrap_or_default();
        let abs = match self.resolve_project_path(project_id, &rel).await {
            Ok(p) => p,
            Err(e) => return e,
        };
        match tokio::fs::remove_file(&abs).await {
            Ok(()) => ToolExecResult::ok(json!({ "deleted": rel })),
            Err(e) => ToolExecResult::err(format!("Failed to delete {rel}: {e}")),
        }
    }

    pub(crate) async fn list_files(&self, project_id: &ProjectId, input: &Value) -> ToolExecResult {
        let rel = str_field(input, "path").unwrap_or_else(|| ".".to_string());
        let abs = match self.resolve_project_path(project_id, &rel).await {
            Ok(p) => p,
            Err(e) => return e,
        };
        let mut read_dir = match tokio::fs::read_dir(&abs).await {
            Ok(rd) => rd,
            Err(e) => return ToolExecResult::err(format!("Failed to list {rel}: {e}")),
        };
        let mut items: Vec<Value> = Vec::new();
        while let Ok(Some(entry)) = read_dir.next_entry().await {
            let name = entry.file_name().to_string_lossy().to_string();
            if name.starts_with('.')
                || name == "node_modules"
                || name == "target"
                || name == "__pycache__"
            {
                continue;
            }
            let is_dir = entry
                .file_type()
                .await
                .map(|ft| ft.is_dir())
                .unwrap_or(false);
            items.push(json!({ "name": name, "is_dir": is_dir }));
        }
        items.sort_by(|a, b| {
            let a_dir = a["is_dir"].as_bool().unwrap_or(false);
            let b_dir = b["is_dir"].as_bool().unwrap_or(false);
            b_dir.cmp(&a_dir).then_with(|| {
                a["name"]
                    .as_str()
                    .unwrap_or("")
                    .cmp(b["name"].as_str().unwrap_or(""))
            })
        });
        ToolExecResult::ok(json!({ "path": rel, "entries": items }))
    }

    pub(crate) async fn edit_file(&self, project_id: &ProjectId, input: &Value) -> ToolExecResult {
        let rel = str_field(input, "path").unwrap_or_default();
        let old_text = str_field(input, "old_text").unwrap_or_default();
        let new_text = str_field(input, "new_text").unwrap_or_default();
        let replace_all = input
            .get("replace_all")
            .and_then(|v| v.as_bool())
            .unwrap_or(false);

        if rel.is_empty() {
            return ToolExecResult::err("Missing required field: path");
        }
        if old_text.is_empty() {
            return ToolExecResult::err("Missing required field: old_text");
        }

        let abs = match self.resolve_project_path(project_id, &rel).await {
            Ok(p) => p,
            Err(e) => return e,
        };

        let raw_content = match read_and_validate_size(&abs, &rel).await {
            Ok(c) => c,
            Err(e) => return e,
        };

        let uses_crlf = raw_content.contains("\r\n");
        let content = raw_content.replace("\r\n", "\n");
        let norm_old = old_text.replace("\r\n", "\n");
        let norm_new = new_text.replace("\r\n", "\n");

        let (new_content, replacements) =
            match perform_replacement(&content, &norm_old, &norm_new, replace_all, &rel) {
                Ok(r) => r,
                Err(e) => return e,
            };

        if let Err(e) = check_shrinkage(&raw_content, &new_content, &rel) {
            return e;
        }

        let final_content = normalize_line_endings(&new_content, uses_crlf);
        write_and_report_edit(&abs, &final_content, &rel, replacements).await
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    // ── normalize_line_endings ──────────────────────────────────────

    #[test]
    fn normalize_line_endings_lf_to_crlf() {
        let result = normalize_line_endings("a\nb", true);
        assert_eq!(result, "a\r\nb");
    }

    #[test]
    fn normalize_line_endings_crlf_to_lf() {
        let result = normalize_line_endings("a\r\nb", false);
        assert_eq!(result, "a\nb");
    }

    #[test]
    fn normalize_line_endings_noop_when_already_correct() {
        assert_eq!(normalize_line_endings("a\nb", false), "a\nb");
        assert_eq!(normalize_line_endings("a\r\nb", true), "a\r\nb");
    }

    #[test]
    fn normalize_line_endings_mixed_input() {
        let input = "a\r\nb\nc\r\n";
        assert_eq!(normalize_line_endings(input, false), "a\nb\nc\n");
        assert_eq!(normalize_line_endings(input, true), "a\r\nb\r\nc\r\n");
    }

    // ── format_line_range ──────────────────────────────────────────

    #[test]
    fn format_line_range_full_file() {
        let content = "line1\nline2\nline3";
        let result = format_line_range(content, None, None, "test.rs");
        assert!(!result.is_error);
        assert!(result.content.contains("line1"));
        assert!(result.content.contains("line3"));
    }

    #[test]
    fn format_line_range_subset() {
        let content = "line1\nline2\nline3\nline4\nline5";
        let result = format_line_range(content, Some(2), Some(4), "test.rs");
        assert!(!result.is_error);
        assert!(result.content.contains("line2"));
        assert!(result.content.contains("line4"));
        assert!(
            !result.content.contains("\"start_line\": 1,")
                || result.content.contains("\"start_line\": 2")
        );
    }

    #[test]
    fn format_line_range_out_of_bounds_start() {
        let content = "line1\nline2";
        let result = format_line_range(content, Some(10), None, "test.rs");
        assert!(result.is_error, "start beyond file should error");
    }

    #[test]
    fn format_line_range_end_clamped() {
        let content = "line1\nline2\nline3";
        let result = format_line_range(content, Some(1), Some(100), "test.rs");
        assert!(!result.is_error);
        assert!(result.content.contains("line3"));
    }

    #[test]
    fn format_line_range_single_line() {
        let content = "line1\nline2\nline3";
        let result = format_line_range(content, Some(2), Some(2), "test.rs");
        assert!(!result.is_error);
        assert!(result.content.contains("line2"));
    }

    // ── perform_replacement ────────────────────────────────────────

    #[test]
    fn perform_replacement_single() {
        let (result, count) =
            perform_replacement("aaa bbb ccc", "bbb", "ZZZ", false, "f.rs").unwrap();
        assert_eq!(result, "aaa ZZZ ccc");
        assert_eq!(count, 1);
    }

    #[test]
    fn perform_replacement_not_found() {
        let err = perform_replacement("aaa bbb ccc", "ddd", "ZZZ", false, "f.rs");
        assert!(err.is_err());
    }

    #[test]
    fn perform_replacement_replace_all() {
        let (result, count) =
            perform_replacement("aaa bbb aaa bbb", "bbb", "ZZZ", true, "f.rs").unwrap();
        assert_eq!(result, "aaa ZZZ aaa ZZZ");
        assert_eq!(count, 2);
    }

    #[test]
    fn perform_replacement_ambiguous() {
        let err = perform_replacement("aaa bbb aaa bbb", "bbb", "ZZZ", false, "f.rs");
        assert!(err.is_err());
    }

    #[test]
    fn perform_replacement_ambiguous_matches_without_replace_all_errors() {
        let err = perform_replacement("one two one", "one", "three", false, "f.rs");
        assert!(
            err.is_err(),
            "ambiguous match without replace_all should error"
        );
    }

    // ── check_shrinkage ───────────────────────────────────────────

    #[test]
    fn check_shrinkage_within_threshold() {
        let original = "x".repeat(500);
        let new = "x".repeat(200);
        assert!(check_shrinkage(&original, &new, "f.rs").is_ok());
    }

    #[test]
    fn check_shrinkage_exceeds_threshold() {
        let original = "x".repeat(1000);
        let new = "x".repeat(10);
        assert!(check_shrinkage(&original, &new, "f.rs").is_err());
    }

    #[test]
    fn check_shrinkage_empty_new_content() {
        let original = "x".repeat(500);
        assert!(check_shrinkage(&original, "", "f.rs").is_err());
    }

    #[test]
    fn check_shrinkage_small_file_allows_big_reduction() {
        let original = "short";
        assert!(check_shrinkage(original, "s", "f.rs").is_ok());
    }

    // ── validate_write_size ───────────────────────────────────────

    #[tokio::test]
    async fn validate_write_size_new_file_passes() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("new.txt");
        assert!(validate_write_size(&path, "content", "new.txt")
            .await
            .is_ok());
    }

    #[tokio::test]
    async fn validate_write_size_drastic_shrink_rejected() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("big.txt");
        let big = "x".repeat(5000);
        tokio::fs::write(&path, &big).await.unwrap();

        let small = "y".repeat(10);
        let err = validate_write_size(&path, &small, "big.txt").await;
        assert!(err.is_err(), "drastic size reduction should be rejected");
    }

    #[tokio::test]
    async fn validate_write_size_reasonable_change_passes() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("normal.txt");
        let content = "x".repeat(1000);
        tokio::fs::write(&path, &content).await.unwrap();

        let new_content = "y".repeat(800);
        assert!(validate_write_size(&path, &new_content, "normal.txt")
            .await
            .is_ok());
    }

    // ── verify_post_write ─────────────────────────────────────────

    #[tokio::test]
    async fn verify_post_write_matching() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("verified.txt");
        let content = "hello world";
        tokio::fs::write(&path, content).await.unwrap();

        assert!(verify_post_write(&path, content, "verified.txt")
            .await
            .is_ok());
    }

    #[tokio::test]
    async fn verify_post_write_mismatch() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("mismatch.txt");
        tokio::fs::write(&path, "short").await.unwrap();

        let err = verify_post_write(&path, "this is much longer content", "mismatch.txt").await;
        assert!(err.is_err());
    }

    #[tokio::test]
    async fn verify_post_write_nonexistent_file_passes() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("gone.txt");
        assert!(verify_post_write(&path, "anything", "gone.txt")
            .await
            .is_ok());
    }

    // ── read_and_validate_size ────────────────────────────────────

    #[tokio::test]
    async fn read_and_validate_size_normal_file() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("small.txt");
        tokio::fs::write(&path, "hello").await.unwrap();

        let content = read_and_validate_size(&path, "small.txt").await.unwrap();
        assert_eq!(content, "hello");
    }

    #[tokio::test]
    async fn read_and_validate_size_nonexistent_file() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("missing.txt");

        assert!(read_and_validate_size(&path, "missing.txt").await.is_err());
    }
}
