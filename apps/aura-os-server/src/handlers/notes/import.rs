//! One-time importer for legacy filesystem notes.
//!
//! Notes used to live on disk as `.md` files (with optional YAML
//! frontmatter and `<name>.md.comments.json` sidecars) under either
//! `<workspace>/notes/` or `<data_dir>/notes/<project_id>/`. They are now
//! first-class `aura-storage` rows with the markdown BODY on S3. This
//! module walks the legacy on-disk tree for a project and migrates each
//! note into storage: the body is uploaded to S3 through the aura-router
//! presign proxy, then a note row is created with the resulting
//! `bodyUrl` / `bodyS3Key` reference. Directory structure is mirrored as
//! note-folders and comment sidecars are replayed as note comments.
//!
//! The endpoint is sys-admin only and best-effort: per-file failures are
//! collected into the response `errors` list instead of aborting the run.

use std::collections::HashMap;
use std::path::{Path, PathBuf};

use axum::extract::{Path as AxumPath, State};
use axum::Json;
use serde::{Deserialize, Serialize};

use aura_os_core::ProjectId;
use aura_os_storage::{CreateNoteCommentRequest, CreateNoteFolderRequest, CreateNoteRequest};

use crate::error::ApiResult;
use crate::handlers::permissions::require_sys_admin;
use crate::handlers::upload::PresignResponse;
use crate::state::{AppState, AuthJwt, AuthSession};

// ---------------------------------------------------------------------------
// Pure helper layer (no IO / network) — unit-tested below.
// ---------------------------------------------------------------------------

/// Extract the display title from a note's markdown content.
///
/// Skips any leading YAML frontmatter block (between `---` fences), takes the
/// first non-empty line that follows, and strips leading `#` characters and
/// whitespace. Returns the empty string when the file has no textual content.
pub(crate) fn extract_title(markdown: &str) -> String {
    let mut lines = markdown.lines();
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
        return trimmed.trim_start_matches('#').trim().to_string();
    }
    String::new()
}

/// Split a markdown document into `(frontmatter, body)`.
///
/// `frontmatter` is the raw text between the opening/closing `---` fences
/// (fences excluded, newline-joined); `body` is everything after the closing
/// fence with leading blank lines trimmed. When the document has no YAML
/// frontmatter block, returns `(String::new(), markdown)`.
pub(crate) fn strip_frontmatter(markdown: &str) -> (String, String) {
    let mut iter = markdown.lines();
    if iter.clone().next().map(str::trim) != Some("---") {
        return (String::new(), markdown.to_string());
    }
    // Consume the opening fence.
    let _ = iter.next();

    let mut fm_lines: Vec<&str> = Vec::new();
    let mut body_lines: Vec<&str> = Vec::new();
    let mut in_frontmatter = true;
    for line in iter {
        if in_frontmatter {
            if line.trim() == "---" {
                in_frontmatter = false;
                continue;
            }
            fm_lines.push(line);
        } else {
            body_lines.push(line);
        }
    }

    let frontmatter = fm_lines.join("\n");
    let body = body_lines.join("\n").trim_start_matches('\n').to_string();
    (frontmatter, body)
}

/// Parsed subset of the legacy note frontmatter we care about during import.
#[derive(Debug, Default, Clone, PartialEq, Eq)]
pub(crate) struct ParsedFrontmatter {
    pub created_at: Option<String>,
    pub created_by: Option<String>,
}

/// Permissive parse of a frontmatter block: only the `created_at` and
/// `created_by` keys are inspected, every other line is ignored. Values are
/// trimmed of surrounding quotes.
pub(crate) fn parse_frontmatter(frontmatter: &str) -> ParsedFrontmatter {
    let mut out = ParsedFrontmatter::default();
    for line in frontmatter.lines() {
        if let Some((key, value)) = line.split_once(':') {
            let key = key.trim();
            let value = value.trim().trim_matches(|c: char| c == '"' || c == '\'');
            match key {
                "created_at" => out.created_at = Some(value.to_string()),
                "created_by" => out.created_by = Some(value.to_string()),
                _ => {}
            }
        }
    }
    out
}

/// Derive a URL-safe slug from a title: lowercase, non-alphanumerics
/// collapsed to single hyphens, trimmed. Falls back to `"note"` when the
/// title has no usable characters.
pub(crate) fn slugify(title: &str) -> String {
    let mut slug = String::new();
    let mut prev_dash = false;
    for ch in title.trim().to_lowercase().chars() {
        if ch.is_ascii_alphanumeric() {
            slug.push(ch);
            prev_dash = false;
        } else if !prev_dash && !slug.is_empty() {
            slug.push('-');
            prev_dash = true;
        }
    }
    let trimmed = slug.trim_matches('-').to_string();
    if trimmed.is_empty() {
        "note".to_string()
    } else {
        trimmed
    }
}

/// Count whitespace-separated words in a note body.
pub(crate) fn word_count(body: &str) -> i64 {
    body.split_whitespace().count() as i64
}

/// A note discovered on disk during the legacy walk.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct WalkedNote {
    /// Forward-slash relative path (including the `.md` suffix) from the walk
    /// root. Determines both the note title fallback and the folder chain.
    pub rel_path: String,
    pub title: String,
    pub body: String,
    pub created_at: Option<String>,
    pub created_by: Option<String>,
}

/// Recursively collect `*.md` files under `root` into [`WalkedNote`]s.
///
/// Skips dotfiles (e.g. `.project-id`), `*.comments.json` sidecars (handled
/// separately during import), and anything that is not a `.md` file. The walk
/// is deterministic: entries are visited in sorted path order.
pub(crate) fn walk_notes_dir(root: &Path) -> Vec<WalkedNote> {
    let mut out = Vec::new();
    walk_inner(root, root, &mut out);
    out
}

fn walk_inner(root: &Path, dir: &Path, out: &mut Vec<WalkedNote>) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    let mut paths: Vec<PathBuf> = entries.flatten().map(|e| e.path()).collect();
    paths.sort();

    for path in paths {
        let Some(name) = path.file_name().and_then(|n| n.to_str()) else {
            continue;
        };
        // Skip dotfiles (`.project-id`, hidden files, etc.).
        if name.starts_with('.') {
            continue;
        }
        if path.is_dir() {
            walk_inner(root, &path, out);
            continue;
        }
        // Only `.md` files. `<name>.md.comments.json` sidecars end with
        // `.json`, so the suffix check already excludes them.
        if !name.ends_with(".md") {
            continue;
        }
        let Ok(content) = std::fs::read_to_string(&path) else {
            continue;
        };
        let (frontmatter, body) = strip_frontmatter(&content);
        let parsed = parse_frontmatter(&frontmatter);
        let mut title = extract_title(&content);
        if title.is_empty() {
            title = name.strip_suffix(".md").unwrap_or(name).to_string();
        }
        let rel_path = path
            .strip_prefix(root)
            .unwrap_or(&path)
            .to_string_lossy()
            .replace('\\', "/");
        out.push(WalkedNote {
            rel_path,
            title,
            body,
            created_at: parsed.created_at,
            created_by: parsed.created_by,
        });
    }
}

// ---------------------------------------------------------------------------
// Comment sidecar shape (`<name>.md.comments.json`).
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
struct SidecarComment {
    #[serde(default)]
    body: String,
    #[serde(default, rename = "authorId")]
    author_id: Option<String>,
    #[serde(default, rename = "authorName")]
    author_name: Option<String>,
}

#[derive(Debug, Default, Deserialize)]
struct SidecarFile {
    #[serde(default)]
    comments: Vec<SidecarComment>,
}

// ---------------------------------------------------------------------------
// Import endpoint.
// ---------------------------------------------------------------------------

/// Best-effort import summary returned by [`import_project_notes`].
#[derive(Debug, Default, Serialize)]
pub(crate) struct ImportSummary {
    pub imported_notes: usize,
    pub imported_folders: usize,
    pub imported_comments: usize,
    pub errors: Vec<String>,
}

/// Resolve the legacy notes root for a project. Prefers
/// `<workspace>/notes` when the project has a configured local workspace
/// and that folder exists on disk; otherwise falls back to the
/// `<AURA_DATA_DIR>/notes/<project_id>/` layout.
fn resolve_legacy_notes_root(state: &AppState, project_id: &str) -> PathBuf {
    if let Ok(pid) = project_id.parse::<ProjectId>() {
        if let Ok(project) = state.project_service.get_project(&pid) {
            if let Some(ws) = project
                .local_workspace_path
                .as_deref()
                .map(str::trim)
                .filter(|s| !s.is_empty())
            {
                let ws_notes = Path::new(ws).join("notes");
                if ws_notes.is_dir() {
                    return ws_notes;
                }
            }
        }
    }
    state.data_dir.join("notes").join(project_id)
}

/// Upload a note body to S3 via the aura-router presign proxy. Returns
/// `(file_url, key)` on success. The body is uploaded under the `blogs`
/// prefix as `text/markdown`.
async fn upload_note_body(
    state: &AppState,
    jwt: &str,
    slug: &str,
    body: &str,
) -> Result<(String, String), String> {
    let presign_url = format!("{}/v1/upload/presign", state.router_url);
    let payload = serde_json::json!({
        "content_type": "text/markdown",
        "filename": format!("{slug}.md"),
        "prefix": "blogs",
    });

    let resp = state
        .http_client
        .post(&presign_url)
        .bearer_auth(jwt)
        .json(&payload)
        .send()
        .await
        .map_err(|e| format!("presign request failed: {e}"))?;
    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        return Err(format!("presign returned {status}: {text}"));
    }
    let presign: PresignResponse = resp
        .json()
        .await
        .map_err(|e| format!("invalid presign response: {e}"))?;

    let put = state
        .http_client
        .put(&presign.upload_url)
        .header(reqwest::header::CONTENT_TYPE, "text/markdown")
        .body(body.to_string())
        .send()
        .await
        .map_err(|e| format!("S3 upload failed: {e}"))?;
    if !put.status().is_success() {
        let status = put.status();
        let text = put.text().await.unwrap_or_default();
        return Err(format!("S3 upload returned {status}: {text}"));
    }

    Ok((presign.file_url, presign.key))
}

/// Ensure the folder chain for a note's parent directory exists in storage,
/// creating any missing folders and returning the deepest folder's id (or
/// `None` when the note sits at the walk root). Created folder ids are cached
/// by their cumulative relative path so siblings reuse the same rows.
async fn ensure_folder_chain(
    state: &AppState,
    jwt: &str,
    project_id: &str,
    dir_segments: &[&str],
    cache: &mut HashMap<String, String>,
    imported_folders: &mut usize,
) -> Result<Option<String>, String> {
    let storage = state
        .require_storage_client()
        .map_err(|_| "aura-storage is not configured".to_string())?;

    let mut parent_id: Option<String> = None;
    let mut cumulative = String::new();
    for segment in dir_segments {
        if !cumulative.is_empty() {
            cumulative.push('/');
        }
        cumulative.push_str(segment);

        if let Some(existing) = cache.get(&cumulative) {
            parent_id = Some(existing.clone());
            continue;
        }

        let req = CreateNoteFolderRequest {
            name: (*segment).to_string(),
            org_id: None,
            parent_id: parent_id.clone(),
            sort_order: None,
        };
        let folder = storage
            .create_note_folder(project_id, jwt, &req)
            .await
            .map_err(|e| format!("failed to create folder '{cumulative}': {e:?}"))?;
        *imported_folders += 1;
        cache.insert(cumulative.clone(), folder.id.clone());
        parent_id = Some(folder.id);
    }
    Ok(parent_id)
}

/// Load and parse the comment sidecar for a note, if present. Returns an
/// empty vec when there is no sidecar.
fn load_sidecar_comments(note_abs: &Path) -> Vec<SidecarComment> {
    let file_name = match note_abs.file_name().and_then(|n| n.to_str()) {
        Some(n) => n,
        None => return Vec::new(),
    };
    let sidecar = note_abs.with_file_name(format!("{file_name}.comments.json"));
    let Ok(raw) = std::fs::read_to_string(&sidecar) else {
        return Vec::new();
    };
    serde_json::from_str::<SidecarFile>(&raw)
        .map(|f| f.comments)
        .unwrap_or_default()
}

/// `POST /api/notes/projects/:project_id/import` — sys-admin only.
///
/// Walks the legacy on-disk notes root for `project_id` and migrates every
/// note into aura-storage: bodies are uploaded to S3 via the router presign
/// proxy, folders mirror the directory structure, and comment sidecars are
/// replayed as note comments. Best-effort — per-note failures are collected
/// into `errors` rather than aborting the whole run.
pub(crate) async fn import_project_notes(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    AuthSession(session): AuthSession,
    AxumPath(project_id): AxumPath<String>,
) -> ApiResult<Json<ImportSummary>> {
    require_sys_admin(&session)?;
    // Surface a clean 503 up front when storage is unavailable.
    let _ = state.require_storage_client()?;

    let root = resolve_legacy_notes_root(&state, &project_id);
    let notes = walk_notes_dir(&root);

    let mut summary = ImportSummary::default();
    let mut folder_cache: HashMap<String, String> = HashMap::new();

    for note in notes {
        let segments: Vec<&str> = note.rel_path.split('/').collect();
        let dir_segments = &segments[..segments.len().saturating_sub(1)];

        let folder_id = match ensure_folder_chain(
            &state,
            &jwt,
            &project_id,
            dir_segments,
            &mut folder_cache,
            &mut summary.imported_folders,
        )
        .await
        {
            Ok(id) => id,
            Err(e) => {
                summary.errors.push(format!("{}: {e}", note.rel_path));
                continue;
            }
        };

        let slug = slugify(&note.title);
        let (body_url, body_s3_key) = match upload_note_body(&state, &jwt, &slug, &note.body).await
        {
            Ok(pair) => pair,
            Err(e) => {
                summary.errors.push(format!("{}: {e}", note.rel_path));
                continue;
            }
        };

        let req = CreateNoteRequest {
            title: note.title.clone(),
            slug,
            org_id: None,
            folder_id,
            sort_order: None,
            word_count: Some(word_count(&note.body).clamp(0, i32::MAX as i64) as i32),
            body_url: Some(body_url),
            body_s3_key: Some(body_s3_key),
            blog_type: None,
            excerpt: None,
            hero_image_url: None,
            read_time_minutes: None,
            author_id: note.created_by.clone(),
            author_name: None,
            author_avatar_url: None,
            sections: None,
        };

        let storage = state.require_storage_client()?;
        let created = match storage.create_note(&project_id, &jwt, &req).await {
            Ok(n) => n,
            Err(e) => {
                summary
                    .errors
                    .push(format!("{}: failed to create note: {e:?}", note.rel_path));
                continue;
            }
        };
        summary.imported_notes += 1;

        // Replay comment sidecar, if any.
        let mut note_abs = root.clone();
        for seg in &segments {
            note_abs.push(seg);
        }
        for comment in load_sidecar_comments(&note_abs) {
            if comment.body.trim().is_empty() {
                continue;
            }
            let creq = CreateNoteCommentRequest {
                body: comment.body,
                author_id: comment.author_id,
                author_name: comment.author_name,
            };
            match storage.create_note_comment(&created.id, &jwt, &creq).await {
                Ok(_) => summary.imported_comments += 1,
                Err(e) => summary.errors.push(format!(
                    "{}: failed to import comment: {e:?}",
                    note.rel_path
                )),
            }
        }
    }

    Ok(Json(summary))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::TempDir;

    // -----------------------------------------------------------------------
    // extract_title
    // -----------------------------------------------------------------------

    #[test]
    fn extract_title_strips_frontmatter_and_heading() {
        let content = "---\ncreated_at: 2026\n---\n\n# Hello world\n\nbody";
        assert_eq!(extract_title(content), "Hello world");
    }

    #[test]
    fn extract_title_without_frontmatter_with_hash() {
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
    fn extract_title_strips_multiple_hashes() {
        assert_eq!(extract_title("### Deep heading"), "Deep heading");
    }

    #[test]
    fn extract_title_empty_document() {
        assert_eq!(extract_title(""), "");
    }

    // -----------------------------------------------------------------------
    // strip_frontmatter
    // -----------------------------------------------------------------------

    #[test]
    fn strip_frontmatter_splits_block() {
        let doc = "---\ncreated_at: 2026-04-17\ncreated_by: u1\n---\n\n# Title\n\nBody";
        let (fm, body) = strip_frontmatter(doc);
        assert!(fm.contains("created_at: 2026-04-17"));
        assert!(fm.contains("created_by: u1"));
        assert!(body.starts_with("# Title"));
        assert!(body.ends_with("Body"));
    }

    #[test]
    fn strip_frontmatter_no_block_returns_whole_body() {
        let doc = "# Title\n\nBody";
        let (fm, body) = strip_frontmatter(doc);
        assert_eq!(fm, "");
        assert_eq!(body, doc);
    }

    #[test]
    fn parse_frontmatter_reads_known_keys() {
        let (fm, _) = strip_frontmatter(
            "---\ncreated_at: \"2026-04-17\"\ncreated_by: u1\nother: x\n---\n\nB",
        );
        let parsed = parse_frontmatter(&fm);
        assert_eq!(parsed.created_at.as_deref(), Some("2026-04-17"));
        assert_eq!(parsed.created_by.as_deref(), Some("u1"));
    }

    #[test]
    fn parse_frontmatter_empty_is_default() {
        assert_eq!(parse_frontmatter(""), ParsedFrontmatter::default());
    }

    // -----------------------------------------------------------------------
    // slugify
    // -----------------------------------------------------------------------

    #[test]
    fn slugify_basic() {
        assert_eq!(slugify("Hello World"), "hello-world");
    }

    #[test]
    fn slugify_collapses_and_trims_punctuation() {
        assert_eq!(slugify("  Hello,   World!!  "), "hello-world");
    }

    #[test]
    fn slugify_empty_falls_back_to_note() {
        assert_eq!(slugify("!!!"), "note");
        assert_eq!(slugify(""), "note");
    }

    // -----------------------------------------------------------------------
    // word_count
    // -----------------------------------------------------------------------

    #[test]
    fn word_count_counts_whitespace_separated() {
        assert_eq!(word_count("one two three"), 3);
        assert_eq!(word_count("  spaced \n out  words "), 3);
        assert_eq!(word_count(""), 0);
    }

    // -----------------------------------------------------------------------
    // walk_notes_dir
    // -----------------------------------------------------------------------

    #[test]
    fn walk_notes_dir_collects_md_and_mirrors_dirs() {
        let tmp = TempDir::new().unwrap();
        let root = tmp.path();

        fs::write(
            root.join("top.md"),
            "---\ncreated_at: 2026-01-01\ncreated_by: alice\n---\n\n# Top Note\n\nhello world",
        )
        .unwrap();
        fs::create_dir_all(root.join("sub/deep")).unwrap();
        fs::write(root.join("sub/child.md"), "# Child\n\nbody").unwrap();
        fs::write(root.join("sub/deep/leaf.md"), "plain leaf line").unwrap();

        // Things that must be skipped.
        fs::write(root.join(".project-id"), "proj-1").unwrap();
        fs::write(root.join("top.md.comments.json"), "{\"comments\":[]}").unwrap();
        fs::write(root.join("notes.txt"), "not markdown").unwrap();

        let notes = walk_notes_dir(root);
        let rel: Vec<&str> = notes.iter().map(|n| n.rel_path.as_str()).collect();

        // Deterministic sorted order; only `.md` files; sidecars/dotfiles skipped.
        assert_eq!(rel, vec!["sub/child.md", "sub/deep/leaf.md", "top.md"]);

        let top = notes.iter().find(|n| n.rel_path == "top.md").unwrap();
        assert_eq!(top.title, "Top Note");
        // Body keeps the full markdown (heading included); only frontmatter is stripped.
        assert_eq!(top.body, "# Top Note\n\nhello world");
        assert_eq!(top.created_at.as_deref(), Some("2026-01-01"));
        assert_eq!(top.created_by.as_deref(), Some("alice"));

        let leaf = notes
            .iter()
            .find(|n| n.rel_path == "sub/deep/leaf.md")
            .unwrap();
        assert_eq!(leaf.title, "plain leaf line");
    }

    #[test]
    fn walk_notes_dir_title_falls_back_to_filename() {
        let tmp = TempDir::new().unwrap();
        let root = tmp.path();
        fs::write(root.join("untitled.md"), "").unwrap();

        let notes = walk_notes_dir(root);
        assert_eq!(notes.len(), 1);
        assert_eq!(notes[0].title, "untitled");
    }

    #[test]
    fn walk_notes_dir_missing_root_is_empty() {
        let tmp = TempDir::new().unwrap();
        let missing = tmp.path().join("does-not-exist");
        assert!(walk_notes_dir(&missing).is_empty());
    }
}
