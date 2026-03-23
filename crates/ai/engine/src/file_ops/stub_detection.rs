use std::path::Path;
use std::sync::OnceLock;

use regex::Regex;

use super::FileOp;

fn fn_signature_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| {
        Regex::new(r"^\s*(?:pub(?:\(crate\))?\s+)?(?:async\s+)?fn\s+(\w+)\s*\(([^)]*)\)")
            .expect("static regex")
    })
}
fn return_type_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"->\s*(.+?)\s*\{?\s*$").expect("static regex"))
}

#[derive(Debug, Clone)]
pub enum StubPattern {
    TodoMacro,
    UnimplementedMacro,
    EmptyFnBody,
    DefaultOnlyReturn,
    IgnoredParams,
}

impl std::fmt::Display for StubPattern {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            StubPattern::TodoMacro => write!(f, "todo!() macro"),
            StubPattern::UnimplementedMacro => write!(f, "unimplemented!() macro"),
            StubPattern::EmptyFnBody => write!(f, "empty function body"),
            StubPattern::DefaultOnlyReturn => write!(f, "default-only return value"),
            StubPattern::IgnoredParams => write!(f, "all parameters unused (prefixed with _)"),
        }
    }
}

#[derive(Debug, Clone)]
pub struct StubReport {
    pub path: String,
    pub line: usize,
    pub pattern: StubPattern,
    pub context: String,
}

/// Scan `.rs` files touched by the given file operations for stub/placeholder
/// patterns. Only inspects files that were created or modified (not deleted).
/// Reads the on-disk version of each file so it must be called after file ops
/// have been applied.
pub fn detect_stub_patterns(base_path: &Path, file_ops: &[FileOp]) -> Vec<StubReport> {
    let mut reports = Vec::new();
    let mut seen_paths = std::collections::HashSet::new();

    for op in file_ops {
        let path = match op {
            FileOp::Create { path, .. }
            | FileOp::Modify { path, .. }
            | FileOp::SearchReplace { path, .. } => path,
            FileOp::Delete { .. } => continue,
        };

        if !path.ends_with(".rs") || !seen_paths.insert(path.clone()) {
            continue;
        }

        let full_path = base_path.join(path);
        let content = match std::fs::read_to_string(&full_path) {
            Ok(c) => c,
            Err(_) => continue,
        };

        detect_stubs_in_content(path, &content, &mut reports);
    }

    reports
}

fn detect_stubs_in_content(path: &str, content: &str, reports: &mut Vec<StubReport>) {
    let lines: Vec<&str> = content.lines().collect();
    let mut in_block_comment = false;

    for (i, line) in lines.iter().enumerate() {
        let trimmed = line.trim();
        let ln = i + 1;

        if in_block_comment {
            if trimmed.contains("*/") {
                in_block_comment = false;
            }
            continue;
        }
        if trimmed.starts_with("/*") {
            in_block_comment = true;
            if trimmed.contains("*/") {
                in_block_comment = false;
            }
            continue;
        }
        if trimmed.starts_with("//") {
            continue;
        }

        if trimmed.contains("todo!(") || trimmed.ends_with("todo!()") {
            reports.push(StubReport {
                path: path.to_string(),
                line: ln,
                pattern: StubPattern::TodoMacro,
                context: trimmed.to_string(),
            });
        }
        if trimmed.contains("unimplemented!(") || trimmed.ends_with("unimplemented!()") {
            reports.push(StubReport {
                path: path.to_string(),
                line: ln,
                pattern: StubPattern::UnimplementedMacro,
                context: trimmed.to_string(),
            });
        }
    }

    detect_hollow_functions(path, &lines, reports);
}

/// Detects functions with empty bodies, trivial default-only returns, or all
/// parameters prefixed with `_` (unused). Uses simple regex heuristics rather
/// than full AST parsing.
fn detect_hollow_functions(path: &str, lines: &[&str], reports: &mut Vec<StubReport>) {
    let fn_re = fn_signature_re();
    let return_re = return_type_re();

    let mut i = 0;
    while i < lines.len() {
        let trimmed = lines[i].trim();
        if trimmed.starts_with("//") || trimmed.starts_with("#[") {
            i += 1;
            continue;
        }

        let caps = match fn_re.captures(trimmed) {
            Some(c) => c,
            None => {
                i += 1;
                continue;
            }
        };

        let params_str = caps.get(2).map(|m| m.as_str().trim()).unwrap_or("");
        let fn_line = i + 1;

        let has_return = return_re.captures(trimmed).is_some();
        let return_type = return_re
            .captures(trimmed)
            .and_then(|c| c.get(1))
            .map(|m| m.as_str().trim().to_string());

        let (body, body_end) = extract_fn_body(lines, i);
        let body_trimmed = body.trim();

        if !body_trimmed.is_empty() {
            if body_trimmed == "{}" || body_trimmed == "{ }" {
                let has_meaningful_params = !params_str.is_empty()
                    && params_str != "&self"
                    && params_str != "&mut self"
                    && params_str != "self";
                if has_return || has_meaningful_params {
                    reports.push(StubReport {
                        path: path.to_string(),
                        line: fn_line,
                        pattern: StubPattern::EmptyFnBody,
                        context: trimmed.to_string(),
                    });
                }
            } else if is_trivial_return(body_trimmed, &return_type) {
                reports.push(StubReport {
                    path: path.to_string(),
                    line: fn_line,
                    pattern: StubPattern::DefaultOnlyReturn,
                    context: format!(
                        "{} {{ {} }}",
                        trimmed.trim_end_matches('{').trim(),
                        body_trimmed.trim_matches(|c| c == '{' || c == '}').trim()
                    ),
                });
            }

            if !params_str.is_empty()
                && params_str != "&self"
                && params_str != "&mut self"
                && params_str != "self"
                && all_params_ignored(params_str)
            {
                reports.push(StubReport {
                    path: path.to_string(),
                    line: fn_line,
                    pattern: StubPattern::IgnoredParams,
                    context: trimmed.to_string(),
                });
            }
        }

        i = if body_end > i { body_end + 1 } else { i + 1 };
    }
}

/// Extract the text of a function body starting from the line the `fn` keyword
/// is on. Returns `(body_text, last_line_index)`. The body_text includes the
/// outer braces.
fn extract_fn_body(lines: &[&str], fn_line_idx: usize) -> (String, usize) {
    let mut depth: i32 = 0;
    let mut started = false;
    let mut body = String::new();

    for (j, line) in lines.iter().enumerate().skip(fn_line_idx) {
        for ch in line.chars() {
            match ch {
                '{' => {
                    depth += 1;
                    started = true;
                }
                '}' => depth -= 1,
                _ => {}
            }
        }
        body.push_str(line.trim());
        body.push('\n');
        if started && depth <= 0 {
            return (body, j);
        }
    }
    (body, lines.len().saturating_sub(1))
}

const TRIVIAL_BODIES: &[&str] = &[
    "Default::default()",
    "Ok(())",
    "Ok(Default::default())",
    "Ok(String::new())",
    "Ok(Vec::new())",
    "Ok(vec![])",
    "String::new()",
    "Vec::new()",
    "vec![]",
    "0",
    "false",
    "None",
];

fn is_trivial_return(body: &str, return_type: &Option<String>) -> bool {
    let inner = body
        .trim()
        .trim_start_matches('{')
        .trim_end_matches('}')
        .trim();
    if inner.is_empty() {
        return false;
    }
    let stmt = inner.trim_end_matches(';').trim();

    if return_type.is_none() {
        return false;
    }

    for trivial in TRIVIAL_BODIES {
        if stmt == *trivial {
            let rt = return_type.as_deref().unwrap_or("");
            if stmt == "Ok(())" && (rt.contains("Result<()") || rt.contains("Result<(), ")) {
                return false;
            }
            return true;
        }
    }
    false
}

/// Check whether every named parameter (excluding `self` variants) is prefixed
/// with `_`, indicating the function ignores all its inputs.
fn all_params_ignored(params_str: &str) -> bool {
    let params: Vec<&str> = params_str.split(',').collect();
    let mut named_count = 0;
    let mut ignored_count = 0;

    for p in &params {
        let p = p.trim();
        if p.is_empty() || p == "&self" || p == "&mut self" || p == "self" || p == "mut self" {
            continue;
        }
        named_count += 1;
        let name = p
            .split(':')
            .next()
            .unwrap_or("")
            .trim()
            .trim_start_matches("mut ");
        if name.starts_with('_') && name.len() > 1 {
            ignored_count += 1;
        }
    }

    named_count > 0 && named_count == ignored_count
}
