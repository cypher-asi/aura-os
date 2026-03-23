use crate::error::StorageError;
use crate::types::*;

use super::{validate_url_id, StorageClient};

impl StorageClient {
    pub async fn create_task(
        &self,
        project_id: &str,
        jwt: &str,
        req: &CreateTaskRequest,
    ) -> Result<StorageTask, StorageError> {
        validate_url_id(project_id, "project_id")?;
        self.post_authed(
            &format!("{}/api/projects/{}/tasks", self.base_url, project_id),
            jwt,
            req,
        )
        .await
    }

    pub async fn list_tasks(
        &self,
        project_id: &str,
        jwt: &str,
    ) -> Result<Vec<StorageTask>, StorageError> {
        validate_url_id(project_id, "project_id")?;
        self.get_authed(
            &format!("{}/api/projects/{}/tasks", self.base_url, project_id),
            jwt,
        )
        .await
    }

    pub async fn get_task(&self, task_id: &str, jwt: &str) -> Result<StorageTask, StorageError> {
        validate_url_id(task_id, "task_id")?;
        self.get_authed(&format!("{}/api/tasks/{}", self.base_url, task_id), jwt)
            .await
    }

    pub async fn update_task(
        &self,
        task_id: &str,
        jwt: &str,
        req: &UpdateTaskRequest,
    ) -> Result<(), StorageError> {
        validate_url_id(task_id, "task_id")?;
        self.put_authed_no_response(
            &format!("{}/api/tasks/{}", self.base_url, task_id),
            jwt,
            req,
        )
        .await
    }

    pub async fn transition_task(
        &self,
        task_id: &str,
        jwt: &str,
        req: &TransitionTaskRequest,
    ) -> Result<(), StorageError> {
        validate_url_id(task_id, "task_id")?;
        let url = format!("{}/api/tasks/{}/transition", self.base_url, task_id);
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

    pub async fn delete_task(&self, task_id: &str, jwt: &str) -> Result<(), StorageError> {
        validate_url_id(task_id, "task_id")?;
        self.delete_authed(&format!("{}/api/tasks/{}", self.base_url, task_id), jwt)
            .await
    }
}
