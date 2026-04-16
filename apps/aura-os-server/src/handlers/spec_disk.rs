//! Mirrors persisted specs onto the project's local filesystem under
//! `<workspace_root>/spec/<slug>.md`. Disk writes are best-effort — they must
//! not break the DB-write path, so all failures are logged and swallowed.

use std::path::{Path, PathBuf};

use tracing::{debug, warn};

/// Slugify a spec title into a kebab-case stem used for the on-disk filename.
///
/// Mirrors [`interface/src/utils/format.ts::slugifyTitle`]: lowercase,
/// collapse any run of non-alphanumeric characters into a single `-`, trim
/// leading/trailing dashes, fall back to `"spec"` when the result would be
/// empty.
pub fn spec_slug(title: &str) -> String {
    let lowered = title.to_ascii_lowercase();
    let mut slug = String::with_capacity(lowered.len());
    let mut prev_dash = false;
    for ch in lowered.chars() {
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
        "spec".to_string()
    } else {
        slug
    }
}

/// Returns `<slug>.md` — the filename used inside `<workspace_root>/spec/`.
pub fn spec_filename(title: &str) -> String {
    format!("{}.md", spec_slug(title))
}

/// Absolute on-disk path for a spec with the given title, rooted under the
/// project's workspace.
pub fn spec_disk_path(workspace_root: &Path, title: &str) -> PathBuf {
    workspace_root.join("spec").join(spec_filename(title))
}

/// Write (or rewrite) the markdown for a spec under
/// `<workspace_root>/spec/<slug>.md`.
///
/// If `old_title` is `Some` and its slug differs from `new_title`'s, the stale
/// file is removed first so a rename doesn't leave orphaned copies on disk.
pub async fn mirror_spec_to_disk(
    workspace_root: &Path,
    old_title: Option<&str>,
    new_title: &str,
    markdown: &str,
) -> std::io::Result<PathBuf> {
    let spec_dir = workspace_root.join("spec");
    tokio::fs::create_dir_all(&spec_dir).await?;

    let new_slug = spec_slug(new_title);
    if let Some(old) = old_title {
        let old_slug = spec_slug(old);
        if old_slug != new_slug {
            let old_path = spec_dir.join(format!("{old_slug}.md"));
            match tokio::fs::remove_file(&old_path).await {
                Ok(()) => debug!(path = %old_path.display(), "removed stale spec file on rename"),
                Err(err) if err.kind() == std::io::ErrorKind::NotFound => {}
                Err(err) => warn!(path = %old_path.display(), %err, "failed to remove stale spec file"),
            }
        }
    }

    let target = spec_dir.join(format!("{new_slug}.md"));
    tokio::fs::write(&target, markdown).await?;
    debug!(path = %target.display(), bytes = markdown.len(), "mirrored spec to disk");
    Ok(target)
}

/// Best-effort delete of the on-disk mirror for a spec. `NotFound` is treated
/// as success; any other I/O error is surfaced to the caller who can decide
/// whether to log it.
pub async fn remove_spec_from_disk(
    workspace_root: &Path,
    title: &str,
) -> std::io::Result<()> {
    let path = spec_disk_path(workspace_root, title);
    match tokio::fs::remove_file(&path).await {
        Ok(()) => Ok(()),
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(err) => Err(err),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn slug_basic() {
        assert_eq!(spec_slug("Hello World Website"), "hello-world-website");
    }

    #[test]
    fn slug_collapses_runs_of_non_alphanumeric() {
        assert_eq!(
            spec_slug("Spec!!  with   weird___chars"),
            "spec-with-weird-chars"
        );
    }

    #[test]
    fn slug_trims_leading_and_trailing_dashes() {
        assert_eq!(spec_slug("  --Trim me--  "), "trim-me");
    }

    #[test]
    fn slug_falls_back_to_spec_for_empty_inputs() {
        assert_eq!(spec_slug(""), "spec");
        assert_eq!(spec_slug("???"), "spec");
        assert_eq!(spec_slug("   "), "spec");
    }

    #[test]
    fn filename_appends_md() {
        assert_eq!(spec_filename("Hello"), "hello.md");
        assert_eq!(spec_filename(""), "spec.md");
    }

    #[tokio::test]
    async fn mirror_creates_file_under_spec_dir() {
        let tmp = tempfile::tempdir().unwrap();
        let path = mirror_spec_to_disk(tmp.path(), None, "My Spec", "# body")
            .await
            .unwrap();
        assert_eq!(path, tmp.path().join("spec").join("my-spec.md"));
        let contents = tokio::fs::read_to_string(&path).await.unwrap();
        assert_eq!(contents, "# body");
    }

    #[tokio::test]
    async fn mirror_removes_old_file_on_rename() {
        let tmp = tempfile::tempdir().unwrap();
        mirror_spec_to_disk(tmp.path(), None, "Old Title", "old")
            .await
            .unwrap();
        let new_path = mirror_spec_to_disk(tmp.path(), Some("Old Title"), "New Title", "new")
            .await
            .unwrap();
        let old_path = tmp.path().join("spec").join("old-title.md");
        assert!(!old_path.exists(), "stale slug file should be removed");
        assert_eq!(new_path, tmp.path().join("spec").join("new-title.md"));
        assert_eq!(tokio::fs::read_to_string(&new_path).await.unwrap(), "new");
    }

    #[tokio::test]
    async fn mirror_is_idempotent_when_title_unchanged() {
        let tmp = tempfile::tempdir().unwrap();
        mirror_spec_to_disk(tmp.path(), None, "Keep", "v1").await.unwrap();
        let path = mirror_spec_to_disk(tmp.path(), Some("Keep"), "Keep", "v2")
            .await
            .unwrap();
        assert_eq!(tokio::fs::read_to_string(&path).await.unwrap(), "v2");
    }

    #[tokio::test]
    async fn remove_is_best_effort_when_missing() {
        let tmp = tempfile::tempdir().unwrap();
        remove_spec_from_disk(tmp.path(), "never-written")
            .await
            .unwrap();
    }
}
