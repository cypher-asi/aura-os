use crate::error::StorageError;
use crate::types::*;

use super::{validate_url_id, StorageClient};

impl StorageClient {
    pub async fn create_event(
        &self,
        session_id: &str,
        jwt: &str,
        req: &CreateSessionEventRequest,
    ) -> Result<StorageSessionEvent, StorageError> {
        validate_url_id(session_id, "session_id")?;
        self.post_authed(
            &format!("{}/api/sessions/{}/events", self.base_url, session_id),
            jwt,
            req,
        )
        .await
    }

    pub async fn list_events(
        &self,
        session_id: &str,
        jwt: &str,
        limit: Option<u32>,
        offset: Option<u32>,
    ) -> Result<Vec<StorageSessionEvent>, StorageError> {
        validate_url_id(session_id, "session_id")?;
        let mut url = format!("{}/api/sessions/{}/events", self.base_url, session_id);
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
