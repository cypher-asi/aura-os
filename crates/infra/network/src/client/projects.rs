use crate::error::NetworkError;
use crate::types::*;

use super::NetworkClient;

impl NetworkClient {
    pub async fn create_project(
        &self,
        jwt: &str,
        req: &CreateProjectRequest,
    ) -> Result<NetworkProject, NetworkError> {
        self.post_authed(&format!("{}/api/projects", self.base_url), jwt, req)
            .await
    }

    pub async fn list_projects_by_org(
        &self,
        org_id: &str,
        jwt: &str,
    ) -> Result<Vec<NetworkProject>, NetworkError> {
        self.get_authed(
            &format!("{}/api/projects?org_id={}", self.base_url, org_id),
            jwt,
        )
        .await
    }

    pub async fn get_project(
        &self,
        project_id: &str,
        jwt: &str,
    ) -> Result<NetworkProject, NetworkError> {
        self.get_authed(
            &format!("{}/api/projects/{}", self.base_url, project_id),
            jwt,
        )
        .await
    }

    pub async fn update_project(
        &self,
        project_id: &str,
        jwt: &str,
        req: &UpdateProjectRequest,
    ) -> Result<NetworkProject, NetworkError> {
        self.put_authed(
            &format!("{}/api/projects/{}", self.base_url, project_id),
            jwt,
            req,
        )
        .await
    }

    pub async fn delete_project(&self, project_id: &str, jwt: &str) -> Result<(), NetworkError> {
        self.delete_authed(
            &format!("{}/api/projects/{}", self.base_url, project_id),
            jwt,
        )
        .await
    }
}
