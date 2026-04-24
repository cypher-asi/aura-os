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
use aura_os_projects::ProjectService;
use axum::extract::{Path as AxumPath, Query, State};
use axum::Json;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use tracing::{debug, warn};

use crate::error::{ApiError, ApiResult};
use crate::state::{AppState, AuthSession};

const TITLE_PROBE_BYTES: usize = 2048;
const PROJECT_ID_MARKER: &str = ".project-id";

// ---------------------------------------------------------------------------
// Path helpers & safety
// ---------------------------------------------------------------------------

/// Resolve a project's notes root.
///
/// Precedence:
/// 1. If the project has a `local_workspace_path` configured (Project
///    Settings > Local workspace), notes live at `<workspace>/notes/` so
///    they travel with the rest of the project's files on disk. Changing
///    the workspace path causes a one-time migration of any existing
///    slug-bound folder into the new location.
/// 2. Otherwise, fall back to a human-friendly slug folder under
///    `<data_dir>/notes/<slug>/`, pinned by a `.project-id` marker so the
///    folder stays stable across project renames.
/// 3. When the project record can't be loaded (deleted/unknown project),
///    fall back to the legacy `<data_dir>/notes/<project_id>/` path so
///    reads still work for orphaned data.
fn resolve_notes_root(
    data_dir: &Path,
    project_service: &ProjectService,
    project_id: &ProjectId,
) -> ApiResult<PathBuf> {
    let notes_dir = data_dir.join("notes");
    std::fs::create_dir_all(&notes_dir).map_err(|e| {
        ApiError::internal(format!(
            "failed to create notes directory {}: {e}",
            notes_dir.display()
        ))
    })?;

    let legacy_uuid = notes_dir.join(project_id.to_string());

    // Load the project record up front — we need both `name` (for slug
    // fallback) and `local_workspace_path` (for workspace-backed root).
    let project = match project_service.get_project(project_id) {
        Ok(p) => p,
        Err(_) => {
            // Orphan recovery: ensure the legacy UUID folder exists and
            // return it so reads can still surface any stored notes.
            std::fs::create_dir_all(&legacy_uuid).map_err(|e| {
                ApiError::internal(format!(
                    "failed to create notes directory {}: {e}",
                    legacy_uuid.display()
                ))
            })?;
            return Ok(legacy_uuid);
        }
    };

    let workspace = project
        .local_workspace_path
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(PathBuf::from);

    if let Some(workspace_root) = workspace {
        let ws_notes = workspace_root.join("notes");

        // If the workspace already hosts this project's notes (marker
        // matches) we're done.
        let marker = ws_notes.join(PROJECT_ID_MARKER);
        let marker_matches = std::fs::read_to_string(&marker)
            .ok()
            .is_some_and(|c| c.trim() == project_id.to_string());
        if marker_matches {
            return Ok(ws_notes);
        }

        // Otherwise create the workspace notes folder and, on first use
        // after a path change, migrate any previously-bound folder under
        // `<data_dir>/notes/` into it. We pick the previously-bound folder
        // via the `.project-id` marker rather than a slug guess.
        std::fs::create_dir_all(&ws_notes).map_err(|e| {
            ApiError::internal(format!(
                "failed to create notes directory {}: {e}",
                ws_notes.display()
            ))
        })?;

        if let Some(bound) = find_bound_folder(&notes_dir, project_id) {
            if bound != ws_notes {
                if let Err(err) = move_notes_contents(&bound, &ws_notes) {
                    warn!(
                        from = %bound.display(),
                        to = %ws_notes.display(),
                        %err,
                        "failed to migrate notes into workspace folder; \
                         continuing with empty workspace notes folder",
                    );
                } else {
                    // Wipe the old marker so the legacy folder is no longer
                    // considered bound; leave any empty directory behind
                    // for the user to clean up rather than deleting blindly.
                    let _ = std::fs::remove_file(bound.join(PROJECT_ID_MARKER));
                }
            }
        }

        if let Err(err) = std::fs::write(&marker, project_id.to_string()) {
            warn!(
                path = %marker.display(),
                %err,
                "failed to write project-id marker in workspace notes folder",
            );
        }
        return Ok(ws_notes);
    }

    // --- No workspace path configured: fall back to slug folder. ---

    // 1) Honour an existing `.project-id` marker that claims this project.
    if let Some(bound) = find_bound_folder(&notes_dir, project_id) {
        return Ok(bound);
    }

    // 2) Pick the first available slug (with numeric suffix on collision).
    let base = slug_stem(&project.name);
    let mut candidate = notes_dir.join(&base);
    let mut counter = 2u32;
    while candidate.exists() {
        candidate = notes_dir.join(format!("{base}-{counter}"));
        counter += 1;
        if counter > 10_000 {
            break;
        }
    }

    // 3) One-time migration: if a legacy `<uuid>/` folder exists, rename it
    //    into the chosen slug folder so the user's data follows along.
    if legacy_uuid.exists() && !candidate.exists() {
        if let Err(err) = std::fs::rename(&legacy_uuid, &candidate) {
            warn!(
                from = %legacy_uuid.display(),
                to = %candidate.display(),
                %err,
                "failed to migrate legacy notes folder; creating fresh",
            );
            std::fs::create_dir_all(&candidate).map_err(|e| {
                ApiError::internal(format!(
                    "failed to create notes directory {}: {e}",
                    candidate.display()
                ))
            })?;
        }
    } else {
        std::fs::create_dir_all(&candidate).map_err(|e| {
            ApiError::internal(format!(
                "failed to create notes directory {}: {e}",
                candidate.display()
            ))
        })?;
    }

    // 4) Persist the binding so future resolutions skip straight to step 1.
    let marker = candidate.join(PROJECT_ID_MARKER);
    if let Err(err) = std::fs::write(&marker, project_id.to_string()) {
        warn!(path = %marker.display(), %err, "failed to write project-id marker");
    }

    Ok(candidate)
}

/// Move every non-marker entry from `from` into `to`. If any individual
/// entry can't be moved (e.g. a cross-device move in exotic setups), fall
/// back to a copy+delete. Returns the first error encountered so callers
/// can log and keep going.
fn move_notes_contents(from: &Path, to: &Path) -> std::io::Result<()> {
    std::fs::create_dir_all(to)?;
    let entries = std::fs::read_dir(from)?;
    for entry in entries.flatten() {
        let name = entry.file_name();
        if name == PROJECT_ID_MARKER {
            continue;
        }
        let src = entry.path();
        let dst = to.join(&name);
        // Don't clobber existing files in the destination — the workspace
        // folder might already contain unrelated notes the user created
        // manually. Skip with a warn so we don't silently lose data.
        if dst.exists() {
            warn!(
                from = %src.display(),
                to = %dst.display(),
                "destination already exists; skipping move",
            );
            continue;
        }
        if let Err(err) = std::fs::rename(&src, &dst) {
            // Cross-device rename failures are the common reason to fall
            // back to copy+delete here.
            debug!(
                from = %src.display(),
                to = %dst.display(),
                %err,
                "rename failed; falling back to copy",
            );
            copy_recursive(&src, &dst)?;
            if src.is_dir() {
                let _ = std::fs::remove_dir_all(&src);
            } else {
                let _ = std::fs::remove_file(&src);
            }
        }
    }
    Ok(())
}

fn copy_recursive(src: &Path, dst: &Path) -> std::io::Result<()> {
    if src.is_dir() {
        std::fs::create_dir_all(dst)?;
        for entry in std::fs::read_dir(src)?.flatten() {
            copy_recursive(&entry.path(), &dst.join(entry.file_name()))?;
        }
        Ok(())
    } else {
        std::fs::copy(src, dst).map(|_| ())
    }
}

/// Scan `notes_dir/*/.project-id` looking for a folder already bound to this
/// project. Returns the bound folder on match.
fn find_bound_folder(notes_dir: &Path, project_id: &ProjectId) -> Option<PathBuf> {
    let entries = std::fs::read_dir(notes_dir).ok()?;
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let marker = path.join(PROJECT_ID_MARKER);
        let Ok(contents) = std::fs::read_to_string(&marker) else {
            continue;
        };
        if contents.trim() == project_id.to_string() {
            return Some(path);
        }
    }
    None
}

/// Ensure the notes root exists and return it.
fn ensure_notes_root(
    data_dir: &Path,
    project_service: &ProjectService,
    project_id: &ProjectId,
) -> ApiResult<PathBuf> {
    resolve_notes_root(data_dir, project_service, project_id)
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
        if name.starts_with('.') || name.ends_with(".comments.json") || name == PROJECT_ID_MARKER {
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
    let root = ensure_notes_root(&state.data_dir, &state.project_service, &project_id)?;
    let root_for_walk = root.clone();
    let nodes = tokio::task::spawn_blocking(move || walk_notes(&root_for_walk, &root_for_walk))
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
    let root = ensure_notes_root(&state.data_dir, &state.project_service, &project_id)?;
    let abs = resolve_rel_path(&root, &query.path)?;
    if !abs.is_file() {
        return Err(ApiError::not_found(format!(
            "note not found: {}",
            query.path
        )));
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
    #[serde(rename = "relPath")]
    pub rel_path: String,
    #[serde(rename = "absPath")]
    pub abs_path: String,
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
    let root = ensure_notes_root(&state.data_dir, &state.project_service, &project_id)?;
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

    // Keep the `.md` filename in sync with the first-line title.
    let final_abs = match maybe_rename_for_title(&abs, &title).await {
        Ok(next) => next,
        Err(err) => {
            warn!(path = %abs.display(), %err, "failed to rename note file after write");
            abs
        }
    };

    Ok(Json(WriteResponse {
        ok: true,
        title,
        rel_path: rel_of(&root, &final_abs),
        abs_path: to_forward_slashes(&final_abs),
        updated_at: now,
        word_count: word_count_of(&body),
    }))
}

/// If `title` slugifies to a different stem than the current filename,
/// rename the `.md` file (and its `.comments.json` sidecar) to match,
/// using `unique_path` to avoid clobbering an existing sibling.
/// Empty titles or a no-op slug leave the filename unchanged.
async fn maybe_rename_for_title(current: &Path, title: &str) -> std::io::Result<PathBuf> {
    let trimmed = title.trim();
    if trimmed.is_empty() {
        return Ok(current.to_path_buf());
    }
    let new_stem = slug_stem(trimmed);
    if new_stem.is_empty() || new_stem == "untitled" {
        return Ok(current.to_path_buf());
    }
    let current_stem = current
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or_default();
    if current_stem == new_stem {
        return Ok(current.to_path_buf());
    }
    let parent = current.parent().unwrap_or_else(|| Path::new(""));
    let desired = parent.join(format!("{new_stem}.md"));
    let target = if desired == current {
        return Ok(current.to_path_buf());
    } else {
        unique_path(desired)
    };

    tokio::fs::rename(current, &target).await?;

    // Carry the comments sidecar along if present.
    let current_name = current
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default();
    let old_sidecar = current.with_file_name(format!("{current_name}.comments.json"));
    if old_sidecar.exists() {
        let target_name = target
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_default();
        let new_sidecar = target.with_file_name(format!("{target_name}.comments.json"));
        if let Err(err) = tokio::fs::rename(&old_sidecar, &new_sidecar).await {
            warn!(
                from = %old_sidecar.display(),
                to = %new_sidecar.display(),
                %err,
                "failed to move comments sidecar during note rename",
            );
        }
    }

    Ok(target)
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
    let root = ensure_notes_root(&state.data_dir, &state.project_service, &project_id)?;
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

            // Prefer the caller's display name so the Info panel can render
            // "Created by <name>" without a separate lookup. Fall back to
            // the raw user_id only when the session doesn't carry a name.
            let created_by = if session.display_name.trim().is_empty() {
                session.user_id.clone()
            } else {
                session.display_name.clone()
            };
            let frontmatter = NoteFrontmatter {
                created_at: Some(iso_now()),
                created_by: Some(created_by),
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
    let root = ensure_notes_root(&state.data_dir, &state.project_service, &project_id)?;
    let from = resolve_rel_path(&root, &req.from)?;
    let to = resolve_rel_path(&root, &req.to)?;
    if !from.exists() {
        return Err(ApiError::not_found(format!(
            "source not found: {}",
            req.from
        )));
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
    let root = ensure_notes_root(&state.data_dir, &state.project_service, &project_id)?;
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
    let root = ensure_notes_root(&state.data_dir, &state.project_service, &project_id)?;
    let note_abs = resolve_rel_path(&root, &query.path)?;
    if !note_abs.is_file() {
        return Err(ApiError::not_found(format!(
            "note not found: {}",
            query.path
        )));
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
    let root = ensure_notes_root(&state.data_dir, &state.project_service, &project_id)?;
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
        id: format!("cm_{}", uuid::Uuid::new_v4().as_simple()),
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
    let root = ensure_notes_root(&state.data_dir, &state.project_service, &project_id)?;
    let note_abs = resolve_rel_path(&root, &req.path)?;
    if !note_abs.is_file() {
        return Err(ApiError::not_found(format!("note not found: {}", req.path)));
    }
    let mut file = load_comments(&note_abs).await?;
    let before = file.comments.len();
    file.comments.retain(|c| c.id != req.id);
    if file.comments.len() == before {
        return Err(ApiError::not_found(format!(
            "comment not found: {}",
            req.id
        )));
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
            TreeNode::Note {
                title, rel_path, ..
            } => {
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

    #[test]
    fn walk_skips_project_id_marker() {
        let (_tmp, root) = setup();
        std::fs::write(root.join(PROJECT_ID_MARKER), "abc-123").unwrap();
        std::fs::write(root.join("kept.md"), "# Kept").unwrap();
        let nodes = walk_notes(&root, &root);
        assert_eq!(nodes.len(), 1);
        match &nodes[0] {
            TreeNode::Note { title, .. } => assert_eq!(title, "Kept"),
            _ => panic!("expected note"),
        }
    }

    #[test]
    fn move_notes_contents_relocates_files_and_folders() {
        let tmp = TempDir::new().unwrap();
        let from = tmp.path().join("old");
        let to = tmp.path().join("new");
        std::fs::create_dir_all(&from).unwrap();
        std::fs::write(from.join("a.md"), "# A").unwrap();
        std::fs::create_dir_all(from.join("folder")).unwrap();
        std::fs::write(from.join("folder/b.md"), "# B").unwrap();
        std::fs::write(from.join(PROJECT_ID_MARKER), "proj-1").unwrap();

        move_notes_contents(&from, &to).unwrap();

        assert!(to.join("a.md").is_file());
        assert!(to.join("folder/b.md").is_file());
        // The project-id marker is intentionally left behind — the caller
        // writes a fresh marker in the new location.
        assert!(!to.join(PROJECT_ID_MARKER).exists());
        // Source payload is gone; only the marker remains.
        assert!(!from.join("a.md").exists());
        assert!(!from.join("folder").exists());
        assert!(from.join(PROJECT_ID_MARKER).exists());
    }

    #[test]
    fn move_notes_contents_does_not_clobber_existing_destination() {
        let tmp = TempDir::new().unwrap();
        let from = tmp.path().join("old");
        let to = tmp.path().join("new");
        std::fs::create_dir_all(&from).unwrap();
        std::fs::create_dir_all(&to).unwrap();
        std::fs::write(from.join("shared.md"), "FROM").unwrap();
        std::fs::write(to.join("shared.md"), "PRE_EXISTING").unwrap();

        move_notes_contents(&from, &to).unwrap();

        // Existing file in destination is preserved; source copy is left
        // in place for the user to reconcile.
        assert_eq!(
            std::fs::read_to_string(to.join("shared.md")).unwrap(),
            "PRE_EXISTING"
        );
        assert!(from.join("shared.md").is_file());
    }

    #[test]
    fn copy_recursive_copies_nested_tree() {
        let tmp = TempDir::new().unwrap();
        let src = tmp.path().join("src");
        let dst = tmp.path().join("dst");
        std::fs::create_dir_all(src.join("a/b")).unwrap();
        std::fs::write(src.join("a/b/leaf.md"), "leaf").unwrap();
        std::fs::write(src.join("root.md"), "root").unwrap();

        copy_recursive(&src, &dst).unwrap();

        assert_eq!(
            std::fs::read_to_string(dst.join("a/b/leaf.md")).unwrap(),
            "leaf"
        );
        assert_eq!(
            std::fs::read_to_string(dst.join("root.md")).unwrap(),
            "root"
        );
        // Original is untouched.
        assert!(src.join("a/b/leaf.md").is_file());
    }

    #[test]
    fn resolve_notes_root_prefers_workspace_when_configured() {
        use aura_os_core::{OrgId, ProjectId};
        use aura_os_projects::{CreateProjectInput, ProjectService, UpdateProjectInput};
        use aura_os_store::SettingsStore;
        use std::sync::Arc;

        let tmp = TempDir::new().unwrap();
        let data_dir = tmp.path().join("data");
        let workspace = tmp.path().join("ws");
        std::fs::create_dir_all(&data_dir).unwrap();
        std::fs::create_dir_all(&workspace).unwrap();

        let store_dir = tmp.path().join("store");
        let store = Arc::new(SettingsStore::open(&store_dir).unwrap());
        let project_service = ProjectService::new(store);

        let project = project_service
            .create_project(CreateProjectInput {
                org_id: OrgId::new(),
                name: "My Product".into(),
                description: String::new(),
                build_command: None,
                test_command: None,
                local_workspace_path: None,
            })
            .unwrap();
        let project_id: ProjectId = project.project_id;

        // No workspace path yet: notes should land under <data_dir>/notes/<slug>/.
        let root_a = resolve_notes_root(&data_dir, &project_service, &project_id).unwrap();
        assert!(root_a.starts_with(data_dir.join("notes")));
        std::fs::write(root_a.join("seed.md"), "# Seed").unwrap();

        // Switch the project to a workspace path. Next resolve migrates the
        // existing seed note into <workspace>/notes/ and updates the marker.
        project_service
            .update_project(
                &project_id,
                UpdateProjectInput {
                    local_workspace_path: Some(Some(workspace.to_string_lossy().into_owned())),
                    ..Default::default()
                },
            )
            .unwrap();

        let root_b = resolve_notes_root(&data_dir, &project_service, &project_id).unwrap();
        assert_eq!(root_b, workspace.join("notes"));
        assert!(root_b.join("seed.md").is_file());
        assert_eq!(
            std::fs::read_to_string(root_b.join(PROJECT_ID_MARKER))
                .unwrap()
                .trim(),
            project_id.to_string()
        );

        // A second resolve is a no-op and keeps pointing at the workspace.
        let root_c = resolve_notes_root(&data_dir, &project_service, &project_id).unwrap();
        assert_eq!(root_c, root_b);
    }

    #[tokio::test]
    async fn maybe_rename_for_title_renames_matching_stem() {
        let (_tmp, root) = setup();
        let original = root.join("untitled.md");
        std::fs::write(&original, "# Hello").unwrap();
        let next = maybe_rename_for_title(&original, "Hello world")
            .await
            .unwrap();
        assert_eq!(
            next.file_name().unwrap().to_string_lossy(),
            "hello-world.md"
        );
        assert!(next.exists());
        assert!(!original.exists());
    }

    #[tokio::test]
    async fn maybe_rename_for_title_moves_comments_sidecar() {
        let (_tmp, root) = setup();
        let original = root.join("untitled.md");
        std::fs::write(&original, "# Hello").unwrap();
        let sidecar = root.join("untitled.md.comments.json");
        std::fs::write(&sidecar, "{\"comments\":[]}").unwrap();

        let next = maybe_rename_for_title(&original, "Hello world")
            .await
            .unwrap();
        assert!(next.exists());
        assert!(!sidecar.exists());
        let moved = root.join("hello-world.md.comments.json");
        assert!(moved.exists());
    }

    #[tokio::test]
    async fn maybe_rename_for_title_no_op_when_stem_matches() {
        let (_tmp, root) = setup();
        let original = root.join("hello-world.md");
        std::fs::write(&original, "# Hello world").unwrap();
        let next = maybe_rename_for_title(&original, "Hello world")
            .await
            .unwrap();
        assert_eq!(next, original);
        assert!(next.exists());
    }

    #[tokio::test]
    async fn maybe_rename_for_title_adds_suffix_on_collision() {
        let (_tmp, root) = setup();
        std::fs::write(root.join("hello-world.md"), "# Existing").unwrap();
        let original = root.join("untitled.md");
        std::fs::write(&original, "# Hello world").unwrap();
        let next = maybe_rename_for_title(&original, "Hello world")
            .await
            .unwrap();
        assert_eq!(
            next.file_name().unwrap().to_string_lossy(),
            "hello-world-2.md"
        );
        assert!(next.exists());
        assert!(!original.exists());
    }

    #[tokio::test]
    async fn maybe_rename_for_title_skips_empty_title() {
        let (_tmp, root) = setup();
        let original = root.join("untitled.md");
        std::fs::write(&original, "").unwrap();
        let next = maybe_rename_for_title(&original, "   ").await.unwrap();
        assert_eq!(next, original);
    }
}
