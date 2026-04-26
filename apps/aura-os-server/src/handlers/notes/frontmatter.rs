//! YAML frontmatter parsing/rendering, title extraction, and tiny helpers
//! for word counting and `.md` file probes.
//!
//! Notes use a hand-rolled YAML subset (only `created_at`, `created_by`, and
//! `updated_at` keys) so we don't pay for serde_yaml here. The parser is
//! deliberately permissive: it only inspects keys it knows about and treats
//! every other line inside the fence as opaque.

use std::path::Path;

use serde::{Deserialize, Serialize};

const TITLE_PROBE_BYTES: usize = 2048;

/// Extract the display title from a note's markdown content.
///
/// Skips any leading YAML frontmatter block (between `---` fences), takes the
/// first non-empty line that follows, and strips leading `#` characters and
/// whitespace. Returns the empty string when the file has no textual content.
pub(super) fn extract_title(content: &str) -> String {
    let mut lines = content.lines();
    if matches!(lines.clone().next().map(str::trim), Some("---")) {
        let _ = lines.next();
        for line in lines.by_ref() {
            if line.trim() == "---" {
                break;
            }
        }
    }
    for line in lines {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        let without_hashes = trimmed.trim_start_matches('#').trim();
        return without_hashes.to_string();
    }
    String::new()
}

#[derive(Debug, Default, Serialize, Deserialize, Clone)]
pub(crate) struct NoteFrontmatter {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub created_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub created_by: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub updated_at: Option<String>,
}

/// Split a markdown document into `(frontmatter, body)`. If the document has
/// no YAML frontmatter block, returns `(Default::default(), content)`.
pub(super) fn parse_frontmatter(content: &str) -> (NoteFrontmatter, String) {
    let mut lines = content.lines();
    let first = lines.next();
    if first.map(str::trim) != Some("---") {
        return (NoteFrontmatter::default(), content.to_string());
    }
    let mut fm = NoteFrontmatter::default();
    let mut body_start: Option<usize> = None;
    let mut consumed = first.map(|l| l.len() + 1).unwrap_or(0);
    for line in lines {
        consumed += line.len() + 1;
        if line.trim() == "---" {
            body_start = Some(consumed);
            break;
        }
        if let Some((key, value)) = line.split_once(':') {
            let key = key.trim();
            let value = value.trim().trim_matches(|c: char| c == '"' || c == '\'');
            match key {
                "created_at" => fm.created_at = Some(value.to_string()),
                "created_by" => fm.created_by = Some(value.to_string()),
                "updated_at" => fm.updated_at = Some(value.to_string()),
                _ => {}
            }
        }
    }
    let body = body_start
        .and_then(|idx| content.get(idx..))
        .map(|b| b.trim_start_matches('\n').to_string())
        .unwrap_or_default();
    (fm, body)
}

fn render_frontmatter(fm: &NoteFrontmatter) -> String {
    let mut out = String::from("---\n");
    if let Some(v) = &fm.created_at {
        out.push_str(&format!("created_at: {v}\n"));
    }
    if let Some(v) = &fm.created_by {
        out.push_str(&format!("created_by: {v}\n"));
    }
    if let Some(v) = &fm.updated_at {
        out.push_str(&format!("updated_at: {v}\n"));
    }
    out.push_str("---\n\n");
    out
}

pub(super) fn render_note(fm: &NoteFrontmatter, body: &str) -> String {
    let mut out = render_frontmatter(fm);
    out.push_str(body.trim_start_matches('\n'));
    out
}

pub(super) fn word_count_of(body: &str) -> usize {
    body.split_whitespace().count()
}

pub(super) fn read_title_probe(path: &Path) -> std::io::Result<String> {
    use std::io::Read;
    let mut file = std::fs::File::open(path)?;
    let mut buf = vec![0u8; TITLE_PROBE_BYTES];
    let n = file.read(&mut buf)?;
    buf.truncate(n);
    Ok(String::from_utf8_lossy(&buf).into_owned())
}

pub(super) fn strip_md_ext(name: &str) -> &str {
    name.strip_suffix(".md").unwrap_or(name)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extract_title_strips_frontmatter_and_heading() {
        let content = "---\ncreated_at: 2026\n---\n\n# Hello world\n\nbody";
        assert_eq!(extract_title(content), "Hello world");
    }

    #[test]
    fn extract_title_without_frontmatter() {
        assert_eq!(extract_title("# Just a heading"), "Just a heading");
    }

    #[test]
    fn extract_title_without_heading() {
        assert_eq!(
            extract_title("plain first line\n\nrest"),
            "plain first line"
        );
    }

    #[test]
    fn extract_title_empty_document() {
        assert_eq!(extract_title(""), "");
    }

    #[test]
    fn parse_frontmatter_round_trip() {
        let doc = "---\ncreated_at: 2026-04-17\ncreated_by: u1\nupdated_at: 2026-04-17\n---\n\n# Title\n\nBody";
        let (fm, body) = parse_frontmatter(doc);
        assert_eq!(fm.created_at.as_deref(), Some("2026-04-17"));
        assert_eq!(fm.created_by.as_deref(), Some("u1"));
        assert!(body.starts_with("# Title"));
    }
}
