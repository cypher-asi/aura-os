use crate::error::StorageError;
use crate::types::*;

use super::{validate_url_id, StorageClient};

impl StorageClient {
    pub async fn create_spec(
        &self,
        project_id: &str,
        jwt: &str,
        req: &CreateSpecRequest,
    ) -> Result<StorageSpec, StorageError> {
        validate_url_id(project_id, "project_id")?;
        self.post_authed(
            &format!("{}/api/projects/{}/specs", self.base_url, project_id),
            jwt,
            req,
        )
        .await
    }

    pub async fn list_specs(
        &self,
        project_id: &str,
        jwt: &str,
    ) -> Result<Vec<StorageSpec>, StorageError> {
        validate_url_id(project_id, "project_id")?;
        self.get_authed(
            &format!("{}/api/projects/{}/specs", self.base_url, project_id),
            jwt,
        )
        .await
    }

    pub async fn get_spec(&self, spec_id: &str, jwt: &str) -> Result<StorageSpec, StorageError> {
        validate_url_id(spec_id, "spec_id")?;
        self.get_authed(&format!("{}/api/specs/{}", self.base_url, spec_id), jwt)
            .await
    }

    pub async fn update_spec(
        &self,
        spec_id: &str,
        jwt: &str,
        req: &UpdateSpecRequest,
    ) -> Result<(), StorageError> {
        validate_url_id(spec_id, "spec_id")?;
        self.put_authed_no_response(
            &format!("{}/api/specs/{}", self.base_url, spec_id),
            jwt,
            req,
        )
        .await
    }

    pub async fn delete_spec(&self, spec_id: &str, jwt: &str) -> Result<(), StorageError> {
        validate_url_id(spec_id, "spec_id")?;
        self.delete_authed(&format!("{}/api/specs/{}", self.base_url, spec_id), jwt)
            .await
    }
}
