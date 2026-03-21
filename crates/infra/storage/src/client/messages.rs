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
        if let Some(l) = limit {
            params.push(format!("limit={}", l));
        }
        if let Some(o) = offset {
            params.push(format!("offset={}", o));
        }
        if !params.is_empty() {
            url.push('?');
            url.push_str(&params.join("&"));
        }
        self.get_authed(&url, jwt).await
    }
}
