//! Notes app handlers.
//!
//! Notes are plain markdown files stored on disk under
//! `<AURA_DATA_DIR>/notes/<project_id>/...` with real directories for folders.
//! No database — the folder tree is the filesystem, and per-note metadata
//! (creation timestamp, author) is YAML frontmatter inside the `.md`. Comments
//! live alongside each note as `<note>.comments.json`.

use std::path::{Component, Path, PathBuf};
use std::time::SystemTime;

use aura_os_core::ProjectId;
use axum::extract::{Path as AxumPath, Query, State};
use axum::Json;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use tracing::{debug, warn};

use crate::error::{ApiError, ApiResult};
use crate::state::{AppState, AuthSession};

const TITLE_PROBE_BYTES: usize = 2048;

// ---------------------------------------------------------------------------
// Path helpers & safety
// ---------------------------------------------------------------------------

/// Root directory on disk for a project's notes.
pub(crate) fn notes_root(data_dir: &Path, project_id: &ProjectId) -> PathBuf {
    data_dir.join("notes").join(project_id.to_string())
}

/// Ensure the notes root exists and return it.
fn ensure_notes_root(data_dir: &Path, project_id: &ProjectId) -> ApiResult<PathBuf> {
    let root = notes_root(data_dir, project_id);
    std::fs::create_dir_all(&root).map_err(|e| {
        ApiError::internal(format!(
            "failed to create notes directory {}: {e}",
            root.display()
        ))
    })?;
    Ok(root)
}

/// Validate a caller-supplied relative path and return it joined onto `root`.
///
/// Rejects any path that contains traversal, absolute components, windows
/// drive/root prefixes, or `..` segments. Empty input is treated as the root.
fn resolve_rel_path(root: &Path, rel: &str) -> ApiResult<PathBuf> {
    let trimmed = rel.trim();
    if trimmed.is_empty() {
        return Ok(root.to_path_buf());
    }
    // Reject anything that looks absolute before parsing — Windows drive
    // prefixes, UNC paths, or leading `/`/`\` separators.
    if trimmed.starts_with('/')
        || trimmed.starts_with('\\')
        || trimmed
            .chars()
            .nth(1)
            .map(|c| c == ':')
            .unwrap_or(false)
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
fn sanitize_segment(name: &str, fallback: &str) -> String {
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
fn slug_stem(name: &str) -> String {
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

fn iso_now() -> String {
    let now: DateTime<Utc> = SystemTime::now().into();
    now.to_rfc3339()
}

fn system_time_to_rfc3339(t: SystemTime) -> Option<String> {
    Some(DateTime::<Utc>::from(t).to_rfc3339())
}

fn to_forward_slashes(p: &Path) -> String {
    p.to_string_lossy().replace('\\', "/")
}

fn rel_of(root: &Path, absolute: &Path) -> String {
    let rel = absolute.strip_prefix(root).unwrap_or(absolute);
    to_forward_slashes(rel)
}

// ---------------------------------------------------------------------------
// Title extraction & frontmatter
// ---------------------------------------------------------------------------

/// Extract the display title from a note's markdown content.
///
/// Skips any leading YAML frontmatter block (between `---` fences), takes the
/// first non-empty line that follows, and strips leading `#` characters and
/// whitespace. Returns the empty string when the file has no textual content.
pub(crate) fn extract_title(content: &str) -> String {
    let mut lines = content.lines();
    // Strip frontmatter when present.
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
fn parse_frontmatter(content: &str) -> (NoteFrontmatter, String) {
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

fn render_note(fm: &NoteFrontmatter, body: &str) -> String {
    let mut out = render_frontmatter(fm);
    out.push_str(body.trim_start_matches('\n'));
    out
}

// ---------------------------------------------------------------------------
// Tree walking
// ---------------------------------------------------------------------------

#[derive(Debug, Serialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub(crate) enum TreeNode {
    Folder {
        name: String,
        #[serde(rename = "relPath")]
        rel_path: String,
        children: Vec<TreeNode>,
    },
    Note {
        name: String,
        #[serde(rename = "relPath")]
        rel_path: String,
        title: String,
        #[serde(rename = "absPath")]
        abs_path: String,
        #[serde(rename = "updatedAt", skip_serializing_if = "Option::is_none")]
        updated_at: Option<String>,
    },
}

fn read_title_probe(path: &Path) -> std::io::Result<String> {
    use std::io::Read;
    let mut file = std::fs::File::open(path)?;
    let mut buf = vec![0u8; TITLE_PROBE_BYTES];
    let n = file.read(&mut buf)?;
    buf.truncate(n);
    Ok(String::from_utf8_lossy(&buf).into_owned())
}

fn walk_notes(root: &Path, current: &Path) -> Vec<TreeNode> {
    let Ok(entries) = std::fs::read_dir(current) else {
        return Vec::new();
    };
    let mut items: Vec<_> = entries.filter_map(|e| e.ok()).collect();
    // Directories first, then notes — both alphabetical by file name.
    items.sort_by(|a, b| {
        let a_dir = a.file_type().map(|t| t.is_dir()).unwrap_or(false);
        let b_dir = b.file_type().map(|t| t.is_dir()).unwrap_or(false);
        b_dir
            .cmp(&a_dir)
            .then_with(|| a.file_name().cmp(&b.file_name()))
    });
    let mut out = Vec::new();
    for entry in items {
        let name = entry.file_name().to_string_lossy().into_owned();
        if name.starts_with('.') || name.ends_with(".comments.json") {
            continue;
        }
        let path = entry.path();
        let is_dir = entry.file_type().map(|t| t.is_dir()).unwrap_or(false);
        if is_dir {
            out.push(TreeNode::Folder {
                name: name.clone(),
                rel_path: rel_of(root, &path),
                children: walk_notes(root, &path),
            });
        } else if name.ends_with(".md") {
            let title_probe = read_title_probe(&path).ok().unwrap_or_default();
            let title = extract_title(&title_probe);
            let display_title = if title.is_empty() {
                strip_md_ext(&name).to_string()
            } else {
                title
            };
            let updated_at = entry
                .metadata()
                .ok()
                .and_then(|m| m.modified().ok())
                .and_then(system_time_to_rfc3339);
            out.push(TreeNode::Note {
                name: name.clone(),
                rel_path: rel_of(root, &path),
                title: display_title,
                abs_path: to_forward_slashes(&path),
                updated_at,
            });
        }
    }
    out
}

fn strip_md_ext(name: &str) -> &str {
    name.strip_suffix(".md").unwrap_or(name)
}

// ---------------------------------------------------------------------------
// HTTP handlers
// ---------------------------------------------------------------------------

#[derive(Debug, Serialize)]
pub(crate) struct TreeResponse {
    pub(crate) nodes: Vec<TreeNode>,
    pub(crate) root: String,
}

pub(crate) async fn list_tree(
    State(state): State<AppState>,
    AuthSession(_session): AuthSession,
    AxumPath(project_id): AxumPath<ProjectId>,
) -> ApiResult<Json<TreeResponse>> {
    let root = ensure_notes_root(&state.data_dir, &project_id)?;
    let root_for_walk = root.clone();
    let nodes =
        tokio::task::spawn_blocking(move || walk_notes(&root_for_walk, &root_for_walk))
            .await
            .unwrap_or_default();
    Ok(Json(TreeResponse {
        nodes,
        root: to_forward_slashes(&root),
    }))
}

#[derive(Debug, Deserialize)]
pub(crate) struct PathQuery {
    pub path: String,
}

#[derive(Debug, Serialize)]
pub(crate) struct ReadResponse {
    pub content: String,
    pub title: String,
    pub frontmatter: NoteFrontmatter,
    #[serde(rename = "absPath")]
    pub abs_path: String,
    #[serde(rename = "updatedAt", skip_serializing_if = "Option::is_none")]
    pub updated_at: Option<String>,
    #[serde(rename = "wordCount")]
    pub word_count: usize,
}

fn word_count_of(body: &str) -> usize {
    body.split_whitespace().count()
}

pub(crate) async fn read_note(
    State(state): State<AppState>,
    AuthSession(_session): AuthSession,
    AxumPath(project_id): AxumPath<ProjectId>,
    Query(query): Query<PathQuery>,
) -> ApiResult<Json<ReadResponse>> {
    let root = ensure_notes_root(&state.data_dir, &project_id)?;
    let abs = resolve_rel_path(&root, &query.path)?;
    if !abs.is_file() {
        return Err(ApiError::not_found(format!("note not found: {}", query.path)));
    }
    let content = tokio::fs::read_to_string(&abs)
        .await
        .map_err(|e| ApiError::internal(format!("failed to read note: {e}")))?;
    let (frontmatter, body) = parse_frontmatter(&content);
    let title = extract_title(&content);
    let updated_at = tokio::fs::metadata(&abs)
        .await
        .ok()
        .and_then(|m| m.modified().ok())
        .and_then(system_time_to_rfc3339);
    Ok(Json(ReadResponse {
        content,
        title,
        frontmatter,
        abs_path: to_forward_slashes(&abs),
        updated_at,
        word_count: word_count_of(&body),
    }))
}

#[derive(Debug, Deserialize)]
pub(crate) struct WriteRequest {
    pub path: String,
    pub content: String,
}

#[derive(Debug, Serialize)]
pub(crate) struct WriteResponse {
    pub ok: bool,
    pub title: String,
    #[serde(rename = "updatedAt")]
    pub updated_at: String,
    #[serde(rename = "wordCount")]
    pub word_count: usize,
}

pub(crate) async fn write_note(
    State(state): State<AppState>,
    AuthSession(_session): AuthSession,
    AxumPath(project_id): AxumPath<ProjectId>,
    Json(req): Json<WriteRequest>,
) -> ApiResult<Json<WriteResponse>> {
    let root = ensure_notes_root(&state.data_dir, &project_id)?;
    let abs = resolve_rel_path(&root, &req.path)?;
    if abs.extension().and_then(|s| s.to_str()) != Some("md") {
        return Err(ApiError::bad_request("only .md notes can be written"));
    }
    if let Some(parent) = abs.parent() {
        tokio::fs::create_dir_all(parent)
            .await
            .map_err(|e| ApiError::internal(format!("failed to create parent dir: {e}")))?;
    }

    let (mut frontmatter, body) = parse_frontmatter(&req.content);
    let now = iso_now();
    if frontmatter.created_at.is_none() {
        frontmatter.created_at = Some(now.clone());
    }
    frontmatter.updated_at = Some(now.clone());

    let rendered = render_note(&frontmatter, &body);
    let title = extract_title(&rendered);
    let tmp = abs.with_extension("md.tmp");
    tokio::fs::write(&tmp, &rendered)
        .await
        .map_err(|e| ApiError::internal(format!("failed to write tmp file: {e}")))?;
    tokio::fs::rename(&tmp, &abs)
        .await
        .map_err(|e| ApiError::internal(format!("failed to rename tmp file: {e}")))?;
    debug!(path = %abs.display(), "wrote note");

    Ok(Json(WriteResponse {
        ok: true,
        title,
        updated_at: now,
        word_count: word_count_of(&body),
    }))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum CreateKind {
    Note,
    Folder,
}

#[derive(Debug, Deserialize)]
pub(crate) struct CreateRequest {
    #[serde(default, rename = "parentPath")]
    pub parent_path: String,
    pub name: String,
    pub kind: CreateKind,
}

#[derive(Debug, Serialize)]
pub(crate) struct CreateResponse {
    #[serde(rename = "relPath")]
    pub rel_path: String,
    pub title: String,
    #[serde(rename = "absPath")]
    pub abs_path: String,
}

pub(crate) async fn create_entry(
    State(state): State<AppState>,
    AuthSession(session): AuthSession,
    AxumPath(project_id): AxumPath<ProjectId>,
    Json(req): Json<CreateRequest>,
) -> ApiResult<Json<CreateResponse>> {
    let root = ensure_notes_root(&state.data_dir, &project_id)?;
    let parent = resolve_rel_path(&root, &req.parent_path)?;
    tokio::fs::create_dir_all(&parent)
        .await
        .map_err(|e| ApiError::internal(format!("failed to create parent dir: {e}")))?;

    match req.kind {
        CreateKind::Folder => {
            let name = sanitize_segment(&req.name, "untitled-folder");
            let mut target = parent.join(&name);
            target = unique_path(target);
            tokio::fs::create_dir(&target)
                .await
                .map_err(|e| ApiError::internal(format!("failed to create folder: {e}")))?;
            let rel_path = rel_of(&root, &target);
            Ok(Json(CreateResponse {
                title: name,
                rel_path,
                abs_path: to_forward_slashes(&target),
            }))
        }
        CreateKind::Note => {
            let display_name = req.name.trim();
            let display_title = if display_name.is_empty() {
                "Untitled".to_string()
            } else {
                display_name.to_string()
            };
            let stem = slug_stem(&display_title);
            let mut target = parent.join(format!("{stem}.md"));
            target = unique_path(target);

            let frontmatter = NoteFrontmatter {
                created_at: Some(iso_now()),
                created_by: Some(session.user_id.clone()),
                updated_at: Some(iso_now()),
            };
            let body = format!("# {display_title}\n\n");
            let content = render_note(&frontmatter, &body);
            tokio::fs::write(&target, &content)
                .await
                .map_err(|e| ApiError::internal(format!("failed to write note: {e}")))?;

            let rel_path = rel_of(&root, &target);
            Ok(Json(CreateResponse {
                title: display_title,
                rel_path,
                abs_path: to_forward_slashes(&target),
            }))
        }
    }
}

fn unique_path(mut target: PathBuf) -> PathBuf {
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

#[derive(Debug, Deserialize)]
pub(crate) struct RenameRequest {
    pub from: String,
    pub to: String,
}

pub(crate) async fn rename_entry(
    State(state): State<AppState>,
    AuthSession(_session): AuthSession,
    AxumPath(project_id): AxumPath<ProjectId>,
    Json(req): Json<RenameRequest>,
) -> ApiResult<Json<serde_json::Value>> {
    let root = ensure_notes_root(&state.data_dir, &project_id)?;
    let from = resolve_rel_path(&root, &req.from)?;
    let to = resolve_rel_path(&root, &req.to)?;
    if !from.exists() {
        return Err(ApiError::not_found(format!("source not found: {}", req.from)));
    }
    if to.exists() {
        return Err(ApiError::conflict(format!(
            "destination already exists: {}",
            req.to
        )));
    }
    if let Some(parent) = to.parent() {
        tokio::fs::create_dir_all(parent)
            .await
            .map_err(|e| ApiError::internal(format!("failed to create parent dir: {e}")))?;
    }
    tokio::fs::rename(&from, &to)
        .await
        .map_err(|e| ApiError::internal(format!("failed to rename: {e}")))?;
    Ok(Json(serde_json::json!({
        "ok": true,
        "relPath": rel_of(&root, &to),
        "absPath": to_forward_slashes(&to),
    })))
}

#[derive(Debug, Deserialize)]
pub(crate) struct DeleteRequest {
    pub path: String,
}

pub(crate) async fn delete_entry(
    State(state): State<AppState>,
    AuthSession(_session): AuthSession,
    AxumPath(project_id): AxumPath<ProjectId>,
    Json(req): Json<DeleteRequest>,
) -> ApiResult<Json<serde_json::Value>> {
    let root = ensure_notes_root(&state.data_dir, &project_id)?;
    let target = resolve_rel_path(&root, &req.path)?;
    if !target.exists() {
        return Err(ApiError::not_found(format!("not found: {}", req.path)));
    }
    if target.is_dir() {
        tokio::fs::remove_dir_all(&target)
            .await
            .map_err(|e| ApiError::internal(format!("failed to delete folder: {e}")))?;
    } else {
        tokio::fs::remove_file(&target)
            .await
            .map_err(|e| ApiError::internal(format!("failed to delete note: {e}")))?;
        let sidecar = target.with_extension("md.comments.json");
        if sidecar.exists() {
            if let Err(err) = tokio::fs::remove_file(&sidecar).await {
                warn!(path = %sidecar.display(), %err, "failed to remove comments sidecar");
            }
        }
    }
    Ok(Json(serde_json::json!({ "ok": true })))
}

// ---------------------------------------------------------------------------
// Comments sidecar
// ---------------------------------------------------------------------------

#[derive(Debug, Serialize, Deserialize, Clone)]
pub(crate) struct NoteComment {
    pub id: String,
    #[serde(rename = "authorId")]
    pub author_id: String,
    #[serde(rename = "authorName")]
    pub author_name: String,
    pub body: String,
    #[serde(rename = "createdAt")]
    pub created_at: String,
}

#[derive(Debug, Default, Serialize, Deserialize)]
pub(crate) struct CommentsFile {
    #[serde(default)]
    pub comments: Vec<NoteComment>,
}

fn comments_sidecar(note_abs: &Path) -> PathBuf {
    let name = note_abs
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default();
    note_abs.with_file_name(format!("{name}.comments.json"))
}

async fn load_comments(note_abs: &Path) -> ApiResult<CommentsFile> {
    let sidecar = comments_sidecar(note_abs);
    match tokio::fs::read_to_string(&sidecar).await {
        Ok(raw) => serde_json::from_str(&raw)
            .map_err(|e| ApiError::internal(format!("invalid comments file: {e}"))),
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(CommentsFile::default()),
        Err(err) => Err(ApiError::internal(format!(
            "failed to read comments file: {err}"
        ))),
    }
}

async fn save_comments(note_abs: &Path, file: &CommentsFile) -> ApiResult<()> {
    let sidecar = comments_sidecar(note_abs);
    let raw = serde_json::to_string_pretty(file)
        .map_err(|e| ApiError::internal(format!("failed to serialize comments: {e}")))?;
    tokio::fs::write(&sidecar, raw)
        .await
        .map_err(|e| ApiError::internal(format!("failed to write comments file: {e}")))?;
    Ok(())
}

pub(crate) async fn list_comments(
    State(state): State<AppState>,
    AuthSession(_session): AuthSession,
    AxumPath(project_id): AxumPath<ProjectId>,
    Query(query): Query<PathQuery>,
) -> ApiResult<Json<Vec<NoteComment>>> {
    let root = ensure_notes_root(&state.data_dir, &project_id)?;
    let note_abs = resolve_rel_path(&root, &query.path)?;
    if !note_abs.is_file() {
        return Err(ApiError::not_found(format!("note not found: {}", query.path)));
    }
    let file = load_comments(&note_abs).await?;
    Ok(Json(file.comments))
}

#[derive(Debug, Deserialize)]
pub(crate) struct AddCommentRequest {
    pub path: String,
    pub body: String,
    #[serde(default, rename = "authorName")]
    pub author_name: Option<String>,
}

pub(crate) async fn add_comment(
    State(state): State<AppState>,
    AuthSession(session): AuthSession,
    AxumPath(project_id): AxumPath<ProjectId>,
    Json(req): Json<AddCommentRequest>,
) -> ApiResult<Json<NoteComment>> {
    let root = ensure_notes_root(&state.data_dir, &project_id)?;
    let note_abs = resolve_rel_path(&root, &req.path)?;
    if !note_abs.is_file() {
        return Err(ApiError::not_found(format!("note not found: {}", req.path)));
    }
    let trimmed = req.body.trim();
    if trimmed.is_empty() {
        return Err(ApiError::bad_request("comment body is required"));
    }
    let mut file = load_comments(&note_abs).await?;
    let comment = NoteComment {
        id: format!(
            "cm_{}",
            uuid::Uuid::new_v4().as_simple().to_string()
        ),
        author_id: session.user_id.clone(),
        author_name: req
            .author_name
            .as_deref()
            .map(str::trim)
            .filter(|v| !v.is_empty())
            .map(str::to_owned)
            .unwrap_or_else(|| session.user_id.clone()),
        body: trimmed.to_string(),
        created_at: iso_now(),
    };
    file.comments.push(comment.clone());
    save_comments(&note_abs, &file).await?;
    Ok(Json(comment))
}

#[derive(Debug, Deserialize)]
pub(crate) struct DeleteCommentRequest {
    pub path: String,
    pub id: String,
}

pub(crate) async fn delete_comment(
    State(state): State<AppState>,
    AuthSession(_session): AuthSession,
    AxumPath(project_id): AxumPath<ProjectId>,
    Json(req): Json<DeleteCommentRequest>,
) -> ApiResult<Json<serde_json::Value>> {
    let root = ensure_notes_root(&state.data_dir, &project_id)?;
    let note_abs = resolve_rel_path(&root, &req.path)?;
    if !note_abs.is_file() {
        return Err(ApiError::not_found(format!("note not found: {}", req.path)));
    }
    let mut file = load_comments(&note_abs).await?;
    let before = file.comments.len();
    file.comments.retain(|c| c.id != req.id);
    if file.comments.len() == before {
        return Err(ApiError::not_found(format!("comment not found: {}", req.id)));
    }
    save_comments(&note_abs, &file).await?;
    Ok(Json(serde_json::json!({ "ok": true })))
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

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
        assert_eq!(extract_title("plain first line\n\nrest"), "plain first line");
    }

    #[test]
    fn extract_title_empty_document() {
        assert_eq!(extract_title(""), "");
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
    fn parse_frontmatter_round_trip() {
        let doc = "---\ncreated_at: 2026-04-17\ncreated_by: u1\nupdated_at: 2026-04-17\n---\n\n# Title\n\nBody";
        let (fm, body) = parse_frontmatter(doc);
        assert_eq!(fm.created_at.as_deref(), Some("2026-04-17"));
        assert_eq!(fm.created_by.as_deref(), Some("u1"));
        assert!(body.starts_with("# Title"));
    }

    #[test]
    fn slug_stem_basic() {
        assert_eq!(slug_stem("Hello World"), "hello-world");
        assert_eq!(slug_stem("!!!"), "untitled");
    }

    #[tokio::test]
    async fn walk_includes_folders_and_notes_sorted() {
        let (_tmp, root) = setup();
        std::fs::create_dir_all(root.join("Alpha")).unwrap();
        std::fs::write(root.join("Alpha/one.md"), "# Alpha one").unwrap();
        std::fs::write(root.join("z-root.md"), "# Z Root").unwrap();
        std::fs::write(root.join(".hidden"), "skip").unwrap();
        std::fs::write(root.join("z-root.md.comments.json"), "{\"comments\":[]}").unwrap();

        let nodes = walk_notes(&root, &root);
        assert_eq!(nodes.len(), 2);
        match &nodes[0] {
            TreeNode::Folder { name, children, .. } => {
                assert_eq!(name, "Alpha");
                assert_eq!(children.len(), 1);
                match &children[0] {
                    TreeNode::Note { title, .. } => assert_eq!(title, "Alpha one"),
                    _ => panic!("expected note"),
                }
            }
            _ => panic!("expected folder first"),
        }
        match &nodes[1] {
            TreeNode::Note { title, rel_path, .. } => {
                assert_eq!(title, "Z Root");
                assert_eq!(rel_path, "z-root.md");
            }
            _ => panic!("expected note"),
        }
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
