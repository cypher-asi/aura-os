use serde_json::{json, Value};

use aura_core::*;

use crate::chat_tool_executor::{ChatToolExecutor, ToolExecResult};
use crate::tool_loop_helpers::looks_truncated;
use super::str_field;

const MAX_FILE_SIZE: u64 = 10 * 1024 * 1024; // 10 MB

impl ChatToolExecutor {
    pub(crate) async fn read_file(&self, project_id: &ProjectId, input: &Value) -> ToolExecResult {
        let rel = str_field(input, "path").unwrap_or_default();
        let abs = match self.resolve_project_path(project_id, &rel).await {
            Ok(p) => p,
            Err(e) => return e,
        };
        let start_line = input.get("start_line").and_then(|v| v.as_u64()).map(|n| n as usize);
        let end_line = input.get("end_line").and_then(|v| v.as_u64()).map(|n| n as usize);

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
                    let lines: Vec<&str> = content.lines().collect();
                    let total = lines.len();
                    let start = start_line.unwrap_or(1).max(1) - 1;
                    let end = end_line.unwrap_or(total).min(total);
                    if start >= total {
                        return ToolExecResult::err(format!(
                            "start_line {} is beyond end of file ({} lines)",
                            start + 1, total,
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

        let content = {
            let normalized = content.replace("\r\n", "\n");
            if existing_uses_crlf {
                normalized.replace('\n', "\r\n")
            } else {
                normalized
            }
        };

        if abs.exists() {
            if let Ok(meta) = tokio::fs::metadata(&abs).await {
                let cur_size = meta.len() as usize;
                if cur_size > 500 && content.len() < cur_size / 10 {
                    return ToolExecResult::err(format!(
                        "REJECTED: Content is {} bytes for a {cur_size}-byte file (<10%). \
                         Your output was likely truncated. File is unchanged on disk. \
                         Break the write into smaller parts: write a skeleton first, \
                         then use edit_file to fill in sections. \
                         Or run `git checkout -- {rel}` if the file was previously corrupted.",
                        content.len()
                    ));
                }
                if cur_size > 200 && content.len() < cur_size / 2 && looks_truncated(&content) {
                    return ToolExecResult::err(format!(
                        "REJECTED: Content appears truncated ({} bytes for a {cur_size}-byte file, \
                         with unbalanced delimiters). File is unchanged. Use edit_file for \
                         targeted changes instead of rewriting the full file.",
                        content.len()
                    ));
                }
            }
        }
        if let Some(parent) = abs.parent() {
            if let Err(e) = tokio::fs::create_dir_all(parent).await {
                return ToolExecResult::err(format!("Failed to create directories: {e}"));
            }
        }
        let is_new_file = !abs.exists();
        let truncation_warning = if is_new_file && looks_truncated(&content) {
            Some("Warning: content may be truncated (unbalanced delimiters). \
                  Consider using read_file to verify, or use edit_file to append missing sections.")
        } else {
            None
        };

        match tokio::fs::write(&abs, &content).await {
            Ok(()) => {
                let line_count = content.lines().count();
                match tokio::fs::metadata(&abs).await {
                    Ok(meta) if meta.len() as usize != content.len() => {
                        return ToolExecResult::err(format!(
                            "Post-write verification failed for {rel}: wrote {} bytes but \
                             file on disk is {} bytes. The file may be corrupted.",
                            content.len(), meta.len()
                        ));
                    }
                    _ => {}
                }
                let mut message = format!(
                    "Successfully wrote {} lines ({} bytes) to {}. \
                     Proceed to compilation to catch any issues.",
                    line_count, content.len(), rel,
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
            Err(e) => ToolExecResult::err(format!("Failed to write {rel}: {e}")),
        }
    }

    pub(crate) async fn delete_file(&self, project_id: &ProjectId, input: &Value) -> ToolExecResult {
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
            if name.starts_with('.') || name == "node_modules" || name == "target" || name == "__pycache__" {
                continue;
            }
            let is_dir = entry.file_type().await.map(|ft| ft.is_dir()).unwrap_or(false);
            items.push(json!({ "name": name, "is_dir": is_dir }));
        }
        items.sort_by(|a, b| {
            let a_dir = a["is_dir"].as_bool().unwrap_or(false);
            let b_dir = b["is_dir"].as_bool().unwrap_or(false);
            b_dir.cmp(&a_dir).then_with(|| {
                a["name"].as_str().unwrap_or("").cmp(b["name"].as_str().unwrap_or(""))
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

        if let Ok(meta) = tokio::fs::metadata(&abs).await {
            if meta.len() > MAX_FILE_SIZE {
                return ToolExecResult::err(format!(
                    "File {rel} is too large ({:.1} MB, limit is 10 MB).",
                    meta.len() as f64 / (1024.0 * 1024.0),
                ));
            }
        }

        let raw_content = match tokio::fs::read_to_string(&abs).await {
            Ok(c) => c,
            Err(e) => return ToolExecResult::err(format!("Failed to read {rel}: {e}")),
        };

        let uses_crlf = raw_content.contains("\r\n");

        let content = raw_content.replace("\r\n", "\n");
        let norm_old = old_text.replace("\r\n", "\n");
        let norm_new = new_text.replace("\r\n", "\n");

        let occurrence_count = content.matches(&norm_old).count();

        let (new_content, replacements) = if occurrence_count == 0 {
            match fuzzy_search_replace(&content, &norm_old, &norm_new) {
                Some(c) => (c, 1usize),
                None => return ToolExecResult::err(format!(
                    "old_text not found in {rel}. Make sure it matches the file content exactly, \
                     including whitespace. Use read_file to see current content."
                )),
            }
        } else if !replace_all && occurrence_count > 1 {
            return ToolExecResult::err(format!(
                "old_text matches {occurrence_count} locations in {rel}. \
                 Provide more surrounding context to make the match unique, \
                 or set replace_all to true."
            ));
        } else if replace_all {
            (content.replace(&norm_old, &norm_new), occurrence_count)
        } else {
            (content.replacen(&norm_old, &norm_new, 1), 1)
        };

        if raw_content.len() > 200 && new_content.len() < raw_content.len() / 5 {
            return ToolExecResult::err(format!(
                "REJECTED: This edit would shrink '{rel}' from {} to {} bytes (>80% reduction). \
                 The file is unchanged. Use a more targeted old_text/new_text pair.",
                raw_content.len(), new_content.len()
            ));
        }

        let final_content = if uses_crlf {
            new_content.replace('\n', "\r\n")
        } else {
            new_content
        };

        match tokio::fs::write(&abs, &final_content).await {
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
}
