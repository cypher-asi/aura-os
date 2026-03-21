use crate::error::StorageError;
use crate::types::*;

use super::{validate_url_id, StorageClient};

impl StorageClient {
    pub async fn create_project_agent(
        &self,
        project_id: &str,
        jwt: &str,
        req: &CreateProjectAgentRequest,
    ) -> Result<StorageProjectAgent, StorageError> {
        validate_url_id(project_id, "project_id")?;
        self.post_authed(
            &format!("{}/api/projects/{}/agents", self.base_url, project_id),
            jwt,
            req,
        )
        .await
    }

    pub async fn list_project_agents(
        &self,
        project_id: &str,
        jwt: &str,
    ) -> Result<Vec<StorageProjectAgent>, StorageError> {
        validate_url_id(project_id, "project_id")?;
        self.get_authed(
            &format!("{}/api/projects/{}/agents", self.base_url, project_id),
            jwt,
        )
        .await
    }

    pub async fn get_project_agent(
        &self,
        project_agent_id: &str,
        jwt: &str,
    ) -> Result<StorageProjectAgent, StorageError> {
        validate_url_id(project_agent_id, "project_agent_id")?;
        self.get_authed(
            &format!("{}/api/project-agents/{}", self.base_url, project_agent_id),
            jwt,
        )
        .await
    }

    pub async fn update_project_agent_status(
        &self,
        project_agent_id: &str,
        jwt: &str,
        req: &UpdateProjectAgentRequest,
    ) -> Result<(), StorageError> {
        validate_url_id(project_agent_id, "project_agent_id")?;
        self.put_authed_no_response(
            &format!("{}/api/project-agents/{}", self.base_url, project_agent_id),
            jwt,
            req,
        )
        .await
    }

    pub async fn delete_project_agent(
        &self,
        project_agent_id: &str,
        jwt: &str,
    ) -> Result<(), StorageError> {
        validate_url_id(project_agent_id, "project_agent_id")?;
        self.delete_authed(
            &format!("{}/api/project-agents/{}", self.base_url, project_agent_id),
            jwt,
        )
        .await
    }
}
