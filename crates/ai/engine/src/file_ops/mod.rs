use std::path::Path;

use serde::{Deserialize, Serialize};
use tracing::{error, info};

use crate::error::EngineError;

pub mod stub_detection;
pub mod task_relevance;
pub mod validation;
pub mod workspace_map;

pub use stub_detection::*;
pub use task_relevance::*;
pub use validation::*;
pub use workspace_map::*;

use task_relevance::is_impl_for_type;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Replacement {
    pub search: String,
    pub replace: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "op", rename_all = "snake_case")]
pub enum FileOp {
    Create { path: String, content: String },
    Modify { path: String, content: String },
    Delete { path: String },
    SearchReplace {
        path: String,
        replacements: Vec<Replacement>,
    },
}

pub fn validate_path(base: &Path, target: &Path) -> Result<(), EngineError> {
    let norm_base = lexical_normalize(base);
    let norm_target = lexical_normalize(target);

    if !norm_target.starts_with(&norm_base) {
        return Err(EngineError::PathEscape(target.display().to_string()));
    }
    Ok(())
}

/// Resolve `.` and `..` components without hitting the filesystem, avoiding
/// Windows `\\?\` extended-path issues that `canonicalize()` introduces.
fn lexical_normalize(path: &Path) -> std::path::PathBuf {
    use std::path::Component;
    let mut out = std::path::PathBuf::new();
    for comp in path.components() {
        match comp {
            Component::ParentDir => {
                out.pop();
            }
            Component::CurDir => {}
            other => out.push(other),
        }
    }
    out
}

pub async fn apply_file_ops(base_path: &Path, ops: &[FileOp]) -> Result<(), EngineError> {
    info!(base = %base_path.display(), count = ops.len(), "applying file operations");

    for op in ops {
        match op {
            FileOp::Create { path, content } | FileOp::Modify { path, content } => {
                let full_path = base_path.join(path);
                if let Err(e) = validate_path(base_path, &full_path) {
                    error!(path = %path, error = %e, "path validation failed");
                    return Err(e);
                }
                if let Some(parent) = full_path.parent() {
                    tokio::fs::create_dir_all(parent)
                        .await
                        .map_err(|e| EngineError::Io(e.to_string()))?;
                }
                tokio::fs::write(&full_path, content)
                    .await
                    .map_err(|e| {
                        error!(path = %path, error = %e, "failed to write file");
                        EngineError::Io(e.to_string())
                    })?;
                info!(path = %path, bytes = content.len(), "wrote file");
            }
            FileOp::Delete { path } => {
                let full_path = base_path.join(path);
                if let Err(e) = validate_path(base_path, &full_path) {
                    error!(path = %path, error = %e, "path validation failed");
                    return Err(e);
                }
                if full_path.exists() {
                    tokio::fs::remove_file(&full_path)
                        .await
                        .map_err(|e| {
                            error!(path = %path, error = %e, "failed to delete file");
                            EngineError::Io(e.to_string())
                        })?;
                    info!(path = %path, "deleted file");
                }
            }
            FileOp::SearchReplace { path, replacements } => {
                let full_path = base_path.join(path);
                if let Err(e) = validate_path(base_path, &full_path) {
                    error!(path = %path, error = %e, "path validation failed");
                    return Err(e);
                }
                let raw_content = tokio::fs::read_to_string(&full_path)
                    .await
                    .map_err(|e| {
                        error!(path = %path, error = %e, "failed to read file for search-replace");
                        EngineError::Io(format!("failed to read {path} for search-replace: {e}"))
                    })?;

                // Preserve original line-ending convention
                let uses_crlf = raw_content.contains("\r\n");
                let mut content = raw_content.replace("\r\n", "\n");

                for (i, rep) in replacements.iter().enumerate() {
                    let norm_search = rep.search.replace("\r\n", "\n");
                    let norm_replace = rep.replace.replace("\r\n", "\n");
                    let match_count = content.matches(&norm_search).count();
                    if match_count == 1 {
                        content = content.replacen(&norm_search, &norm_replace, 1);
                        continue;
                    }
                    if match_count > 1 {
                        let preview = &rep.search[..rep.search.len().min(120)];
                        return Err(EngineError::Parse(format!(
                            "search-replace #{} in {path}: search string matched {match_count} \
                             times (must be unique): {preview:?}",
                            i + 1
                        )));
                    }
                    // Exact match failed (0 matches). Try fuzzy matching with
                    // normalized whitespace before giving up.
                    if let Some(replacement) = fuzzy_search_replace(&content, &norm_search, &norm_replace) {
                        info!(
                            path = %path, replacement_index = i + 1,
                            "search-replace: exact match failed, fuzzy whitespace match succeeded"
                        );
                        content = replacement;
                    } else {
                        let preview = &rep.search[..rep.search.len().min(120)];
                        return Err(EngineError::Parse(format!(
                            "search-replace #{} in {path}: search string not found \
                             (also tried fuzzy whitespace matching): {preview:?}",
                            i + 1
                        )));
                    }
                }

                // Restore original line-ending convention before writing
                let final_content = if uses_crlf {
                    content.replace('\n', "\r\n")
                } else {
                    content
                };
                let written_bytes = final_content.len();
                tokio::fs::write(&full_path, &final_content)
                    .await
                    .map_err(|e| {
                        error!(path = %path, error = %e, "failed to write after search-replace");
                        EngineError::Io(e.to_string())
                    })?;
                info!(
                    path = %path,
                    replacements = replacements.len(),
                    bytes = written_bytes,
                    "applied search-replace"
                );
            }
        }
    }

    info!(count = ops.len(), "all file operations applied successfully");
    Ok(())
}

/// Compute line-level change stats for each file op before applying them.
/// Must be called before `apply_file_ops` so old file contents are still on disk.
pub fn compute_file_changes(
    base_path: &Path,
    ops: &[FileOp],
) -> Vec<aura_core::FileChangeSummary> {
    ops.iter()
        .map(|op| match op {
            FileOp::Create { path, content } => aura_core::FileChangeSummary {
                op: "create".to_string(),
                path: path.clone(),
                lines_added: content.lines().count() as u32,
                lines_removed: 0,
            },
            FileOp::Modify { path, content } => {
                let old_lines = std::fs::read_to_string(base_path.join(path))
                    .map(|s| s.lines().count() as u32)
                    .unwrap_or(0);
                aura_core::FileChangeSummary {
                    op: "modify".to_string(),
                    path: path.clone(),
                    lines_added: content.lines().count() as u32,
                    lines_removed: old_lines,
                }
            }
            FileOp::Delete { path } => {
                let old_lines = std::fs::read_to_string(base_path.join(path))
                    .map(|s| s.lines().count() as u32)
                    .unwrap_or(0);
                aura_core::FileChangeSummary {
                    op: "delete".to_string(),
                    path: path.clone(),
                    lines_added: 0,
                    lines_removed: old_lines,
                }
            }
            FileOp::SearchReplace { path, replacements } => {
                let old_content = std::fs::read_to_string(base_path.join(path))
                    .unwrap_or_default();
                let old_lines = old_content.lines().count() as u32;
                let mut new_content = old_content;
                for rep in replacements {
                    new_content = new_content.replacen(&rep.search, &rep.replace, 1);
                }
                let new_lines = new_content.lines().count() as u32;
                aura_core::FileChangeSummary {
                    op: "search_replace".to_string(),
                    path: path.clone(),
                    lines_added: new_lines,
                    lines_removed: old_lines,
                }
            }
        })
        .collect()
}

/// Attempt a fuzzy search-replace by normalizing whitespace. When the LLM
/// generates a search string with slightly different indentation or trailing
/// whitespace, this finds the intended match by comparing line-by-line with
/// leading/trailing whitespace stripped.
///
/// Returns `Some(new_content)` if exactly one fuzzy match was found and
/// replaced, `None` otherwise.
fn fuzzy_search_replace(content: &str, search: &str, replace: &str) -> Option<String> {
    let search_lines: Vec<&str> = search.lines().map(|l| l.trim()).collect();
    if search_lines.is_empty() || search_lines.iter().all(|l| l.is_empty()) {
        return None;
    }

    let content_lines: Vec<&str> = content.lines().collect();
    let mut match_positions: Vec<usize> = Vec::new();

    'outer: for start in 0..content_lines.len() {
        if start + search_lines.len() > content_lines.len() {
            break;
        }
        for (j, search_line) in search_lines.iter().enumerate() {
            if content_lines[start + j].trim() != *search_line {
                continue 'outer;
            }
        }
        match_positions.push(start);
    }

    if match_positions.len() != 1 {
        return None;
    }

    let match_start = match_positions[0];
    let match_end = match_start + search_lines.len();

    let mut result = String::with_capacity(content.len());
    for (i, line) in content_lines.iter().enumerate() {
        if i == match_start {
            result.push_str(replace);
            if !replace.ends_with('\n') {
                result.push('\n');
            }
        } else if i >= match_start && i < match_end {
            continue;
        } else {
            result.push_str(line);
            result.push('\n');
        }
    }
    // Trim trailing newline if original didn't end with one
    if !content.ends_with('\n') && result.ends_with('\n') {
        result.pop();
    }

    Some(result)
}

pub(crate) const SKIP_DIRS: &[&str] = &[
    ".git",
    "target",
    "node_modules",
    "__pycache__",
    ".venv",
    "dist",
];

/// References extracted from compiler error output for targeted context resolution.
#[derive(Debug, Default)]
pub struct ErrorReferences {
    pub types_referenced: Vec<String>,
    pub methods_not_found: Vec<(String, String)>,
    pub missing_fields: Vec<(String, String)>,
    pub source_locations: Vec<(String, u32)>,
    pub wrong_arg_counts: Vec<String>,
}

pub(crate) const INCLUDE_EXTENSIONS: &[&str] = &[
    "rs", "ts", "tsx", "js", "jsx", "json", "toml", "md", "css", "html", "yaml", "yml", "py",
    "sh", "sql", "graphql",
];

pub fn read_relevant_files(linked_folder: &str, max_bytes: usize) -> Result<String, EngineError> {
    let base = Path::new(linked_folder);
    let mut output = String::new();
    let mut current_size: usize = 0;
    walk_and_collect(base, base, &mut output, &mut current_size, max_bytes)?;
    Ok(output)
}

fn walk_and_collect(
    base: &Path,
    dir: &Path,
    output: &mut String,
    current_size: &mut usize,
    max_bytes: usize,
) -> Result<(), EngineError> {
    let entries = std::fs::read_dir(dir).map_err(|e| EngineError::Io(e.to_string()))?;

    let mut entries: Vec<_> = entries.filter_map(|e| e.ok()).collect();
    entries.sort_by_key(|e| e.file_name());

    for entry in entries {
        if *current_size >= max_bytes {
            break;
        }

        let path = entry.path();
        let file_name = entry.file_name().to_string_lossy().to_string();

        if path.is_dir() {
            if SKIP_DIRS.contains(&file_name.as_str()) {
                continue;
            }
            walk_and_collect(base, &path, output, current_size, max_bytes)?;
        } else if path.is_file() {
            let extension = path
                .extension()
                .and_then(|e| e.to_str())
                .unwrap_or_default();

            if !INCLUDE_EXTENSIONS.contains(&extension) {
                continue;
            }

            let content =
                std::fs::read_to_string(&path).map_err(|e| EngineError::Io(e.to_string()))?;

            let relative = path
                .strip_prefix(base)
                .unwrap_or(&path)
                .display()
                .to_string();

            let section = format!("--- {} ---\n{}\n\n", relative, content);
            if *current_size + section.len() > max_bytes {
                break;
            }
            output.push_str(&section);
            *current_size += section.len();
        }
    }
    Ok(())
}

const RESOLVE_BUDGET: usize = 10_240;

/// Look up actual source files for types referenced in compiler errors and
/// extract their public API signatures. Returns a formatted string suitable
/// for insertion into a fix prompt, giving the model the real API surface.
pub fn resolve_error_context(base_path: &Path, refs: &ErrorReferences) -> String {
    if refs.types_referenced.is_empty() {
        return String::new();
    }

    let mut output = String::from("## Actual API Reference (from source)\n\n");
    let initial_len = output.len();
    let mut remaining = RESOLVE_BUDGET;

    for type_name in &refs.types_referenced {
        if remaining == 0 {
            break;
        }

        let sources = find_type_sources(base_path, type_name, &refs.source_locations);
        if sources.is_empty() {
            continue;
        }

        let mut section = String::new();
        let mut header_written = false;

        for (rel_path, content) in &sources {
            if !header_written {
                section.push_str(&format!("### {} ({})\n", type_name, rel_path));
                header_written = true;
            } else {
                section.push_str(&format!("  (also in {})\n", rel_path));
            }

            if let Some(fields) = extract_struct_fields(content, type_name) {
                section.push_str(&fields);
                section.push('\n');
            }

            let sigs = extract_pub_signatures(content, type_name);
            for sig in &sigs {
                section.push_str(sig);
                section.push('\n');
            }
        }

        if header_written {
            section.push('\n');
            if section.len() <= remaining {
                output.push_str(&section);
                remaining = remaining.saturating_sub(section.len());
            }
        }
    }

    if output.len() <= initial_len {
        return String::new();
    }

    output
}

pub const ERROR_SOURCE_BUDGET: usize = 15_360;

/// Read the actual source files where compiler errors occur (from
/// `ErrorReferences.source_locations`), deduplicated by file path.
/// Returns a formatted `## Error Source Files` section for the fix prompt,
/// giving the model visibility into the files it needs to edit.
pub fn resolve_error_source_files(
    base_path: &Path,
    refs: &ErrorReferences,
    budget: usize,
) -> String {
    if refs.source_locations.is_empty() {
        return String::new();
    }

    let mut seen = std::collections::HashSet::new();
    let mut output = String::from("## Error Source Files\n\n");
    let initial_len = output.len();
    let mut remaining = budget;

    for (file, _line) in &refs.source_locations {
        if !seen.insert(file.clone()) {
            continue;
        }
        let full = base_path.join(file);
        let content = match std::fs::read_to_string(&full) {
            Ok(c) => c,
            Err(_) => continue,
        };
        let section = format!("--- {} ---\n{}\n\n", file, content);
        if section.len() > remaining {
            break;
        }
        output.push_str(&section);
        remaining = remaining.saturating_sub(section.len());
    }

    if output.len() <= initial_len {
        return String::new();
    }
    output
}

pub(crate) fn find_type_sources(
    base_path: &Path,
    type_name: &str,
    source_hints: &[(String, u32)],
) -> Vec<(String, String)> {
    use std::collections::HashSet;

    let mut results: Vec<(String, String)> = Vec::new();
    let mut seen: HashSet<String> = HashSet::new();
    let patterns: Vec<String> = ["struct", "impl", "trait", "enum"]
        .iter()
        .map(|kw| format!("{} {}", kw, type_name))
        .collect();

    for (hint_file, _) in source_hints {
        if seen.contains(hint_file) {
            continue;
        }
        let full = base_path.join(hint_file);
        if let Ok(content) = std::fs::read_to_string(&full) {
            if patterns.iter().any(|pat| content.contains(pat)) {
                seen.insert(hint_file.clone());
                results.push((hint_file.clone(), content));
            }
        }
    }

    walk_for_type_sources(base_path, base_path, type_name, &mut results, &mut seen);
    results
}

const MAX_TYPE_FILES: usize = 5;

fn walk_for_type_sources(
    base: &Path,
    dir: &Path,
    type_name: &str,
    results: &mut Vec<(String, String)>,
    seen: &mut std::collections::HashSet<String>,
) {
    if results.len() >= MAX_TYPE_FILES {
        return;
    }

    let entries = match std::fs::read_dir(dir) {
        Ok(e) => e,
        Err(_) => return,
    };

    let patterns: Vec<String> = ["struct", "impl", "trait", "enum"]
        .iter()
        .map(|kw| format!("{} {}", kw, type_name))
        .collect();

    let mut entries: Vec<_> = entries.filter_map(|e| e.ok()).collect();
    entries.sort_by_key(|e| e.file_name());

    for entry in entries {
        if results.len() >= MAX_TYPE_FILES {
            return;
        }

        let path = entry.path();
        let fname = entry.file_name().to_string_lossy().to_string();

        if path.is_dir() {
            if SKIP_DIRS.contains(&fname.as_str()) {
                continue;
            }
            walk_for_type_sources(base, &path, type_name, results, seen);
        } else if path.extension().and_then(|e| e.to_str()) == Some("rs") {
            let rel = path
                .strip_prefix(base)
                .unwrap_or(&path)
                .display()
                .to_string();
            if seen.contains(&rel) {
                continue;
            }
            if let Ok(content) = std::fs::read_to_string(&path) {
                if patterns.iter().any(|pat| content.contains(pat)) {
                    seen.insert(rel.clone());
                    results.push((rel, content));
                }
            }
        }
    }
}

pub(crate) fn extract_struct_fields(content: &str, type_name: &str) -> Option<String> {
    let struct_prefix_pub = format!("pub struct {}", type_name);
    let struct_prefix = format!("struct {}", type_name);
    let lines: Vec<&str> = content.lines().collect();

    for (i, line) in lines.iter().enumerate() {
        let trimmed = line.trim();
        let after = trimmed
            .strip_prefix(&struct_prefix_pub)
            .or_else(|| trimmed.strip_prefix(&struct_prefix));
        let after = match after {
            Some(rest) => rest,
            None => continue,
        };
        match after.chars().next() {
            Some('{') | Some(' ') | Some('<') | None => {}
            _ => continue,
        }
        if !trimmed.contains('{') {
            if trimmed.ends_with(';') {
                return None;
            }
            continue;
        }

        let mut result = String::new();
        let mut depth: i32 = 0;
        for j in i..lines.len() {
            for ch in lines[j].chars() {
                match ch {
                    '{' => depth += 1,
                    '}' => depth -= 1,
                    _ => {}
                }
            }
            result.push_str(lines[j].trim());
            result.push('\n');
            if depth <= 0 {
                break;
            }
        }
        return Some(result);
    }
    None
}

pub(crate) fn extract_pub_signatures(content: &str, type_name: &str) -> Vec<String> {
    let mut signatures = Vec::new();
    let mut in_impl = false;
    let mut impl_depth: i32 = 0;
    let mut body_entered = false;

    for line in content.lines() {
        let trimmed = line.trim();

        if !in_impl {
            if is_impl_for_type(trimmed, type_name) {
                in_impl = true;
                impl_depth = 0;
                body_entered = false;
                for ch in trimmed.chars() {
                    match ch {
                        '{' => impl_depth += 1,
                        '}' => impl_depth -= 1,
                        _ => {}
                    }
                }
                if impl_depth > 0 {
                    body_entered = true;
                }
            }
            continue;
        }

        for ch in trimmed.chars() {
            match ch {
                '{' => impl_depth += 1,
                '}' => impl_depth -= 1,
                _ => {}
            }
        }

        if !body_entered {
            if impl_depth > 0 {
                body_entered = true;
            }
            continue;
        }

        if trimmed.starts_with("pub fn ") || trimmed.starts_with("pub async fn ") {
            let sig = match trimmed.find('{') {
                Some(pos) => trimmed[..pos].trim(),
                None => trimmed,
            };
            if !sig.is_empty() {
                signatures.push(sig.to_string());
            }
        }

        if impl_depth <= 0 {
            in_impl = false;
            body_entered = false;
        }
    }

    signatures
}

/// Extract the definition block (struct, trait, or enum) for a given type name.
/// Tries each keyword in order and returns the first match found.
pub(crate) fn extract_definition_block(content: &str, type_name: &str) -> Option<String> {
    let lines: Vec<&str> = content.lines().collect();

    for keyword in &["struct", "trait", "enum"] {
        let prefix_pub = format!("pub {} {}", keyword, type_name);
        let prefix_plain = format!("{} {}", keyword, type_name);

        for (i, line) in lines.iter().enumerate() {
            let trimmed = line.trim();
            let after = trimmed
                .strip_prefix(prefix_pub.as_str())
                .or_else(|| trimmed.strip_prefix(prefix_plain.as_str()));
            let after = match after {
                Some(rest) => rest,
                None => continue,
            };
            match after.chars().next() {
                Some('{') | Some(' ') | Some('<') | Some(':') | None => {}
                _ => continue,
            }
            if !trimmed.contains('{') {
                if trimmed.ends_with(';') {
                    break;
                }
                continue;
            }

            let mut result = String::new();
            let mut depth: i32 = 0;
            for j in i..lines.len() {
                for ch in lines[j].chars() {
                    match ch {
                        '{' => depth += 1,
                        '}' => depth -= 1,
                        _ => {}
                    }
                }
                result.push_str(lines[j].trim());
                result.push('\n');
                if depth <= 0 {
                    break;
                }
            }
            return Some(result);
        }
    }
    None
}
