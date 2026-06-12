use crate::error::StorageError;
use crate::types::*;

use super::{validate_url_id, StorageClient};

impl StorageClient {
    // -----------------------------------------------------------------------
    // Notes
    // -----------------------------------------------------------------------

    pub async fn list_notes(
        &self,
        project_id: &str,
        jwt: &str,
    ) -> Result<Vec<StorageNote>, StorageError> {
        validate_url_id(project_id, "project_id")?;
        self.get_authed(
            &format!("{}/api/projects/{}/notes", self.base_url, project_id),
            jwt,
        )
        .await
    }

    pub async fn get_note(&self, note_id: &str, jwt: &str) -> Result<StorageNote, StorageError> {
        validate_url_id(note_id, "note_id")?;
        self.get_authed(&format!("{}/api/notes/{}", self.base_url, note_id), jwt)
            .await
    }

    pub async fn create_note(
        &self,
        project_id: &str,
        jwt: &str,
        req: &CreateNoteRequest,
    ) -> Result<StorageNote, StorageError> {
        validate_url_id(project_id, "project_id")?;
        self.post_authed(
            &format!("{}/api/projects/{}/notes", self.base_url, project_id),
            jwt,
            req,
        )
        .await
    }

    pub async fn update_note(
        &self,
        note_id: &str,
        jwt: &str,
        req: &UpdateNoteRequest,
    ) -> Result<StorageNote, StorageError> {
        validate_url_id(note_id, "note_id")?;
        self.put_authed(
            &format!("{}/api/notes/{}", self.base_url, note_id),
            jwt,
            req,
        )
        .await
    }

    pub async fn transition_note(
        &self,
        note_id: &str,
        jwt: &str,
        req: &TransitionNoteRequest,
    ) -> Result<StorageNote, StorageError> {
        validate_url_id(note_id, "note_id")?;
        self.post_authed(
            &format!("{}/api/notes/{}/transition", self.base_url, note_id),
            jwt,
            req,
        )
        .await
    }

    pub async fn delete_note(&self, note_id: &str, jwt: &str) -> Result<(), StorageError> {
        validate_url_id(note_id, "note_id")?;
        self.delete_authed(&format!("{}/api/notes/{}", self.base_url, note_id), jwt)
            .await
    }

    // -----------------------------------------------------------------------
    // Note folders
    // -----------------------------------------------------------------------

    pub async fn list_note_folders(
        &self,
        project_id: &str,
        jwt: &str,
    ) -> Result<Vec<StorageNoteFolder>, StorageError> {
        validate_url_id(project_id, "project_id")?;
        self.get_authed(
            &format!("{}/api/projects/{}/note-folders", self.base_url, project_id),
            jwt,
        )
        .await
    }

    pub async fn create_note_folder(
        &self,
        project_id: &str,
        jwt: &str,
        req: &CreateNoteFolderRequest,
    ) -> Result<StorageNoteFolder, StorageError> {
        validate_url_id(project_id, "project_id")?;
        self.post_authed(
            &format!("{}/api/projects/{}/note-folders", self.base_url, project_id),
            jwt,
            req,
        )
        .await
    }

    pub async fn update_note_folder(
        &self,
        folder_id: &str,
        jwt: &str,
        req: &UpdateNoteFolderRequest,
    ) -> Result<StorageNoteFolder, StorageError> {
        validate_url_id(folder_id, "folder_id")?;
        self.put_authed(
            &format!("{}/api/note-folders/{}", self.base_url, folder_id),
            jwt,
            req,
        )
        .await
    }

    pub async fn delete_note_folder(&self, folder_id: &str, jwt: &str) -> Result<(), StorageError> {
        validate_url_id(folder_id, "folder_id")?;
        self.delete_authed(
            &format!("{}/api/note-folders/{}", self.base_url, folder_id),
            jwt,
        )
        .await
    }

    // -----------------------------------------------------------------------
    // Note comments
    // -----------------------------------------------------------------------

    pub async fn list_note_comments(
        &self,
        note_id: &str,
        jwt: &str,
    ) -> Result<Vec<StorageNoteComment>, StorageError> {
        validate_url_id(note_id, "note_id")?;
        self.get_authed(
            &format!("{}/api/notes/{}/comments", self.base_url, note_id),
            jwt,
        )
        .await
    }

    pub async fn create_note_comment(
        &self,
        note_id: &str,
        jwt: &str,
        req: &CreateNoteCommentRequest,
    ) -> Result<StorageNoteComment, StorageError> {
        validate_url_id(note_id, "note_id")?;
        self.post_authed(
            &format!("{}/api/notes/{}/comments", self.base_url, note_id),
            jwt,
            req,
        )
        .await
    }

    pub async fn delete_note_comment(
        &self,
        comment_id: &str,
        jwt: &str,
    ) -> Result<(), StorageError> {
        validate_url_id(comment_id, "comment_id")?;
        self.delete_authed(
            &format!("{}/api/note-comments/{}", self.base_url, comment_id),
            jwt,
        )
        .await
    }

    // -----------------------------------------------------------------------
    // Notes (internal — public blog reads via X-Internal-Token)
    // -----------------------------------------------------------------------

    /// List published notes for a project using the server's internal
    /// (`X-Internal-Token`) credential rather than a caller JWT. Backs the
    /// unauthenticated public-facing blog read path.
    pub async fn list_published_notes_internal(
        &self,
        project_id: &str,
    ) -> Result<Vec<StorageNote>, StorageError> {
        validate_url_id(project_id, "project_id")?;
        self.get_internal(&format!(
            "{}/internal/projects/{}/published-notes",
            self.base_url, project_id
        ))
        .await
    }
}
