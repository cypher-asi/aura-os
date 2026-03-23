use std::collections::HashSet;
use std::path::Path;

use super::source_parser::{extract_pub_signatures, extract_struct_fields};
use super::{ErrorReferences, SKIP_DIRS};

const RESOLVE_BUDGET: usize = 10_240;
const MAX_TYPE_FILES: usize = 5;

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
pub fn resolve_error_source_files(
    base_path: &Path,
    refs: &ErrorReferences,
    budget: usize,
) -> String {
    if refs.source_locations.is_empty() {
        return String::new();
    }

    let mut seen = HashSet::new();
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

fn walk_for_type_sources(
    base: &Path,
    dir: &Path,
    type_name: &str,
    results: &mut Vec<(String, String)>,
    seen: &mut HashSet<String>,
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
