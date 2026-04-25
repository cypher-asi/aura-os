use tracing::debug;

use crate::error::StorageError;
use crate::types::ProjectStats;

use super::{validate_url_id, StorageClient};

impl StorageClient {
    pub async fn get_project_stats(
        &self,
        project_id: &str,
        jwt: &str,
    ) -> Result<ProjectStats, StorageError> {
        validate_url_id(project_id, "project_id")?;
        // Fetch raw body so we can log the exact keys aura-storage returns.
        // The shared `/api/stats?scope=project` endpoint has historically
        // emitted token / cost / lines / time fields under several
        // naming conventions (camelCase, snake_case, short forms). Without
        // the raw body it's impossible to tell whether a 0 in the panel
        // means "no data on the server" or "field decoded to default
        // because of a key-name mismatch". Mirrors `get_platform_stats`
        // in `aura-os-network`.
        let url = format!(
            "{}/api/stats?scope=project&projectId={}",
            self.base_url, project_id
        );
        let resp = self.http.get(&url).bearer_auth(jwt).send().await?;
        let status = resp.status();
        if !status.is_success() {
            let body = resp.text().await.unwrap_or_default();
            return Err(StorageError::Server {
                status: status.as_u16(),
                body,
            });
        }
        let body = resp
            .text()
            .await
            .map_err(|e| StorageError::Deserialize(e.to_string()))?;
        debug!(%url, body = %body, "project_stats raw response");
        serde_json::from_str::<ProjectStats>(&body).map_err(|e| {
            let preview: String = body.chars().take(400).collect();
            tracing::warn!(%url, error = %e, body_preview = %preview, "project_stats deserialization failed");
            StorageError::Deserialize(e.to_string())
        })
    }
}
