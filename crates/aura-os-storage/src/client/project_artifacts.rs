use crate::client::validate_url_id;
use crate::error::StorageError;
use crate::types::{CreateProjectArtifactRequest, StorageProjectArtifact};
use crate::StorageClient;

impl StorageClient {
    pub async fn list_project_artifacts(
        &self,
        project_id: &str,
        artifact_type: Option<&str>,
        jwt: &str,
    ) -> Result<Vec<StorageProjectArtifact>, StorageError> {
        validate_url_id(project_id, "project_id")?;
        let mut url = format!("{}/api/projects/{}/artifacts", self.base_url, project_id);
        if let Some(t) = artifact_type {
            url.push_str(&format!("?type={t}"));
        }
        self.get_authed(&url, jwt).await
    }

    pub async fn create_project_artifact(
        &self,
        project_id: &str,
        jwt: &str,
        req: &CreateProjectArtifactRequest,
    ) -> Result<StorageProjectArtifact, StorageError> {
        validate_url_id(project_id, "project_id")?;
        self.post_authed(
            &format!("{}/api/projects/{}/artifacts", self.base_url, project_id),
            jwt,
            req,
        )
        .await
    }

    pub async fn get_project_artifact(
        &self,
        artifact_id: &str,
        jwt: &str,
    ) -> Result<StorageProjectArtifact, StorageError> {
        validate_url_id(artifact_id, "artifact_id")?;
        self.get_authed(
            &format!("{}/api/artifacts/{}", self.base_url, artifact_id),
            jwt,
        )
        .await
    }

    pub async fn delete_project_artifact(
        &self,
        artifact_id: &str,
        jwt: &str,
    ) -> Result<(), StorageError> {
        validate_url_id(artifact_id, "artifact_id")?;
        self.delete_authed(
            &format!("{}/api/artifacts/{}", self.base_url, artifact_id),
            jwt,
        )
        .await
    }
}
