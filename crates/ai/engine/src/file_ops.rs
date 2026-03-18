use std::collections::HashMap;
use std::path::Path;

use regex::Regex;
use serde::{Deserialize, Serialize};
use tracing::{info, error};

use crate::error::EngineError;

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
            Component::ParentDir => { out.pop(); }
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
                let mut content = tokio::fs::read_to_string(&full_path)
                    .await
                    .map_err(|e| {
                        error!(path = %path, error = %e, "failed to read file for search-replace");
                        EngineError::Io(format!("failed to read {path} for search-replace: {e}"))
                    })?;

                for (i, rep) in replacements.iter().enumerate() {
                    let match_count = content.matches(&rep.search).count();
                    if match_count == 0 {
                        let preview = &rep.search[..rep.search.len().min(120)];
                        return Err(EngineError::Parse(format!(
                            "search-replace #{} in {path}: search string not found: {preview:?}",
                            i + 1
                        )));
                    }
                    if match_count > 1 {
                        let preview = &rep.search[..rep.search.len().min(120)];
                        return Err(EngineError::Parse(format!(
                            "search-replace #{} in {path}: search string matched {match_count} \
                             times (must be unique): {preview:?}",
                            i + 1
                        )));
                    }
                    content = content.replacen(&rep.search, &rep.replace, 1);
                }

                tokio::fs::write(&full_path, &content)
                    .await
                    .map_err(|e| {
                        error!(path = %path, error = %e, "failed to write after search-replace");
                        EngineError::Io(e.to_string())
                    })?;
                info!(
                    path = %path,
                    replacements = replacements.len(),
                    bytes = content.len(),
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

        // Detect non-ASCII characters that commonly cause "unknown start of token"
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

        // Detect JSON-like string literals that should use raw strings
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

    // Detect unbalanced braces in non-string, non-comment context (simple heuristic)
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

const SKIP_DIRS: &[&str] = &[
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

const INCLUDE_EXTENSIONS: &[&str] = &[
    "rs", "ts", "tsx", "js", "jsx", "json", "toml", "md", "css", "html", "yaml", "yml", "py", "sh",
    "sql", "graphql",
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

fn find_type_sources(
    base_path: &Path,
    type_name: &str,
    source_hints: &[(String, u32)],
) -> Vec<(String, String)> {
    use std::collections::HashSet;

    let mut results: Vec<(String, String)> = Vec::new();
    let mut seen: HashSet<String> = HashSet::new();
    let struct_pat = format!("struct {}", type_name);
    let impl_pat = format!("impl {}", type_name);

    for (hint_file, _) in source_hints {
        if seen.contains(hint_file) {
            continue;
        }
        let full = base_path.join(hint_file);
        if let Ok(content) = std::fs::read_to_string(&full) {
            if content.contains(&struct_pat) || content.contains(&impl_pat) {
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

    let struct_pat = format!("struct {}", type_name);
    let impl_pat = format!("impl {}", type_name);

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
            let rel = path.strip_prefix(base).unwrap_or(&path).display().to_string();
            if seen.contains(&rel) {
                continue;
            }
            if let Ok(content) = std::fs::read_to_string(&path) {
                if content.contains(&struct_pat) || content.contains(&impl_pat) {
                    seen.insert(rel.clone());
                    results.push((rel, content));
                }
            }
        }
    }
}

fn extract_struct_fields(content: &str, type_name: &str) -> Option<String> {
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

fn extract_pub_signatures(content: &str, type_name: &str) -> Vec<String> {
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

// ---------------------------------------------------------------------------
// Workspace map generation (Phase 1A)
// ---------------------------------------------------------------------------

/// Parse the root `Cargo.toml` for `[workspace].members`, resolve each
/// member's internal dependencies, and produce a compact structural summary
/// (~2K tokens) suitable for prompt injection.
pub fn generate_workspace_map(project_root: &str) -> Result<String, EngineError> {
    let root = Path::new(project_root);
    let root_cargo = root.join("Cargo.toml");
    let cargo_content = match std::fs::read_to_string(&root_cargo) {
        Ok(c) => c,
        Err(_) => return Ok(String::new()),
    };

    let members = parse_workspace_members(&cargo_content);
    if members.is_empty() {
        return Ok(String::new());
    }

    let mut crate_names: HashMap<String, String> = HashMap::new();
    let mut crate_deps: HashMap<String, Vec<String>> = HashMap::new();
    let mut crate_docs: HashMap<String, String> = HashMap::new();

    for member in &members {
        let member_cargo = root.join(member).join("Cargo.toml");
        let content = match std::fs::read_to_string(&member_cargo) {
            Ok(c) => c,
            Err(_) => continue,
        };

        let name = parse_package_name(&content).unwrap_or_else(|| member.clone());
        let internal_deps = parse_internal_deps(&content);
        let doc = read_crate_doc_comment(root, member);

        crate_names.insert(member.clone(), name);
        crate_deps.insert(member.clone(), internal_deps);
        if !doc.is_empty() {
            crate_docs.insert(member.clone(), doc);
        }
    }

    let name_to_path: HashMap<&str, &str> = crate_names
        .iter()
        .map(|(path, name)| (name.as_str(), path.as_str()))
        .collect();

    let mut output = format!("Workspace: {} crates\n", members.len());
    for member in &members {
        let name = crate_names.get(member).map(|s| s.as_str()).unwrap_or(member);
        let doc = crate_docs.get(member).map(|s| s.as_str()).unwrap_or("");
        let doc_suffix = if doc.is_empty() {
            String::new()
        } else {
            format!(" -- {doc}")
        };
        output.push_str(&format!("  {member} ({name}){doc_suffix}\n"));

        if let Some(deps) = crate_deps.get(member) {
            let resolved: Vec<&str> = deps
                .iter()
                .filter_map(|d| {
                    if name_to_path.contains_key(d.as_str()) {
                        Some(d.as_str())
                    } else {
                        None
                    }
                })
                .collect();
            if resolved.is_empty() {
                output.push_str("    deps: []\n");
            } else {
                output.push_str(&format!("    deps: [{}]\n", resolved.join(", ")));
            }
        }
    }
    Ok(output)
}

fn parse_workspace_members(cargo_content: &str) -> Vec<String> {
    let mut members = Vec::new();
    let mut in_members = false;

    for line in cargo_content.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with("members") && trimmed.contains('[') {
            in_members = true;
            if trimmed.contains(']') {
                extract_quoted_strings(trimmed, &mut members);
                break;
            }
            extract_quoted_strings(trimmed, &mut members);
            continue;
        }
        if in_members {
            if trimmed.contains(']') {
                extract_quoted_strings(trimmed, &mut members);
                break;
            }
            extract_quoted_strings(trimmed, &mut members);
        }
    }
    members
}

fn extract_quoted_strings(line: &str, out: &mut Vec<String>) {
    let mut rest = line;
    while let Some(start) = rest.find('"') {
        rest = &rest[start + 1..];
        if let Some(end) = rest.find('"') {
            out.push(rest[..end].to_string());
            rest = &rest[end + 1..];
        } else {
            break;
        }
    }
}

fn parse_package_name(cargo_content: &str) -> Option<String> {
    let mut in_package = false;
    for line in cargo_content.lines() {
        let trimmed = line.trim();
        if trimmed == "[package]" {
            in_package = true;
            continue;
        }
        if trimmed.starts_with('[') && trimmed != "[package]" {
            if in_package {
                break;
            }
            continue;
        }
        if in_package && trimmed.starts_with("name") {
            if let Some(val) = trimmed.split('=').nth(1) {
                let val = val.trim().trim_matches('"').trim_matches('\'');
                return Some(val.to_string());
            }
        }
    }
    None
}

/// Extract workspace-internal dependency names from a crate's Cargo.toml.
/// We detect path dependencies (those with `path = "..."`) and return
/// the package name (from `package = "..."` override or the dep key itself).
fn parse_internal_deps(cargo_content: &str) -> Vec<String> {
    let mut deps = Vec::new();
    let mut in_deps = false;
    let mut in_inline_table = false;
    let mut current_dep_name = String::new();

    for line in cargo_content.lines() {
        let trimmed = line.trim();

        if trimmed == "[dependencies]" || trimmed == "[dev-dependencies]" {
            in_deps = trimmed == "[dependencies]";
            in_inline_table = false;
            continue;
        }
        if trimmed.starts_with('[') {
            if trimmed.starts_with("[dependencies.") {
                let dep_name = trimmed
                    .trim_start_matches("[dependencies.")
                    .trim_end_matches(']');
                current_dep_name = dep_name.to_string();
                in_inline_table = true;
                in_deps = false;
                continue;
            }
            in_deps = false;
            in_inline_table = false;
            continue;
        }

        if in_inline_table {
            if trimmed.starts_with("path") {
                deps.push(current_dep_name.clone());
                in_inline_table = false;
            }
            continue;
        }

        if in_deps && trimmed.contains("path") && trimmed.contains('=') {
            let dep_name = trimmed.split('=').next().unwrap_or("").trim();
            if !dep_name.is_empty() {
                deps.push(dep_name.to_string());
            }
        }
    }
    deps
}

/// Read the first 5 lines of a crate's lib.rs or main.rs to extract
/// any `//!` module-level doc comment as a short description.
fn read_crate_doc_comment(project_root: &Path, member: &str) -> String {
    let src_dir = project_root.join(member).join("src");
    let entry_file = if src_dir.join("lib.rs").exists() {
        src_dir.join("lib.rs")
    } else if src_dir.join("main.rs").exists() {
        src_dir.join("main.rs")
    } else {
        return String::new();
    };

    let content = match std::fs::read_to_string(&entry_file) {
        Ok(c) => c,
        Err(_) => return String::new(),
    };

    let mut doc_parts = Vec::new();
    for line in content.lines().take(5) {
        let trimmed = line.trim();
        if let Some(stripped) = trimmed.strip_prefix("//!") {
            doc_parts.push(stripped.trim().to_string());
        }
    }
    doc_parts.join(" ").trim().to_string()
}

// ---------------------------------------------------------------------------
// Signature-only file reader (Phase 4B)
// ---------------------------------------------------------------------------

/// Extract only public API signatures from a `.rs` file, dropping function
/// bodies. Delegates to `aura_core::rust_signatures::extract_signatures`.
pub fn read_signatures_only(file_path: &Path) -> Result<String, EngineError> {
    let content = std::fs::read_to_string(file_path)
        .map_err(|e| EngineError::Io(format!("failed to read {}: {e}", file_path.display())))?;
    Ok(extract_signatures_from_content(&content))
}

/// Re-export: extract public API signatures from Rust source content.
pub fn extract_signatures_from_content(content: &str) -> String {
    aura_core::rust_signatures::extract_signatures(content)
}


/// Count the number of workspace member crates by parsing the root Cargo.toml.
/// Returns 1 (single crate) if no workspace is detected.
pub fn count_workspace_members(project_root: &str) -> Result<usize, EngineError> {
    let root_cargo = Path::new(project_root).join("Cargo.toml");
    let content = std::fs::read_to_string(&root_cargo)
        .map_err(|e| EngineError::Io(e.to_string()))?;
    let members = parse_workspace_members(&content);
    if members.is_empty() {
        Ok(1)
    } else {
        Ok(members.len())
    }
}

// ---------------------------------------------------------------------------
// Stub / placeholder detection (Phase 3A)
// ---------------------------------------------------------------------------

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
    let fn_re = Regex::new(
        r"^\s*(?:pub(?:\(crate\))?\s+)?(?:async\s+)?fn\s+(\w+)\s*\(([^)]*)\)"
    ).unwrap();
    let return_re = Regex::new(r"->\s*(.+?)\s*\{?\s*$").unwrap();

    let mut i = 0;
    while i < lines.len() {
        let trimmed = lines[i].trim();
        if trimmed.starts_with("//") || trimmed.starts_with("#[") {
            i += 1;
            continue;
        }

        let caps = match fn_re.captures(trimmed) {
            Some(c) => c,
            None => { i += 1; continue; }
        };

        let _fn_name = caps.get(1).unwrap().as_str();
        let params_str = caps.get(2).unwrap().as_str().trim();
        let fn_line = i + 1;

        let has_return = return_re.captures(trimmed).is_some();
        let return_type = return_re.captures(trimmed)
            .and_then(|c| c.get(1))
            .map(|m| m.as_str().trim().to_string());

        let (body, body_end) = extract_fn_body(lines, i);
        let body_trimmed = body.trim();

        if !body_trimmed.is_empty() {
            if body_trimmed == "{}" || body_trimmed == "{ }" {
                if has_return {
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
                    context: format!("{} {{ {} }}", trimmed.trim_end_matches('{').trim(), body_trimmed.trim_matches(|c| c == '{' || c == '}').trim()),
                });
            }

            if !params_str.is_empty() && params_str != "&self" && params_str != "&mut self" && params_str != "self" {
                if all_params_ignored(params_str) {
                    reports.push(StubReport {
                        path: path.to_string(),
                        line: fn_line,
                        pattern: StubPattern::IgnoredParams,
                        context: trimmed.to_string(),
                    });
                }
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

    for j in fn_line_idx..lines.len() {
        for ch in lines[j].chars() {
            match ch {
                '{' => { depth += 1; started = true; }
                '}' => depth -= 1,
                _ => {}
            }
        }
        body.push_str(lines[j].trim());
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
        let name = p.split(':').next().unwrap_or("").trim().trim_start_matches("mut ");
        if name.starts_with('_') && name.len() > 1 {
            ignored_count += 1;
        }
    }

    named_count > 0 && named_count == ignored_count
}

// ---------------------------------------------------------------------------
// Task-aware file retrieval (Phase 5A)
// ---------------------------------------------------------------------------

/// Parse task title and description for crate names, type names, and module
/// names.  Returns a deduplicated list of keywords useful for matching files.
fn extract_task_keywords(task_title: &str, task_description: &str) -> Vec<String> {
    let combined = format!("{} {}", task_title, task_description);
    let mut keywords: Vec<String> = Vec::new();
    let mut seen = std::collections::HashSet::new();

    let type_re = Regex::new(r"\b([A-Z][a-zA-Z0-9]+)\b").unwrap();
    for cap in type_re.captures_iter(&combined) {
        let word = cap[1].to_string();
        if word.len() >= 3 && !COMMON_WORDS.contains(&word.as_str()) && seen.insert(word.clone()) {
            keywords.push(word);
        }
    }

    let crate_re = Regex::new(r"\b(aura[_-]\w+)\b").unwrap();
    for cap in crate_re.captures_iter(&combined) {
        let name = cap[1].replace('-', "_");
        if seen.insert(name.clone()) {
            keywords.push(name);
        }
    }

    let mod_re = Regex::new(r"\b([a-z][a-z0-9_]{2,})\b").unwrap();
    for cap in mod_re.captures_iter(&combined) {
        let word = cap[1].to_string();
        if !COMMON_MODULE_STOP_WORDS.contains(&word.as_str()) && seen.insert(word.clone()) {
            keywords.push(word);
        }
    }

    keywords
}

const COMMON_WORDS: &[&str] = &[
    "The", "This", "That", "With", "From", "Into", "Each", "Some", "None",
    "Result", "Option", "String", "Vec", "HashMap", "Arc", "Box", "Mutex",
    "Default", "Clone", "Debug", "Display", "Error", "Send", "Sync",
    "Implement", "Create", "Update", "Delete", "Add", "Remove", "Set", "Get",
    "New", "Test", "Build", "Run", "Fix", "Use", "For", "All", "Any",
];

const COMMON_MODULE_STOP_WORDS: &[&str] = &[
    "the", "this", "that", "with", "from", "into", "each", "some", "none",
    "and", "for", "not", "are", "but", "all", "any", "can", "has", "was",
    "will", "use", "its", "let", "new", "our", "try", "may", "should",
    "must", "also", "just", "than", "then", "when", "who", "how", "what",
    "pub", "mod", "impl", "self", "super", "crate", "where", "type",
    "struct", "enum", "trait", "async", "await", "move", "return",
    "true", "false", "mut", "ref", "str", "run", "set", "get", "add",
    "using", "create", "implement", "update", "delete", "task", "file",
    "code", "test", "build", "make", "does", "like", "have", "been",
];

/// Identify which workspace crate(s) the task most likely targets based on
/// keywords in the title and description.  Returns the member paths (e.g.
/// `"crates/domain/orgs"`) sorted by relevance.
fn identify_target_crates(
    task_title: &str,
    task_description: &str,
    members: &[String],
    crate_names: &HashMap<String, String>,
) -> Vec<String> {
    let combined = format!("{} {}", task_title, task_description).to_lowercase();

    let mut scored: Vec<(String, u32)> = members
        .iter()
        .map(|member| {
            let name = crate_names.get(member).cloned().unwrap_or_default().to_lowercase();
            let name_underscored = name.replace('-', "_");
            let name_dashed = name.replace('_', "-");
            let mut score: u32 = 0;

            if combined.contains(&name) || combined.contains(&name_underscored) || combined.contains(&name_dashed) {
                score += 10;
            }

            let last_segment = member.rsplit('/').next().unwrap_or(member);
            if combined.contains(&last_segment.to_lowercase()) {
                score += 5;
            }

            (member.clone(), score)
        })
        .filter(|(_, score)| *score > 0)
        .collect();

    scored.sort_by(|a, b| b.1.cmp(&a.1));
    scored.into_iter().map(|(m, _)| m).collect()
}

/// Task-aware file retrieval: instead of a purely alphabetical walk, parse the
/// task description to identify target crates and prioritize relevant files.
///
/// Tiered priority:
/// - **Tier 1**: Target crate's Cargo.toml, lib.rs/main.rs, mod.rs files
/// - **Tier 2**: Dependency crates' lib.rs (signatures only)
/// - **Tier 3**: Files matching keyword patterns from the task description
/// - **Tier 4**: Remaining workspace files alphabetically (fallback)
pub fn retrieve_task_relevant_files(
    project_root: &str,
    task_title: &str,
    task_description: &str,
    max_bytes: usize,
) -> Result<String, EngineError> {
    let root = Path::new(project_root);
    let root_cargo = root.join("Cargo.toml");
    let cargo_content = match std::fs::read_to_string(&root_cargo) {
        Ok(c) => c,
        Err(_) => return read_relevant_files(project_root, max_bytes),
    };

    let members = parse_workspace_members(&cargo_content);
    if members.is_empty() {
        return read_relevant_files(project_root, max_bytes);
    }

    let mut crate_names: HashMap<String, String> = HashMap::new();
    let mut crate_internal_deps: HashMap<String, Vec<String>> = HashMap::new();

    for member in &members {
        let member_cargo = root.join(member).join("Cargo.toml");
        if let Ok(content) = std::fs::read_to_string(&member_cargo) {
            let name = parse_package_name(&content).unwrap_or_else(|| member.clone());
            let deps = parse_internal_deps(&content);
            crate_names.insert(member.clone(), name);
            crate_internal_deps.insert(member.clone(), deps);
        }
    }

    let target_crates = identify_target_crates(task_title, task_description, &members, &crate_names);
    let keywords = extract_task_keywords(task_title, task_description);

    let name_to_path: HashMap<String, String> = crate_names
        .iter()
        .map(|(path, name)| (name.clone(), path.clone()))
        .collect();

    let mut output = String::new();
    let mut current_size: usize = 0;
    let mut included_files: std::collections::HashSet<String> = std::collections::HashSet::new();

    // Tier 1: Target crate core files
    for target in &target_crates {
        if current_size >= max_bytes { break; }
        let crate_dir = root.join(target);

        let core_files = [
            crate_dir.join("Cargo.toml"),
            crate_dir.join("src").join("lib.rs"),
            crate_dir.join("src").join("main.rs"),
            crate_dir.join("src").join("mod.rs"),
        ];

        for file in &core_files {
            if current_size >= max_bytes { break; }
            if !file.exists() { continue; }
            let rel = file.strip_prefix(root).unwrap_or(file).display().to_string();
            if !included_files.insert(rel.clone()) { continue; }

            if let Ok(content) = std::fs::read_to_string(file) {
                let section = format!("--- {} ---\n{}\n\n", rel, content);
                if current_size + section.len() <= max_bytes {
                    output.push_str(&section);
                    current_size += section.len();
                }
            }
        }

        // Also include all .rs files in the target crate's src/
        let src_dir = crate_dir.join("src");
        if src_dir.is_dir() {
            collect_rs_files_recursive(root, &src_dir, &mut output, &mut current_size, max_bytes, &mut included_files)?;
        }
    }

    // Tier 2: Dependency crates' lib.rs (signatures only)
    let dep_crate_paths: Vec<String> = target_crates
        .iter()
        .flat_map(|tc| crate_internal_deps.get(tc).cloned().unwrap_or_default())
        .filter_map(|dep_name| name_to_path.get(&dep_name).cloned())
        .collect();

    for dep_path in &dep_crate_paths {
        if current_size >= max_bytes { break; }
        let lib_rs = root.join(dep_path).join("src").join("lib.rs");
        if !lib_rs.exists() { continue; }
        let rel = lib_rs.strip_prefix(root).unwrap_or(&lib_rs).display().to_string();
        if !included_files.insert(rel.clone()) { continue; }

        match read_signatures_only(&lib_rs) {
            Ok(sigs) if !sigs.is_empty() => {
                let section = format!("--- {} [signatures] ---\n{}\n\n", rel, sigs);
                if current_size + section.len() <= max_bytes {
                    output.push_str(&section);
                    current_size += section.len();
                }
            }
            _ => {}
        }
    }

    // Tier 3: Files matching keyword patterns from the task description
    if current_size < max_bytes && !keywords.is_empty() {
        let mut keyword_matches: Vec<(String, std::path::PathBuf)> = Vec::new();
        collect_keyword_matching_files(root, root, &keywords, &mut keyword_matches, &included_files);
        keyword_matches.sort_by(|a, b| a.0.cmp(&b.0));

        for (rel, full) in keyword_matches {
            if current_size >= max_bytes { break; }
            if !included_files.insert(rel.clone()) { continue; }

            if let Ok(content) = std::fs::read_to_string(&full) {
                let section = if content.len() > 8_000 && rel.ends_with(".rs") {
                    let sigs = extract_signatures_from_content(&content);
                    if sigs.len() < content.len() / 2 && !sigs.is_empty() {
                        format!("--- {} [signatures] ---\n{}\n\n", rel, sigs)
                    } else {
                        format!("--- {} ---\n{}\n\n", rel, content)
                    }
                } else {
                    format!("--- {} ---\n{}\n\n", rel, content)
                };

                if current_size + section.len() <= max_bytes {
                    output.push_str(&section);
                    current_size += section.len();
                }
            }
        }
    }

    // Tier 4: Remaining workspace files alphabetically (existing behavior)
    if current_size < max_bytes {
        walk_and_collect_filtered(root, root, &mut output, &mut current_size, max_bytes, &mut included_files)?;
    }

    Ok(output)
}

/// Collect all .rs files in a directory recursively, reading full content.
fn collect_rs_files_recursive(
    base: &Path,
    dir: &Path,
    output: &mut String,
    current_size: &mut usize,
    max_bytes: usize,
    included: &mut std::collections::HashSet<String>,
) -> Result<(), EngineError> {
    let entries = match std::fs::read_dir(dir) {
        Ok(e) => e,
        Err(_) => return Ok(()),
    };
    let mut entries: Vec<_> = entries.filter_map(|e| e.ok()).collect();
    entries.sort_by_key(|e| e.file_name());

    for entry in entries {
        if *current_size >= max_bytes { break; }
        let path = entry.path();
        let fname = entry.file_name().to_string_lossy().to_string();

        if path.is_dir() {
            if SKIP_DIRS.contains(&fname.as_str()) { continue; }
            collect_rs_files_recursive(base, &path, output, current_size, max_bytes, included)?;
        } else if path.extension().and_then(|e| e.to_str()) == Some("rs") {
            let rel = path.strip_prefix(base).unwrap_or(&path).display().to_string();
            if !included.insert(rel.clone()) { continue; }
            if let Ok(content) = std::fs::read_to_string(&path) {
                let section = format!("--- {} ---\n{}\n\n", rel, content);
                if *current_size + section.len() <= max_bytes {
                    output.push_str(&section);
                    *current_size += section.len();
                }
            }
        }
    }
    Ok(())
}

/// Walk the filesystem looking for files whose path or content matches any of
/// the given keywords.  Only matches filenames, not content (to stay fast).
fn collect_keyword_matching_files(
    base: &Path,
    dir: &Path,
    keywords: &[String],
    results: &mut Vec<(String, std::path::PathBuf)>,
    already_included: &std::collections::HashSet<String>,
) {
    let entries = match std::fs::read_dir(dir) {
        Ok(e) => e,
        Err(_) => return,
    };
    for entry in entries.filter_map(|e| e.ok()) {
        let path = entry.path();
        let fname = entry.file_name().to_string_lossy().to_string();

        if path.is_dir() {
            if SKIP_DIRS.contains(&fname.as_str()) { continue; }
            collect_keyword_matching_files(base, &path, keywords, results, already_included);
        } else if path.is_file() {
            let ext = path.extension().and_then(|e| e.to_str()).unwrap_or_default();
            if !INCLUDE_EXTENSIONS.contains(&ext) { continue; }

            let rel = path.strip_prefix(base).unwrap_or(&path).display().to_string();
            if already_included.contains(&rel) { continue; }

            let fname_lower = fname.to_lowercase();
            let matches = keywords.iter().any(|kw| {
                let kw_lower = kw.to_lowercase();
                fname_lower.contains(&kw_lower)
                    || kw_lower.contains(&fname_lower.trim_end_matches(".rs"))
            });
            if matches {
                results.push((rel, path));
            }
        }
    }
}

/// Like `walk_and_collect` but skips already-included files.
fn walk_and_collect_filtered(
    base: &Path,
    dir: &Path,
    output: &mut String,
    current_size: &mut usize,
    max_bytes: usize,
    included: &mut std::collections::HashSet<String>,
) -> Result<(), EngineError> {
    let entries = std::fs::read_dir(dir).map_err(|e| EngineError::Io(e.to_string()))?;
    let mut entries: Vec<_> = entries.filter_map(|e| e.ok()).collect();
    entries.sort_by_key(|e| e.file_name());

    for entry in entries {
        if *current_size >= max_bytes { break; }
        let path = entry.path();
        let file_name = entry.file_name().to_string_lossy().to_string();

        if path.is_dir() {
            if SKIP_DIRS.contains(&file_name.as_str()) { continue; }
            walk_and_collect_filtered(base, &path, output, current_size, max_bytes, included)?;
        } else if path.is_file() {
            let extension = path.extension().and_then(|e| e.to_str()).unwrap_or_default();
            if !INCLUDE_EXTENSIONS.contains(&extension) { continue; }

            let rel = path.strip_prefix(base).unwrap_or(&path).display().to_string();
            if !included.insert(rel.clone()) { continue; }

            let content = std::fs::read_to_string(&path).map_err(|e| EngineError::Io(e.to_string()))?;
            let section = format!("--- {} ---\n{}\n\n", rel, content);
            if *current_size + section.len() > max_bytes { break; }
            output.push_str(&section);
            *current_size += section.len();
        }
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Crate dependency graph traversal (Phase 5B)
// ---------------------------------------------------------------------------

/// Resolve the public API surface of a target crate's workspace dependencies
/// (and their transitive dependencies up to `max_depth`).  For each dependency,
/// reads `lib.rs` in signature-only mode.  Returns a formatted context block
/// suitable for prompt injection.
pub fn resolve_crate_api_context(
    project_root: &str,
    target_crate: &str,
    max_bytes: usize,
) -> Result<String, EngineError> {
    let root = Path::new(project_root);
    let root_cargo = root.join("Cargo.toml");
    let cargo_content = match std::fs::read_to_string(&root_cargo) {
        Ok(c) => c,
        Err(_) => return Ok(String::new()),
    };

    let members = parse_workspace_members(&cargo_content);
    if members.is_empty() {
        return Ok(String::new());
    }

    let mut crate_names: HashMap<String, String> = HashMap::new();
    let mut crate_deps: HashMap<String, Vec<String>> = HashMap::new();
    let mut name_to_path: HashMap<String, String> = HashMap::new();

    for member in &members {
        let member_cargo = root.join(member).join("Cargo.toml");
        if let Ok(content) = std::fs::read_to_string(&member_cargo) {
            let name = parse_package_name(&content).unwrap_or_else(|| member.clone());
            let internal_deps = parse_internal_deps(&content);
            name_to_path.insert(name.clone(), member.clone());
            crate_names.insert(member.clone(), name);
            crate_deps.insert(member.clone(), internal_deps);
        }
    }

    let target_path = if members.contains(&target_crate.to_string()) {
        target_crate.to_string()
    } else if let Some(path) = name_to_path.get(target_crate) {
        path.clone()
    } else {
        return Ok(String::new());
    };

    const MAX_DEPTH: usize = 2;
    let mut visited: std::collections::HashSet<String> = std::collections::HashSet::new();
    visited.insert(target_path.clone());

    let mut queue: Vec<(String, usize)> = Vec::new();
    if let Some(deps) = crate_deps.get(&target_path) {
        for dep_name in deps {
            if let Some(dep_path) = name_to_path.get(dep_name) {
                if visited.insert(dep_path.clone()) {
                    queue.push((dep_path.clone(), 1));
                }
            }
        }
    }

    let mut output = String::new();
    let mut remaining = max_bytes;
    let mut idx = 0;

    while idx < queue.len() {
        if remaining == 0 { break; }
        let (member_path, depth) = queue[idx].clone();
        idx += 1;

        let crate_name = crate_names.get(&member_path).cloned().unwrap_or_else(|| member_path.clone());
        let target_name = crate_names.get(&target_path).cloned().unwrap_or_else(|| target_path.clone());

        let lib_rs = root.join(&member_path).join("src").join("lib.rs");
        if !lib_rs.exists() { continue; }

        let sigs = match read_signatures_only(&lib_rs) {
            Ok(s) if !s.is_empty() => s,
            _ => continue,
        };

        let section = format!(
            "# API Surface: {} (dependency of {})\n{}\n\n",
            crate_name, target_name, sigs,
        );

        if section.len() > remaining { continue; }
        output.push_str(&section);
        remaining = remaining.saturating_sub(section.len());

        if depth < MAX_DEPTH {
            if let Some(transitive_deps) = crate_deps.get(&member_path) {
                for dep_name in transitive_deps {
                    if let Some(dep_path) = name_to_path.get(dep_name) {
                        if visited.insert(dep_path.clone()) {
                            queue.push((dep_path.clone(), depth + 1));
                        }
                    }
                }
            }
        }
    }

    Ok(output)
}

/// Convenience wrapper: identify target crates from a task's title and
/// description, then resolve the API surface of their transitive dependencies.
pub fn resolve_task_dep_api_context(
    project_root: &str,
    task_title: &str,
    task_description: &str,
    max_bytes: usize,
) -> Result<String, EngineError> {
    let root = Path::new(project_root);
    let root_cargo = root.join("Cargo.toml");
    let cargo_content = match std::fs::read_to_string(&root_cargo) {
        Ok(c) => c,
        Err(_) => return Ok(String::new()),
    };

    let members = parse_workspace_members(&cargo_content);
    if members.is_empty() {
        return Ok(String::new());
    }

    let mut crate_names: HashMap<String, String> = HashMap::new();
    for member in &members {
        let member_cargo = root.join(member).join("Cargo.toml");
        if let Ok(content) = std::fs::read_to_string(&member_cargo) {
            let name = parse_package_name(&content).unwrap_or_else(|| member.clone());
            crate_names.insert(member.clone(), name);
        }
    }

    let targets = identify_target_crates(task_title, task_description, &members, &crate_names);
    if targets.is_empty() {
        return Ok(String::new());
    }

    let mut output = String::new();
    let mut remaining = max_bytes;

    for target in &targets {
        if remaining == 0 { break; }
        let section = resolve_crate_api_context(project_root, target, remaining)?;
        if !section.is_empty() {
            remaining = remaining.saturating_sub(section.len());
            output.push_str(&section);
        }
    }

    Ok(output)
}

/// Check whether a line is an `impl` block header for the given type name.
/// Handles `impl Type`, `impl<T> Type<T>`, `impl Trait for Type`, etc.
fn is_impl_for_type(line: &str, type_name: &str) -> bool {
    if !line.starts_with("impl") {
        return false;
    }
    if line.len() > 4 {
        let fifth = line.as_bytes()[4];
        if fifth.is_ascii_alphanumeric() || fifth == b'_' {
            return false;
        }
    }

    let bytes = line.as_bytes();
    let tn_bytes = type_name.as_bytes();
    let tn_len = tn_bytes.len();

    let mut i = 4;
    while i + tn_len <= bytes.len() {
        if &bytes[i..i + tn_len] == tn_bytes {
            let before_ok =
                i == 0 || !(bytes[i - 1].is_ascii_alphanumeric() || bytes[i - 1] == b'_');
            let after_ok = i + tn_len >= bytes.len()
                || !(bytes[i + tn_len].is_ascii_alphanumeric() || bytes[i + tn_len] == b'_');
            if before_ok && after_ok {
                return true;
            }
        }
        i += 1;
    }
    false
}
