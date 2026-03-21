use crate::error::StorageError;
use crate::types::*;

use super::{validate_url_id, StorageClient};

impl StorageClient {
    pub async fn create_log_entry(
        &self,
        project_id: &str,
        jwt: &str,
        req: &CreateLogEntryRequest,
    ) -> Result<(), StorageError> {
        validate_url_id(project_id, "project_id")?;
        let url = format!("{}/api/projects/{}/logs", self.base_url, project_id);
        let resp = self
            .http
            .post(&url)
            .bearer_auth(jwt)
            .json(req)
            .send()
            .await?;
        let status = resp.status();
        if !status.is_success() {
            let body = resp.text().await.unwrap_or_default();
            return Err(StorageError::Server {
                status: status.as_u16(),
                body,
            });
        }
        Ok(())
    }

    pub async fn list_log_entries(
        &self,
        project_id: &str,
        jwt: &str,
        level: Option<&str>,
        limit: Option<u32>,
        offset: Option<u32>,
    ) -> Result<Vec<StorageLogEntry>, StorageError> {
        validate_url_id(project_id, "project_id")?;
        let mut url = format!("{}/api/projects/{}/logs", self.base_url, project_id);
        let mut params = Vec::new();
        if let Some(l) = level {
            params.push(format!("level={}", l));
        }
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
