use crate::error::StorageError;
use crate::types::*;

use super::{validate_url_id, StorageClient};

impl StorageClient {
    async fn list_events_page(
        &self,
        session_id: &str,
        jwt: &str,
        limit: u32,
        offset: u32,
    ) -> Result<Vec<StorageSessionEvent>, StorageError> {
        validate_url_id(session_id, "session_id")?;
        let url = format!(
            "{}/api/sessions/{}/events?limit={limit}&offset={offset}",
            self.base_url, session_id
        );
        self.get_authed(&url, jwt).await
    }

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
        if let Some(limit_val) = limit {
            return self
                .list_events_page(session_id, jwt, limit_val, offset.unwrap_or(0))
                .await;
        }

        // aura-storage defaults omitted `limit` to 100 server-side. Most callers
        // use `None` here to mean "load the full session history", so paginate
        // until exhaustion instead of silently truncating at that default.
        const PAGE_SIZE: u32 = 500;
        let mut all_events = Vec::new();
        let mut next_offset = offset.unwrap_or(0);

        loop {
            let page = self
                .list_events_page(session_id, jwt, PAGE_SIZE, next_offset)
                .await?;
            let page_len = page.len() as u32;
            all_events.extend(page);
            if page_len < PAGE_SIZE {
                break;
            }
            next_offset += page_len;
        }

        Ok(all_events)
    }
}
