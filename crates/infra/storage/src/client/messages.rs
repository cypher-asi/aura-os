use crate::error::StorageError;
use crate::types::*;

use super::{validate_url_id, StorageClient};

impl StorageClient {
    pub async fn create_message(
        &self,
        session_id: &str,
        jwt: &str,
        req: &CreateMessageRequest,
    ) -> Result<StorageMessage, StorageError> {
        validate_url_id(session_id, "session_id")?;
        self.post_authed(
            &format!("{}/api/sessions/{}/messages", self.base_url, session_id),
            jwt,
            req,
        )
        .await
    }

    pub async fn update_message(
        &self,
        message_id: &str,
        jwt: &str,
        req: &UpdateMessageRequest,
    ) -> Result<(), StorageError> {
        validate_url_id(message_id, "message_id")?;
        self.put_authed_no_response(
            &format!("{}/api/messages/{}", self.base_url, message_id),
            jwt,
            req,
        )
        .await
    }

    pub async fn list_messages(
        &self,
        session_id: &str,
        jwt: &str,
        limit: Option<u32>,
        offset: Option<u32>,
    ) -> Result<Vec<StorageMessage>, StorageError> {
        validate_url_id(session_id, "session_id")?;
        let mut url = format!("{}/api/sessions/{}/messages", self.base_url, session_id);
        let mut params = Vec::new();
        if let Some(limit_val) = limit {
            params.push(format!("limit={limit_val}"));
        }
        if let Some(offset_val) = offset {
            params.push(format!("offset={offset_val}"));
        }
        if !params.is_empty() {
            url.push('?');
            url.push_str(&params.join("&"));
        }
        self.get_authed(&url, jwt).await
    }
}
