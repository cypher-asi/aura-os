//! Path safety, sanitization, and lightweight time helpers shared by every
//! notes submodule.
//!
//! All of these helpers are deliberately filesystem-only: they don't touch
//! the project store, the data directory, or any tokio runtime so they can
//! be reused freely from sync paths (tests, walks) and async handlers.

use std::path::{Component, Path, PathBuf};
use std::time::SystemTime;

use chrono::{DateTime, Utc};

use crate::error::{ApiError, ApiResult};

/// Validate a caller-supplied relative path and return it joined onto `root`.
///
/// Rejects any path that contains traversal, absolute components, windows
/// drive/root prefixes, or `..` segments. Empty input is treated as the root.
pub(super) fn resolve_rel_path(root: &Path, rel: &str) -> ApiResult<PathBuf> {
    let trimmed = rel.trim();
    if trimmed.is_empty() {
        return Ok(root.to_path_buf());
    }
    if trimmed.starts_with('/')
        || trimmed.starts_with('\\')
        || trimmed.chars().nth(1).map(|c| c == ':').unwrap_or(false)
    {
        return Err(ApiError::bad_request(format!(
            "absolute path is not allowed: `{rel}`"
        )));
    }
    let candidate = Path::new(trimmed);
    for component in candidate.components() {
        match component {
            Component::Normal(_) => {}
            Component::CurDir => {}
            Component::ParentDir | Component::RootDir | Component::Prefix(_) => {
                return Err(ApiError::bad_request(format!(
                    "illegal path segment in `{rel}`"
                )));
            }
        }
    }
    Ok(root.join(candidate))
}

/// Sanitize a user-supplied filename/folder-name to a safe on-disk segment.
///
/// Strips path separators, control characters, and leading/trailing whitespace
/// or dots. Falls back to `fallback` when the result would be empty.
pub(super) fn sanitize_segment(name: &str, fallback: &str) -> String {
    let mut out = String::with_capacity(name.len());
    for ch in name.chars() {
        if ch.is_control() {
            continue;
        }
        match ch {
            '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' | '\0' => out.push('-'),
            _ => out.push(ch),
        }
    }
    let trimmed = out
        .trim()
        .trim_matches('.')
        .trim_matches(|c: char| c.is_whitespace())
        .to_string();
    if trimmed.is_empty() {
        fallback.to_string()
    } else {
        trimmed
    }
}

/// Slugify a user-typed title into a kebab-case filename stem.
pub(super) fn slug_stem(name: &str) -> String {
    let mut slug = String::with_capacity(name.len());
    let mut prev_dash = false;
    for ch in name.to_lowercase().chars() {
        if ch.is_ascii_alphanumeric() {
            slug.push(ch);
            prev_dash = false;
        } else if !prev_dash && !slug.is_empty() {
            slug.push('-');
            prev_dash = true;
        }
    }
    while slug.ends_with('-') {
        slug.pop();
    }
    if slug.is_empty() {
        "untitled".to_string()
    } else {
        slug
    }
}

/// Pick a non-colliding sibling path by appending `-2`, `-3`, … before the
/// extension. Bails out at 10 000 attempts to avoid pathological loops.
pub(super) fn unique_path(mut target: PathBuf) -> PathBuf {
    if !target.exists() {
        return target;
    }
    let parent = target.parent().map(|p| p.to_path_buf()).unwrap_or_default();
    let file_name = target
        .file_name()
        .map(|f| f.to_string_lossy().into_owned())
        .unwrap_or_default();
    let (stem, suffix) = match file_name.rsplit_once('.') {
        Some((stem, ext)) if !ext.is_empty() && !stem.is_empty() => {
            (stem.to_string(), format!(".{ext}"))
        }
        _ => (file_name.clone(), String::new()),
    };
    let mut counter = 2u32;
    loop {
        let candidate = parent.join(format!("{stem}-{counter}{suffix}"));
        if !candidate.exists() {
            target = candidate;
            break;
        }
        counter += 1;
        if counter > 10_000 {
            break;
        }
    }
    target
}

pub(super) fn iso_now() -> String {
    let now: DateTime<Utc> = SystemTime::now().into();
    now.to_rfc3339()
}

pub(super) fn system_time_to_rfc3339(t: SystemTime) -> Option<String> {
    Some(DateTime::<Utc>::from(t).to_rfc3339())
}

pub(super) fn to_forward_slashes(p: &Path) -> String {
    p.to_string_lossy().replace('\\', "/")
}

pub(super) fn rel_of(root: &Path, absolute: &Path) -> String {
    let rel = absolute.strip_prefix(root).unwrap_or(absolute);
    to_forward_slashes(rel)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn setup() -> (TempDir, PathBuf) {
        let tmp = TempDir::new().unwrap();
        let root = tmp.path().join("notes").join("proj-1");
        std::fs::create_dir_all(&root).unwrap();
        (tmp, root)
    }

    #[test]
    fn resolve_rel_path_rejects_traversal() {
        let (_tmp, root) = setup();
        assert!(resolve_rel_path(&root, "..").is_err());
        assert!(resolve_rel_path(&root, "foo/../../bar").is_err());
        assert!(resolve_rel_path(&root, "/etc/passwd").is_err());
    }

    #[test]
    fn resolve_rel_path_accepts_nested() {
        let (_tmp, root) = setup();
        let resolved = resolve_rel_path(&root, "a/b/c.md").unwrap();
        assert!(resolved.starts_with(&root));
    }

    #[test]
    fn slug_stem_basic() {
        assert_eq!(slug_stem("Hello World"), "hello-world");
        assert_eq!(slug_stem("!!!"), "untitled");
    }

    #[test]
    fn sanitize_segment_strips_bad_characters() {
        assert_eq!(sanitize_segment("hello/world", "fb"), "hello-world");
        assert_eq!(sanitize_segment("   ", "fb"), "fb");
    }

    #[test]
    fn unique_path_appends_counter() {
        let (_tmp, root) = setup();
        let first = root.join("note.md");
        std::fs::write(&first, "").unwrap();
        let next = unique_path(first.clone());
        assert_eq!(next.file_name().unwrap().to_string_lossy(), "note-2.md");
    }
}
