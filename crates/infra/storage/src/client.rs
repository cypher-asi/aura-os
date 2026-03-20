use std::env;

use reqwest::Client;
use tracing::info;

use crate::error::StorageError;
use crate::types::*;

/// Validate that a string ID is safe to interpolate into a URL path.
/// Accepts UUID format (hex digits and hyphens) to prevent path traversal or injection.
fn validate_url_id(id: &str, label: &str) -> Result<(), StorageError> {
    if id.is_empty() {
        return Err(StorageError::Validation(format!("{label} is empty")));
    }
    let valid = id.len() <= 64
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-');
    if !valid {
        return Err(StorageError::Validation(format!(
            "{label} contains invalid characters: {id}"
        )));
    }
    Ok(())
}

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
            http: Self::build_http_client(),
            base_url,
        })
    }

    /// Create a client with an explicit base URL (e.g. for tests or custom deployment).
    pub fn with_base_url(base_url: &str) -> Self {
        Self {
            http: Self::build_http_client(),
            base_url: base_url.trim_end_matches('/').to_string(),
        }
    }

    fn build_http_client() -> Client {
        Client::builder()
            .connect_timeout(std::time::Duration::from_secs(10))
            .timeout(std::time::Duration::from_secs(30))
            .build()
            .unwrap_or_else(|_| Client::new())
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

    // -----------------------------------------------------------------------
    // Specs
    // -----------------------------------------------------------------------

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

    pub async fn get_spec(
        &self,
        spec_id: &str,
        jwt: &str,
    ) -> Result<StorageSpec, StorageError> {
        validate_url_id(spec_id, "spec_id")?;
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
        validate_url_id(spec_id, "spec_id")?;
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
        validate_url_id(spec_id, "spec_id")?;
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

    pub async fn get_task(
        &self,
        task_id: &str,
        jwt: &str,
    ) -> Result<StorageTask, StorageError> {
        validate_url_id(task_id, "task_id")?;
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
        // Forward the full typed payload so any optional execution fields
        // (execution_notes/files_changed/model/token totals) are persisted
        // whenever callers provide them.
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

    pub async fn delete_task(
        &self,
        task_id: &str,
        jwt: &str,
    ) -> Result<(), StorageError> {
        validate_url_id(task_id, "task_id")?;
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
        validate_url_id(project_agent_id, "project_agent_id")?;
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
        validate_url_id(project_agent_id, "project_agent_id")?;
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
        validate_url_id(session_id, "session_id")?;
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
        validate_url_id(session_id, "session_id")?;
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
        validate_url_id(session_id, "session_id")?;
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
        validate_url_id(session_id, "session_id")?;
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
