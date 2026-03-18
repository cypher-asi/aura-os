use std::path::Path;

use super::FileOp;

/// Pre-write validation: scan generated file content for patterns known to cause
/// build failures. Returns a list of warnings; empty means no issues detected.
/// This catches problems *before* a full build cycle, saving significant time.
pub fn validate_file_content(path: &str, content: &str) -> Vec<String> {
    let mut warnings = Vec::new();
    let ext = Path::new(path)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or_default();

    match ext {
        "rs" => validate_rust_content(path, content, &mut warnings),
        "ts" | "tsx" | "js" | "jsx" => validate_js_content(path, content, &mut warnings),
        _ => {}
    }
    warnings
}

fn validate_rust_content(path: &str, content: &str, warnings: &mut Vec<String>) {
    for (line_num, line) in content.lines().enumerate() {
        let ln = line_num + 1;

        for (col, ch) in line.char_indices() {
            if !ch.is_ascii() && !is_in_rust_comment(line, col) {
                let desc = match ch {
                    '\u{2014}' => "em dash (use '-' instead)",
                    '\u{2013}' => "en dash (use '-' instead)",
                    '\u{201C}' | '\u{201D}' => "smart quotes (use '\"' instead)",
                    '\u{2018}' | '\u{2019}' => "smart single quotes (use '\\'' instead)",
                    '\u{2026}' => "ellipsis (use '...' instead)",
                    _ if ch as u32 > 127 => "non-ASCII character",
                    _ => continue,
                };
                warnings.push(format!(
                    "{path}:{ln}:{col}: {desc} '{}' (U+{:04X})",
                    ch, ch as u32
                ));
            }
        }

        if (line.contains(r#""markdown_contents":"#) || line.contains(r#""content":"#))
            && line.contains("\\n")
            && !line.trim_start().starts_with("//")
            && !line.trim_start().starts_with("r#")
            && !line.trim_start().starts_with("r\"")
        {
            warnings.push(format!(
                "{path}:{ln}: string literal contains \\n escape sequences — \
                 consider using raw string r#\"...\"# or serde_json::json!()"
            ));
        }
    }

    let mut brace_depth: i32 = 0;
    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with("//") {
            continue;
        }
        for ch in trimmed.chars() {
            match ch {
                '{' => brace_depth += 1,
                '}' => brace_depth -= 1,
                _ => {}
            }
        }
    }
    if brace_depth != 0 {
        warnings.push(format!(
            "{path}: unbalanced braces (depth delta: {brace_depth})"
        ));
    }
}

fn validate_js_content(path: &str, content: &str, warnings: &mut Vec<String>) {
    for (line_num, line) in content.lines().enumerate() {
        let ln = line_num + 1;
        if (line.contains("from '") || line.contains("from \""))
            && line.contains("from './")
            && !line.contains("..")
        {
            let import_path = line.split("from ").nth(1).unwrap_or_default();
            if import_path.contains('\\') {
                warnings.push(format!(
                    "{path}:{ln}: import path uses backslashes -- use forward slashes"
                ));
            }
        }
    }
}

/// Very rough heuristic: check if a character position is inside a `//` comment.
fn is_in_rust_comment(line: &str, col: usize) -> bool {
    if let Some(comment_start) = line.find("//") {
        col > comment_start
    } else {
        false
    }
}

/// Validate all file ops before writing. Returns a combined report of all
/// warnings, or empty string if everything looks fine.
pub fn validate_all_file_ops(ops: &[FileOp]) -> String {
    let mut all_warnings = Vec::new();
    for op in ops {
        match op {
            FileOp::Create { path, content } | FileOp::Modify { path, content } => {
                all_warnings.extend(validate_file_content(path, content));
            }
            FileOp::SearchReplace { path, replacements } => {
                for rep in replacements {
                    all_warnings.extend(validate_file_content(path, &rep.replace));
                }
            }
            FileOp::Delete { .. } => {}
        }
    }
    if all_warnings.is_empty() {
        String::new()
    } else {
        format!(
            "Pre-write validation found {} issue(s):\n{}",
            all_warnings.len(),
            all_warnings.join("\n")
        )
    }
}
