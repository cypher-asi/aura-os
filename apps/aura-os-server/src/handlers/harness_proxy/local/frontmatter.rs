//! YAML frontmatter parsing and escaping helpers used by the local
//! skills handlers.

/// Escape a string for use as a YAML double-quoted scalar value.
/// The caller wraps the result in `"..."` — this function escapes the interior.
pub(super) fn yaml_escape_scalar(s: &str) -> String {
    s.replace('\\', "\\\\")
        .replace('"', "\\\"")
        .replace('\n', "\\n")
        .replace('\r', "\\r")
        .replace('\t', "\\t")
}

pub(super) fn extract_frontmatter_field(content: &str, key: &str) -> Option<String> {
    let trimmed = content.trim();
    if !trimmed.starts_with("---") {
        return None;
    }
    let end = trimmed[3..].find("\n---")?;
    let yaml = &trimmed[3..3 + end];
    let prefix = format!("{key}:");
    for line in yaml.lines() {
        let line = line.trim();
        if let Some(val) = line.strip_prefix(&prefix) {
            return Some(val.trim().trim_matches('"').to_string());
        }
    }
    None
}

pub(super) fn strip_frontmatter(content: &str) -> String {
    let trimmed = content.trim();
    if !trimmed.starts_with("---") {
        return content.to_string();
    }
    match trimmed[3..].find("\n---") {
        Some(end) => trimmed[3 + end + 4..].trim_start().to_string(),
        None => content.to_string(),
    }
}
