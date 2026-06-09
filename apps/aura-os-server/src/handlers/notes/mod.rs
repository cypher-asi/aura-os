//! Notes app handlers (storage-backed, ID-based).
//!
//! Notes were historically plain markdown files on disk. They are now
//! persisted through `aura-storage` as first-class rows. The markdown
//! BODY lives on S3 (uploaded by the frontend via the presign flow);
//! aura-os-server only persists metadata plus the S3 reference
//! (`bodyUrl` / `bodyS3Key`) on the note row.
//!
//! Blog posts are just notes that live under the reserved
//! [`AURA_BLOG_PROJECT_ID`] project with the extra blog fields populated
//! and a draft/published lifecycle. Writes to that reserved project are
//! restricted to system administrators (see [`require_blog_write`]); the
//! published posts are served anonymously by the public blog endpoints in
//! `crate::handlers::public::blog`.
//!
//! Every response reuses the `aura-storage` `Storage*` types directly
//! (already `Serialize` + camelCase) so there is no duplicate DTO layer.

use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::Json;
use serde::{Deserialize, Serialize};

mod import;
pub(crate) use import::import_project_notes;

type ApiErrorResponse = (StatusCode, Json<ApiError>);

use aura_os_core::ZeroAuthSession;
use aura_os_storage::{
    CreateNoteCommentRequest, CreateNoteFolderRequest, CreateNoteRequest, StorageNote,
    StorageNoteComment, StorageNoteFolder, TransitionNoteRequest, UpdateNoteFolderRequest,
    UpdateNoteRequest,
};

use crate::error::{map_storage_error, ApiError, ApiResult};
use crate::handlers::permissions::require_sys_admin;
use crate::state::{AppState, AuthJwt, AuthSession};

/// Reserved project that backs the aura-blog CMS. All blog posts are
/// stored as notes under this fixed `project_id`. It is a valid (but
/// otherwise unused) UUID so it slots into the same `/api/notes/projects/
/// :project_id/...` routes as any normal project while still being easy to
/// recognise. Writes to this project are sys-admin only; reads of its
/// published notes are exposed anonymously via `/api/public/blog`.
pub(crate) const AURA_BLOG_PROJECT_ID: &str = "00000000-0000-0000-0000-00000000b106";

/// Reserved project that backs the AURA OS whitepaper (`/os`). Mirrors
/// [`AURA_BLOG_PROJECT_ID`]: whitepaper sections are notes under this fixed
/// `project_id`, writes are sys-admin only (see [`require_blog_write`]), and
/// the published subset is served anonymously via `/api/public/os`.
pub(crate) const AURA_WHITEPAPER_PROJECT_ID: &str = "00000000-0000-0000-0000-00000000a05a";

/// Reserved project that backs the public documentation (`/docs`). Mirrors
/// [`AURA_BLOG_PROJECT_ID`]: doc pages are notes under this fixed
/// `project_id`, writes are sys-admin only (see [`require_blog_write`]), and
/// the published subset is served anonymously via `/api/public/docs`. The
/// `blogType` field doubles as the collapsible repository/section group key
/// on the public `/docs` page.
pub(crate) const AURA_DOCS_PROJECT_ID: &str = "00000000-0000-0000-0000-00000000d0c5";

/// `{ "folders": [...], "notes": [...] }` payload returned by the tree
/// endpoint. Reuses the storage row types verbatim.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct NoteTreeResponse {
    pub folders: Vec<StorageNoteFolder>,
    pub notes: Vec<StorageNote>,
}

/// Create-note request body. The storage `CreateNoteRequest` requires a
/// `slug`; we accept it as optional here and derive one from the title
/// when omitted so callers only need `title`.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CreateNoteBody {
    pub title: String,
    #[serde(default)]
    pub slug: Option<String>,
    #[serde(default)]
    pub folder_id: Option<String>,
}

/// Map a storage error to an API error, surfacing upstream 404s as 404s.
fn map_note_error(e: aura_os_storage::StorageError) -> ApiErrorResponse {
    match &e {
        aura_os_storage::StorageError::Server { status: 404, .. } => {
            ApiError::not_found("note not found")
        }
        _ => map_storage_error(e),
    }
}

/// Gate writes to the reserved CMS projects (blog + whitepaper) behind
/// sys-admin. Any other project is writable by any authenticated caller
/// (AuthJwt is enough).
fn require_blog_write(project_id: &str, session: &ZeroAuthSession) -> ApiResult<()> {
    if project_id == AURA_BLOG_PROJECT_ID
        || project_id == AURA_WHITEPAPER_PROJECT_ID
        || project_id == AURA_DOCS_PROJECT_ID
    {
        require_sys_admin(session)?;
    }
    Ok(())
}

/// Derive a URL-safe slug from a title: lowercase, non-alphanumerics
/// collapsed to single hyphens, trimmed. Falls back to "note" when the
/// title has no usable characters.
fn slugify(title: &str) -> String {
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

// ---------------------------------------------------------------------------
// Tree
// ---------------------------------------------------------------------------

pub(crate) async fn list_tree(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    Path(project_id): Path<String>,
) -> ApiResult<Json<NoteTreeResponse>> {
    let storage = state.require_storage_client()?;
    let folders = storage
        .list_note_folders(&project_id, &jwt)
        .await
        .map_err(map_note_error)?;
    let notes = storage
        .list_notes(&project_id, &jwt)
        .await
        .map_err(map_note_error)?;
    Ok(Json(NoteTreeResponse { folders, notes }))
}

// ---------------------------------------------------------------------------
// Notes
// ---------------------------------------------------------------------------

pub(crate) async fn create_note(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    AuthSession(session): AuthSession,
    Path(project_id): Path<String>,
    Json(body): Json<CreateNoteBody>,
) -> ApiResult<Json<StorageNote>> {
    require_blog_write(&project_id, &session)?;
    let storage = state.require_storage_client()?;
    let slug = body
        .slug
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| slugify(&body.title));
    let req = CreateNoteRequest {
        title: body.title,
        slug,
        org_id: None,
        folder_id: body.folder_id,
        sort_order: None,
        word_count: None,
        body_url: None,
        body_s3_key: None,
        blog_type: None,
        excerpt: None,
        hero_image_url: None,
        read_time_minutes: None,
        author_id: None,
        author_name: None,
        author_avatar_url: None,
        sections: None,
    };
    let note = storage
        .create_note(&project_id, &jwt, &req)
        .await
        .map_err(map_note_error)?;
    Ok(Json(note))
}

pub(crate) async fn get_note(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    Path((_project_id, note_id)): Path<(String, String)>,
) -> ApiResult<Json<StorageNote>> {
    let storage = state.require_storage_client()?;
    let note = storage
        .get_note(&note_id, &jwt)
        .await
        .map_err(map_note_error)?;
    Ok(Json(note))
}

pub(crate) async fn update_note(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    AuthSession(session): AuthSession,
    Path((project_id, note_id)): Path<(String, String)>,
    Json(req): Json<UpdateNoteRequest>,
) -> ApiResult<Json<StorageNote>> {
    require_blog_write(&project_id, &session)?;
    let storage = state.require_storage_client()?;
    let note = storage
        .update_note(&note_id, &jwt, &req)
        .await
        .map_err(map_note_error)?;
    Ok(Json(note))
}

pub(crate) async fn delete_note(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    AuthSession(session): AuthSession,
    Path((project_id, note_id)): Path<(String, String)>,
) -> ApiResult<StatusCode> {
    require_blog_write(&project_id, &session)?;
    let storage = state.require_storage_client()?;
    storage
        .delete_note(&note_id, &jwt)
        .await
        .map_err(map_note_error)?;
    Ok(StatusCode::NO_CONTENT)
}

pub(crate) async fn transition_note(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    AuthSession(session): AuthSession,
    Path((project_id, note_id)): Path<(String, String)>,
    Json(req): Json<TransitionNoteRequest>,
) -> ApiResult<Json<StorageNote>> {
    require_blog_write(&project_id, &session)?;
    let storage = state.require_storage_client()?;
    let note = storage
        .transition_note(&note_id, &jwt, &req)
        .await
        .map_err(map_note_error)?;
    Ok(Json(note))
}

// ---------------------------------------------------------------------------
// Folders
// ---------------------------------------------------------------------------

pub(crate) async fn create_folder(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    AuthSession(session): AuthSession,
    Path(project_id): Path<String>,
    Json(req): Json<CreateNoteFolderRequest>,
) -> ApiResult<Json<StorageNoteFolder>> {
    require_blog_write(&project_id, &session)?;
    let storage = state.require_storage_client()?;
    let folder = storage
        .create_note_folder(&project_id, &jwt, &req)
        .await
        .map_err(map_note_error)?;
    Ok(Json(folder))
}

pub(crate) async fn update_folder(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    AuthSession(session): AuthSession,
    Path((project_id, folder_id)): Path<(String, String)>,
    Json(req): Json<UpdateNoteFolderRequest>,
) -> ApiResult<Json<StorageNoteFolder>> {
    require_blog_write(&project_id, &session)?;
    let storage = state.require_storage_client()?;
    let folder = storage
        .update_note_folder(&folder_id, &jwt, &req)
        .await
        .map_err(map_note_error)?;
    Ok(Json(folder))
}

pub(crate) async fn delete_folder(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    AuthSession(session): AuthSession,
    Path((project_id, folder_id)): Path<(String, String)>,
) -> ApiResult<StatusCode> {
    require_blog_write(&project_id, &session)?;
    let storage = state.require_storage_client()?;
    storage
        .delete_note_folder(&folder_id, &jwt)
        .await
        .map_err(map_note_error)?;
    Ok(StatusCode::NO_CONTENT)
}

// ---------------------------------------------------------------------------
// Comments
// ---------------------------------------------------------------------------

pub(crate) async fn list_comments(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    Path((_project_id, note_id)): Path<(String, String)>,
) -> ApiResult<Json<Vec<StorageNoteComment>>> {
    let storage = state.require_storage_client()?;
    let comments = storage
        .list_note_comments(&note_id, &jwt)
        .await
        .map_err(map_note_error)?;
    Ok(Json(comments))
}

pub(crate) async fn create_comment(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    AuthSession(session): AuthSession,
    Path((project_id, note_id)): Path<(String, String)>,
    Json(req): Json<CreateNoteCommentRequest>,
) -> ApiResult<Json<StorageNoteComment>> {
    require_blog_write(&project_id, &session)?;
    let storage = state.require_storage_client()?;
    let comment = storage
        .create_note_comment(&note_id, &jwt, &req)
        .await
        .map_err(map_note_error)?;
    Ok(Json(comment))
}

pub(crate) async fn delete_comment(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    AuthSession(session): AuthSession,
    Path((project_id, _note_id, comment_id)): Path<(String, String, String)>,
) -> ApiResult<StatusCode> {
    require_blog_write(&project_id, &session)?;
    let storage = state.require_storage_client()?;
    storage
        .delete_note_comment(&comment_id, &jwt)
        .await
        .map_err(map_note_error)?;
    Ok(StatusCode::NO_CONTENT)
}
