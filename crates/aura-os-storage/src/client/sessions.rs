use crate::error::StorageError;
use crate::types::*;

use super::{validate_share_token, validate_url_id, StorageClient};

impl StorageClient {
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

    pub async fn list_sessions_including_empty(
        &self,
        project_agent_id: &str,
        jwt: &str,
    ) -> Result<Vec<StorageSession>, StorageError> {
        validate_url_id(project_agent_id, "project_agent_id")?;
        self.get_authed(
            &format!(
                "{}/api/project-agents/{}/sessions?include_empty=true",
                self.base_url, project_agent_id
            ),
            jwt,
        )
        .await
    }

    /// Project-scoped session list. Backed by the indexed
    /// `idx_sessions_project_recent` partial index in aura-storage
    /// (migration 0014). Replaces aura-os-server's old per-agent
    /// fan-out: it used to call `list_project_agents` and then
    /// `list_sessions(agent)` once per project-agent in a sequential
    /// loop, then drop empty rows via N `list_events?limit=1` probes —
    /// now it's a single indexed `WHERE project_id = $1 AND event_count > 0`.
    pub async fn list_project_sessions(
        &self,
        project_id: &str,
        jwt: &str,
    ) -> Result<Vec<StorageSession>, StorageError> {
        validate_url_id(project_id, "project_id")?;
        self.get_authed(
            &format!("{}/api/projects/{}/sessions", self.base_url, project_id),
            jwt,
        )
        .await
    }

    /// User-scoped cross-agent session list. Backed by the indexed
    /// `idx_sessions_user_recent` partial index in aura-storage
    /// (migration 0015). Powers the chat-app left panel which used
    /// to fan out one `list_sessions(agent)` call per (agent,
    /// project_binding) pair on first paint -- collapsing
    /// `A x (1 + B)` HTTP calls (A agents, B avg bindings) into 1.
    ///
    /// In production aura-storage derives the user_id from the JWT.
    /// Tests run against the in-memory mock which has no auth, so
    /// we honour `AURA_STORAGE_TEST_USER_ID`: when set, the value
    /// is appended as a `?user=<id>` query param and the mock
    /// scopes its response to that user. Production has no such env
    /// var set, so the param is omitted and aura-storage's JWT
    /// extractor is the sole authority on which user_id we list.
    pub async fn list_my_sessions(
        &self,
        jwt: &str,
    ) -> Result<Vec<StorageEnrichedSession>, StorageError> {
        // user_id round-trips as a UUID (hex digits + dashes) so URL
        // encoding is a no-op. Validate it to block any chance of an
        // env var smuggling reserved query characters into the URL.
        let url = match std::env::var("AURA_STORAGE_TEST_USER_ID") {
            Ok(uid) if !uid.is_empty() => {
                validate_url_id(&uid, "AURA_STORAGE_TEST_USER_ID")?;
                format!("{}/api/me/sessions?user={}", self.base_url, uid)
            }
            _ => format!("{}/api/me/sessions", self.base_url),
        };
        self.get_authed(&url, jwt).await
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

    /// Fetch a session by its public share token using the server's
    /// internal (`X-Internal-Token`) credential rather than a caller
    /// JWT. Backs the unauthenticated public-share read path: the
    /// viewer has no JWT, so aura-os-server resolves the shared session
    /// with its own internal token.
    ///
    /// `public_share_id` is a capability token and is validated to the
    /// `t_<32 hex>` shape via [`validate_share_token`] before being
    /// interpolated into the URL. Returns the raw [`StorageSession`];
    /// the caller is responsible for gating on `is_public` before
    /// serving any content.
    pub async fn get_session_by_share_internal(
        &self,
        public_share_id: &str,
    ) -> Result<StorageSession, StorageError> {
        validate_share_token(public_share_id, "public_share_id")?;
        self.get_internal(&format!(
            "{}/internal/sessions/by-share/{}",
            self.base_url, public_share_id
        ))
        .await
    }

    pub async fn delete_session(&self, session_id: &str, jwt: &str) -> Result<(), StorageError> {
        validate_url_id(session_id, "session_id")?;
        self.delete_authed(
            &format!("{}/api/sessions/{}", self.base_url, session_id),
            jwt,
        )
        .await
    }
}
