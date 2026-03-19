use std::env;

use reqwest::Client;
use tracing::info;

use crate::error::StorageError;
use crate::types::*;

/// HTTP client for the aura-storage shared backend service.
///
/// Wraps `reqwest` with typed methods for each aura-storage API endpoint.
/// All authenticated requests accept a JWT token parameter forwarded as
/// `Authorization: Bearer <jwt>`.
#[derive(Clone)]
pub struct StorageClient {
    http: Client,
    base_url: String,
}

impl StorageClient {
    /// Create a new `StorageClient`, reading `AURA_STORAGE_URL` from env.
    /// Returns `None` if the env var is not set or empty (storage integration disabled).
    pub fn from_env() -> Option<Self> {
        let base_url = env::var("AURA_STORAGE_URL")
            .ok()
            .filter(|s| !s.is_empty())?;

        let base_url = base_url.trim_end_matches('/').to_string();
        info!(%base_url, "aura-storage client configured");

        Some(Self {
            http: Client::new(),
            base_url,
        })
    }

    #[cfg(test)]
    pub fn with_base_url(base_url: &str) -> Self {
        Self {
            http: Client::new(),
            base_url: base_url.trim_end_matches('/').to_string(),
        }
    }

    pub fn base_url(&self) -> &str {
        &self.base_url
    }

    // -----------------------------------------------------------------------
    // Health
    // -----------------------------------------------------------------------

    pub async fn health_check(&self) -> Result<(), StorageError> {
        let url = format!("{}/health", self.base_url);
        let resp = self.http.get(&url).send().await?;
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

    // -----------------------------------------------------------------------
    // Project Agents
    // -----------------------------------------------------------------------

    pub async fn create_project_agent(
        &self,
        project_id: &str,
        jwt: &str,
        req: &CreateProjectAgentRequest,
    ) -> Result<StorageProjectAgent, StorageError> {
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
        self.delete_authed(
            &format!("{}/api/project-agents/{}", self.base_url, project_agent_id),
            jwt,
        )
        .await
    }

    // -----------------------------------------------------------------------
    // Specs
    // -----------------------------------------------------------------------

    pub async fn create_spec(
        &self,
        project_id: &str,
        jwt: &str,
        req: &CreateSpecRequest,
    ) -> Result<StorageSpec, StorageError> {
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
        self.get_authed(
            &format!("{}/api/projects/{}/specs", self.base_url, project_id),
            jwt,
        )
        .await
    }

    pub async fn get_spec(
        &self,
        spec_id: &str,
        jwt: &str,
    ) -> Result<StorageSpec, StorageError> {
        self.get_authed(
            &format!("{}/api/specs/{}", self.base_url, spec_id),
            jwt,
        )
        .await
    }

    pub async fn update_spec(
        &self,
        spec_id: &str,
        jwt: &str,
        req: &UpdateSpecRequest,
    ) -> Result<(), StorageError> {
        self.put_authed_no_response(
            &format!("{}/api/specs/{}", self.base_url, spec_id),
            jwt,
            req,
        )
        .await
    }

    pub async fn delete_spec(
        &self,
        spec_id: &str,
        jwt: &str,
    ) -> Result<(), StorageError> {
        self.delete_authed(
            &format!("{}/api/specs/{}", self.base_url, spec_id),
            jwt,
        )
        .await
    }

    // -----------------------------------------------------------------------
    // Tasks
    // -----------------------------------------------------------------------

    pub async fn create_task(
        &self,
        project_id: &str,
        jwt: &str,
        req: &CreateTaskRequest,
    ) -> Result<StorageTask, StorageError> {
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
        self.get_authed(
            &format!("{}/api/projects/{}/tasks", self.base_url, project_id),
            jwt,
        )
        .await
    }

    pub async fn get_task(
        &self,
        task_id: &str,
        jwt: &str,
    ) -> Result<StorageTask, StorageError> {
        self.get_authed(
            &format!("{}/api/tasks/{}", self.base_url, task_id),
            jwt,
        )
        .await
    }

    pub async fn update_task(
        &self,
        task_id: &str,
        jwt: &str,
        req: &UpdateTaskRequest,
    ) -> Result<(), StorageError> {
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

    pub async fn delete_task(
        &self,
        task_id: &str,
        jwt: &str,
    ) -> Result<(), StorageError> {
        self.delete_authed(
            &format!("{}/api/tasks/{}", self.base_url, task_id),
            jwt,
        )
        .await
    }

    // -----------------------------------------------------------------------
    // Sessions
    // -----------------------------------------------------------------------

    pub async fn create_session(
        &self,
        project_agent_id: &str,
        jwt: &str,
        req: &CreateSessionRequest,
    ) -> Result<StorageSession, StorageError> {
        self.post_authed(
            &format!(
                "{}/api/project-agents/{}/sessions",
                self.base_url, project_agent_id
            ),
            jwt,
            req,
        )
        .await
    }

    pub async fn list_sessions(
        &self,
        project_agent_id: &str,
        jwt: &str,
    ) -> Result<Vec<StorageSession>, StorageError> {
        self.get_authed(
            &format!(
                "{}/api/project-agents/{}/sessions",
                self.base_url, project_agent_id
            ),
            jwt,
        )
        .await
    }

    pub async fn get_session(
        &self,
        session_id: &str,
        jwt: &str,
    ) -> Result<StorageSession, StorageError> {
        self.get_authed(
            &format!("{}/api/sessions/{}", self.base_url, session_id),
            jwt,
        )
        .await
    }

    pub async fn update_session(
        &self,
        session_id: &str,
        jwt: &str,
        req: &UpdateSessionRequest,
    ) -> Result<(), StorageError> {
        self.put_authed_no_response(
            &format!("{}/api/sessions/{}", self.base_url, session_id),
            jwt,
            req,
        )
        .await
    }

    // -----------------------------------------------------------------------
    // Messages
    // -----------------------------------------------------------------------

    pub async fn create_message(
        &self,
        session_id: &str,
        jwt: &str,
        req: &CreateMessageRequest,
    ) -> Result<StorageMessage, StorageError> {
        self.post_authed(
            &format!("{}/api/sessions/{}/messages", self.base_url, session_id),
            jwt,
            req,
        )
        .await
    }

    pub async fn list_messages(
        &self,
        session_id: &str,
        jwt: &str,
        limit: Option<u32>,
        offset: Option<u32>,
    ) -> Result<Vec<StorageMessage>, StorageError> {
        let mut url = format!("{}/api/sessions/{}/messages", self.base_url, session_id);
        let mut params = Vec::new();
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

    // -----------------------------------------------------------------------
    // Log Entries
    // -----------------------------------------------------------------------

    pub async fn create_log_entry(
        &self,
        project_id: &str,
        jwt: &str,
        req: &CreateLogEntryRequest,
    ) -> Result<(), StorageError> {
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

    // -----------------------------------------------------------------------
    // Internal HTTP helpers
    // -----------------------------------------------------------------------

    pub(crate) async fn get_authed<T: serde::de::DeserializeOwned>(
        &self,
        url: &str,
        jwt: &str,
    ) -> Result<T, StorageError> {
        let resp = self.http.get(url).bearer_auth(jwt).send().await?;
        self.handle_response(resp).await
    }

    pub(crate) async fn post_authed<T: serde::de::DeserializeOwned, B: serde::Serialize>(
        &self,
        url: &str,
        jwt: &str,
        body: &B,
    ) -> Result<T, StorageError> {
        let resp = self
            .http
            .post(url)
            .bearer_auth(jwt)
            .json(body)
            .send()
            .await?;
        self.handle_response(resp).await
    }

    pub(crate) async fn put_authed_no_response<B: serde::Serialize>(
        &self,
        url: &str,
        jwt: &str,
        body: &B,
    ) -> Result<(), StorageError> {
        let resp = self
            .http
            .put(url)
            .bearer_auth(jwt)
            .json(body)
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

    pub(crate) async fn delete_authed(&self, url: &str, jwt: &str) -> Result<(), StorageError> {
        let resp = self.http.delete(url).bearer_auth(jwt).send().await?;
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

    async fn handle_response<T: serde::de::DeserializeOwned>(
        &self,
        resp: reqwest::Response,
    ) -> Result<T, StorageError> {
        let url = resp.url().to_string();
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
        serde_json::from_str::<T>(&body).map_err(|e| {
            tracing::warn!(%url, error = %e, body_preview = &body[..body.len().min(500)], "Deserialization failed");
            StorageError::Deserialize(e.to_string())
        })
    }
}
