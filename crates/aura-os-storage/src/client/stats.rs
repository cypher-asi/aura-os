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
        self.get_authed(
            &format!(
                "{}/api/stats?scope=project&projectId={}",
                self.base_url, project_id
            ),
            jwt,
        )
        .await
    }
}
