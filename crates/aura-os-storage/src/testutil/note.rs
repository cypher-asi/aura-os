use axum::{
    extract::{Path, State},
    Json,
};
use chrono::Utc;

use crate::types::*;

use super::db::{new_id, SharedDb};

// ---------------------------------------------------------------------------
// Notes
// ---------------------------------------------------------------------------

pub(super) async fn create_note(
    Path(project_id): Path<String>,
    State(db): State<SharedDb>,
    Json(req): Json<CreateNoteRequest>,
) -> Json<StorageNote> {
    let now = Utc::now().to_rfc3339();
    let note = StorageNote {
        id: new_id(),
        project_id: Some(project_id),
        org_id: req.org_id,
        folder_id: req.folder_id,
        title: Some(req.title),
        slug: Some(req.slug),
        sort_order: req.sort_order.or(Some(0)),
        word_count: req.word_count.or(Some(0)),
        body_url: req.body_url,
        body_s3_key: req.body_s3_key,
        status: Some("draft".to_string()),
        blog_type: req.blog_type,
        excerpt: req.excerpt,
        hero_image_url: req.hero_image_url,
        read_time_minutes: req.read_time_minutes,
        published_at: None,
        author_id: req.author_id,
        author_name: req.author_name,
        author_avatar_url: req.author_avatar_url,
        sections: req.sections,
        created_by: None,
        created_at: Some(now.clone()),
        updated_at: Some(now),
    };
    let mut db = db.lock().await;
    db.notes.push(note.clone());
    Json(note)
}

pub(super) async fn list_notes(
    Path(project_id): Path<String>,
    State(db): State<SharedDb>,
) -> Json<Vec<StorageNote>> {
    let db = db.lock().await;
    let notes: Vec<_> = db
        .notes
        .iter()
        .filter(|n| n.project_id.as_deref() == Some(&project_id))
        .cloned()
        .collect();
    Json(notes)
}

pub(super) async fn get_note(
    Path(note_id): Path<String>,
    State(db): State<SharedDb>,
) -> Result<Json<StorageNote>, axum::http::StatusCode> {
    let db = db.lock().await;
    db.notes
        .iter()
        .find(|n| n.id == note_id)
        .cloned()
        .map(Json)
        .ok_or(axum::http::StatusCode::NOT_FOUND)
}

pub(super) async fn update_note(
    Path(note_id): Path<String>,
    State(db): State<SharedDb>,
    Json(req): Json<UpdateNoteRequest>,
) -> Result<Json<StorageNote>, axum::http::StatusCode> {
    let mut db = db.lock().await;
    if let Some(note) = db.notes.iter_mut().find(|n| n.id == note_id) {
        if let Some(v) = req.folder_id {
            note.folder_id = Some(v);
        }
        if let Some(v) = req.title {
            note.title = Some(v);
        }
        if let Some(v) = req.slug {
            note.slug = Some(v);
        }
        if let Some(v) = req.sort_order {
            note.sort_order = Some(v);
        }
        if let Some(v) = req.word_count {
            note.word_count = Some(v);
        }
        if let Some(v) = req.body_url {
            note.body_url = Some(v);
        }
        if let Some(v) = req.body_s3_key {
            note.body_s3_key = Some(v);
        }
        if let Some(v) = req.blog_type {
            note.blog_type = Some(v);
        }
        if let Some(v) = req.excerpt {
            note.excerpt = Some(v);
        }
        if let Some(v) = req.hero_image_url {
            note.hero_image_url = Some(v);
        }
        if let Some(v) = req.read_time_minutes {
            note.read_time_minutes = Some(v);
        }
        if let Some(v) = req.author_id {
            note.author_id = Some(v);
        }
        if let Some(v) = req.author_name {
            note.author_name = Some(v);
        }
        if let Some(v) = req.author_avatar_url {
            note.author_avatar_url = Some(v);
        }
        if let Some(v) = req.sections {
            note.sections = Some(v);
        }
        note.updated_at = Some(Utc::now().to_rfc3339());
        Ok(Json(note.clone()))
    } else {
        Err(axum::http::StatusCode::NOT_FOUND)
    }
}

pub(super) async fn transition_note(
    Path(note_id): Path<String>,
    State(db): State<SharedDb>,
    Json(req): Json<TransitionNoteRequest>,
) -> Result<Json<StorageNote>, axum::http::StatusCode> {
    let mut db = db.lock().await;
    if let Some(note) = db.notes.iter_mut().find(|n| n.id == note_id) {
        let now = Utc::now().to_rfc3339();
        note.published_at = if req.status == "published" {
            Some(now.clone())
        } else {
            None
        };
        note.status = Some(req.status);
        note.updated_at = Some(now);
        Ok(Json(note.clone()))
    } else {
        Err(axum::http::StatusCode::NOT_FOUND)
    }
}

pub(super) async fn delete_note(
    Path(note_id): Path<String>,
    State(db): State<SharedDb>,
) -> axum::http::StatusCode {
    let mut db = db.lock().await;
    let len_before = db.notes.len();
    db.notes.retain(|n| n.id != note_id);
    if db.notes.len() < len_before {
        axum::http::StatusCode::NO_CONTENT
    } else {
        axum::http::StatusCode::NOT_FOUND
    }
}

pub(super) async fn list_published_notes(
    Path(project_id): Path<String>,
    State(db): State<SharedDb>,
) -> Json<Vec<StorageNote>> {
    let db = db.lock().await;
    let notes: Vec<_> = db
        .notes
        .iter()
        .filter(|n| {
            n.project_id.as_deref() == Some(&project_id) && n.status.as_deref() == Some("published")
        })
        .cloned()
        .collect();
    Json(notes)
}

// ---------------------------------------------------------------------------
// Note folders
// ---------------------------------------------------------------------------

pub(super) async fn create_note_folder(
    Path(project_id): Path<String>,
    State(db): State<SharedDb>,
    Json(req): Json<CreateNoteFolderRequest>,
) -> Json<StorageNoteFolder> {
    let now = Utc::now().to_rfc3339();
    let folder = StorageNoteFolder {
        id: new_id(),
        project_id: Some(project_id),
        org_id: req.org_id,
        parent_id: req.parent_id,
        name: Some(req.name),
        sort_order: req.sort_order.or(Some(0)),
        created_by: None,
        created_at: Some(now.clone()),
        updated_at: Some(now),
    };
    let mut db = db.lock().await;
    db.note_folders.push(folder.clone());
    Json(folder)
}

pub(super) async fn list_note_folders(
    Path(project_id): Path<String>,
    State(db): State<SharedDb>,
) -> Json<Vec<StorageNoteFolder>> {
    let db = db.lock().await;
    let folders: Vec<_> = db
        .note_folders
        .iter()
        .filter(|f| f.project_id.as_deref() == Some(&project_id))
        .cloned()
        .collect();
    Json(folders)
}

pub(super) async fn update_note_folder(
    Path(folder_id): Path<String>,
    State(db): State<SharedDb>,
    Json(req): Json<UpdateNoteFolderRequest>,
) -> Result<Json<StorageNoteFolder>, axum::http::StatusCode> {
    let mut db = db.lock().await;
    if let Some(folder) = db.note_folders.iter_mut().find(|f| f.id == folder_id) {
        if let Some(v) = req.parent_id {
            folder.parent_id = Some(v);
        }
        if let Some(v) = req.name {
            folder.name = Some(v);
        }
        if let Some(v) = req.sort_order {
            folder.sort_order = Some(v);
        }
        folder.updated_at = Some(Utc::now().to_rfc3339());
        Ok(Json(folder.clone()))
    } else {
        Err(axum::http::StatusCode::NOT_FOUND)
    }
}

pub(super) async fn delete_note_folder(
    Path(folder_id): Path<String>,
    State(db): State<SharedDb>,
) -> axum::http::StatusCode {
    let mut db = db.lock().await;
    let len_before = db.note_folders.len();
    db.note_folders.retain(|f| f.id != folder_id);
    if db.note_folders.len() < len_before {
        axum::http::StatusCode::NO_CONTENT
    } else {
        axum::http::StatusCode::NOT_FOUND
    }
}

// ---------------------------------------------------------------------------
// Note comments
// ---------------------------------------------------------------------------

pub(super) async fn create_note_comment(
    Path(note_id): Path<String>,
    State(db): State<SharedDb>,
    Json(req): Json<CreateNoteCommentRequest>,
) -> Json<StorageNoteComment> {
    let comment = StorageNoteComment {
        id: new_id(),
        note_id: Some(note_id),
        author_id: req.author_id,
        author_name: req.author_name,
        body: Some(req.body),
        created_at: Some(Utc::now().to_rfc3339()),
    };
    let mut db = db.lock().await;
    db.note_comments.push(comment.clone());
    Json(comment)
}

pub(super) async fn list_note_comments(
    Path(note_id): Path<String>,
    State(db): State<SharedDb>,
) -> Json<Vec<StorageNoteComment>> {
    let db = db.lock().await;
    let comments: Vec<_> = db
        .note_comments
        .iter()
        .filter(|c| c.note_id.as_deref() == Some(&note_id))
        .cloned()
        .collect();
    Json(comments)
}

pub(super) async fn delete_note_comment(
    Path(comment_id): Path<String>,
    State(db): State<SharedDb>,
) -> axum::http::StatusCode {
    let mut db = db.lock().await;
    let len_before = db.note_comments.len();
    db.note_comments.retain(|c| c.id != comment_id);
    if db.note_comments.len() < len_before {
        axum::http::StatusCode::NO_CONTENT
    } else {
        axum::http::StatusCode::NOT_FOUND
    }
}
