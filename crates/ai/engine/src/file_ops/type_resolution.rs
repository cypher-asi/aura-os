use std::path::Path;

use super::task_keywords::extract_type_names_from_text;

/// Resolve struct, trait, and enum definitions for type names mentioned in the
/// task description and spec. Returns a formatted section listing definitions
/// and method signatures, giving the model accurate API information upfront
/// to prevent field name and method hallucination.
fn build_type_section(type_name: &str, sources: &[(String, String)]) -> String {
    let mut section = String::new();
    let mut has_content = false;

    for (rel_path, content) in sources {
        if let Some(def) = super::extract_definition_block(content, type_name) {
            if !has_content {
                section.push_str(&format!("### {} ({})\n", type_name, rel_path));
                has_content = true;
            } else {
                section.push_str(&format!("  (also in {})\n", rel_path));
            }
            section.push_str(&def);
            section.push('\n');
        }

        let sigs = super::extract_pub_signatures(content, type_name);
        if !sigs.is_empty() {
            if !has_content {
                section.push_str(&format!("### {} ({})\n", type_name, rel_path));
                has_content = true;
            }
            for sig in &sigs {
                section.push_str(sig);
                section.push('\n');
            }
        }
    }
    if has_content {
        section.push('\n');
    }
    section
}

pub fn resolve_type_definitions_for_task(
    project_root: &str,
    task_title: &str,
    task_description: &str,
    spec_content: &str,
    budget: usize,
) -> String {
    let combined = format!("{} {} {}", task_title, task_description, spec_content);
    let type_names = extract_type_names_from_text(&combined);
    if type_names.is_empty() {
        return String::new();
    }

    let base_path = Path::new(project_root);
    let mut output = String::new();
    let mut remaining = budget;

    for type_name in &type_names {
        if remaining == 0 {
            break;
        }
        let sources = super::error_context::find_type_sources(base_path, type_name, &[]);
        if sources.is_empty() {
            continue;
        }
        let section = build_type_section(type_name, &sources);
        if !section.is_empty() && section.len() <= remaining {
            output.push_str(&section);
            remaining = remaining.saturating_sub(section.len());
        }
    }

    if output.is_empty() {
        String::new()
    } else {
        format!("## Key Type Definitions\n\n{}", output)
    }
}

/// Async wrapper that runs on a blocking thread.
pub async fn resolve_type_definitions_for_task_async(
    project_root: &str,
    task_title: &str,
    task_description: &str,
    spec_content: &str,
    budget: usize,
) -> String {
    let project_root = project_root.to_string();
    let task_title = task_title.to_string();
    let task_description = task_description.to_string();
    let spec_content = spec_content.to_string();
    tokio::task::spawn_blocking(move || {
        resolve_type_definitions_for_task(
            &project_root,
            &task_title,
            &task_description,
            &spec_content,
            budget,
        )
    })
    .await
    .unwrap_or_else(|e| {
        tracing::warn!("spawn_blocking for type resolution panicked or was cancelled: {e}");
        String::new()
    })
}

/// Check whether a line is an `impl` block header for the given type name.
pub(crate) fn is_impl_for_type(line: &str, type_name: &str) -> bool {
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
