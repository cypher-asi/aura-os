mod error;
pub use error::SessionError;

use std::sync::Arc;

use chrono::{DateTime, Utc};
use tracing::warn;

use aura_core::*;
use aura_store::RocksStore;
use aura_storage::StorageClient;
use aura_billing::MeteredLlm;

pub use aura_core::SESSION_SUMMARY_SYSTEM_PROMPT as SUMMARY_SYSTEM_PROMPT;

pub struct SessionService {
    store: Arc<RocksStore>,
    storage_client: Option<Arc<StorageClient>>,
    rollover_threshold: f64,
    model_context_window: u64,
}

fn parse_dt(v: &Option<String>) -> DateTime<Utc> {
    v.as_deref()
        .and_then(|s| DateTime::parse_from_rfc3339(s).ok())
        .map(|dt| dt.with_timezone(&Utc))
        .unwrap_or_else(Utc::now)
}

fn parse_session_status(s: &str) -> SessionStatus {
    serde_json::from_str(&format!("\"{s}\"")).unwrap_or(SessionStatus::Active)
}

fn storage_session_to_session(
    s: aura_storage::StorageSession,
    local_overrides: Option<&Session>,
) -> Result<Session, String> {
    Ok(Session {
        session_id: s.id.parse().map_err(|e| format!("invalid session id: {e}"))?,
        agent_instance_id: s
            .project_agent_id
            .as_deref()
            .unwrap_or("")
            .parse()
            .map_err(|e| format!("invalid project_agent_id: {e}"))?,
        project_id: s
            .project_id
            .as_deref()
            .unwrap_or("")
            .parse()
            .map_err(|e| format!("invalid project_id: {e}"))?,
        active_task_id: local_overrides.and_then(|o| o.active_task_id),
        tasks_worked: local_overrides
            .map(|o| o.tasks_worked.clone())
            .unwrap_or_default(),
        context_usage_estimate: s.context_usage_estimate.unwrap_or(0.0),
        total_input_tokens: local_overrides.map(|o| o.total_input_tokens).unwrap_or(0),
        total_output_tokens: local_overrides.map(|o| o.total_output_tokens).unwrap_or(0),
        summary_of_previous_context: s.summary_of_previous_context.unwrap_or_default(),
        status: parse_session_status(s.status.as_deref().unwrap_or("active")),
        user_id: local_overrides.and_then(|o| o.user_id.clone()),
        model: local_overrides.and_then(|o| o.model.clone()),
        started_at: parse_dt(&s.created_at),
        ended_at: s
            .ended_at
            .as_deref()
            .and_then(|v| DateTime::parse_from_rfc3339(v).ok())
            .map(|dt| dt.with_timezone(&Utc)),
    })
}

impl SessionService {
    pub fn new(store: Arc<RocksStore>, rollover_threshold: f64, model_context_window: u64) -> Self {
        Self {
            store,
            storage_client: None,
            rollover_threshold,
            model_context_window,
        }
    }

    pub fn with_storage_client(mut self, client: Option<Arc<StorageClient>>) -> Self {
        self.storage_client = client;
        self
    }

    fn get_jwt(&self) -> Result<String, SessionError> {
        let bytes = self
            .store
            .get_setting("zero_auth_session")
            .map_err(|_| SessionError::Parse("no active session for JWT".into()))?;
        let session: ZeroAuthSession = serde_json::from_slice(&bytes)
            .map_err(|e| SessionError::Parse(format!("invalid session JSON: {e}")))?;
        Ok(session.access_token)
    }

    pub async fn create_session(
        &self,
        agent_instance_id: &AgentInstanceId,
        project_id: &ProjectId,
        active_task_id: Option<TaskId>,
        summary: String,
        user_id: Option<String>,
        model: Option<String>,
    ) -> Result<Session, SessionError> {
        if let Some(ref storage) = self.storage_client {
            let jwt = self.get_jwt()?;
            let req = aura_storage::CreateSessionRequest {
                project_id: project_id.to_string(),
                status: Some("active".to_string()),
                context_usage_estimate: Some(0.0),
                summary_of_previous_context: if summary.is_empty() {
                    None
                } else {
                    Some(summary.clone())
                },
            };
            let ss = storage
                .create_session(&agent_instance_id.to_string(), &jwt, &req)
                .await?;
            let mut session = storage_session_to_session(ss, None)
                .map_err(|e| SessionError::Parse(e))?;
            session.active_task_id = active_task_id;
            session.user_id = user_id;
            session.model = model;
            session.summary_of_previous_context = summary;
            return Ok(session);
        }

        let now = Utc::now();
        Ok(Session {
            session_id: SessionId::new(),
            agent_instance_id: *agent_instance_id,
            project_id: *project_id,
            active_task_id,
            tasks_worked: Vec::new(),
            context_usage_estimate: 0.0,
            total_input_tokens: 0,
            total_output_tokens: 0,
            summary_of_previous_context: summary,
            status: SessionStatus::Active,
            user_id,
            model,
            started_at: now,
            ended_at: None,
        })
    }

    pub async fn update_context_usage(
        &self,
        project_id: &ProjectId,
        agent_instance_id: &AgentInstanceId,
        session_id: &SessionId,
        input_tokens: u64,
        output_tokens: u64,
    ) -> Result<Session, SessionError> {
        let mut session = self
            .get_session(project_id, agent_instance_id, session_id)
            .await?;
        let turn_usage =
            (input_tokens + output_tokens) as f64 / self.model_context_window as f64;
        session.context_usage_estimate =
            (session.context_usage_estimate + turn_usage).min(1.0);
        session.total_input_tokens += input_tokens;
        session.total_output_tokens += output_tokens;

        if let Some(ref storage) = self.storage_client {
            let jwt = self.get_jwt()?;
            let req = aura_storage::UpdateSessionRequest {
                status: None,
                context_usage_estimate: Some(session.context_usage_estimate),
                ended_at: None,
            };
            storage
                .update_session(&session_id.to_string(), &jwt, &req)
                .await?;
        }
        Ok(session)
    }

    pub fn should_rollover(&self, session: &Session) -> bool {
        session.context_usage_estimate >= self.rollover_threshold
    }

    pub async fn rollover_session(
        &self,
        project_id: &ProjectId,
        agent_instance_id: &AgentInstanceId,
        session_id: &SessionId,
        summary: String,
        next_task_id: Option<TaskId>,
    ) -> Result<Session, SessionError> {
        let old_session = self
            .get_session(project_id, agent_instance_id, session_id)
            .await?;
        let user_id = old_session.user_id.clone();
        let model = old_session.model.clone();

        if let Some(ref storage) = self.storage_client {
            let jwt = self.get_jwt()?;
            let req = aura_storage::UpdateSessionRequest {
                status: Some("rolled_over".to_string()),
                context_usage_estimate: None,
                ended_at: Some(Utc::now().to_rfc3339()),
            };
            storage
                .update_session(&session_id.to_string(), &jwt, &req)
                .await?;
        }

        self.create_session(
            agent_instance_id,
            project_id,
            next_task_id,
            summary,
            user_id,
            model,
        )
        .await
    }

    pub async fn end_session(
        &self,
        project_id: &ProjectId,
        agent_instance_id: &AgentInstanceId,
        session_id: &SessionId,
        status: SessionStatus,
    ) -> Result<Session, SessionError> {
        let mut session = self
            .get_session(project_id, agent_instance_id, session_id)
            .await?;
        session.status = status;
        session.ended_at = Some(Utc::now());

        if let Some(ref storage) = self.storage_client {
            let jwt = self.get_jwt()?;
            let status_str =
                serde_json::to_value(status).unwrap().as_str().unwrap_or("completed").to_string();
            let req = aura_storage::UpdateSessionRequest {
                status: Some(status_str),
                context_usage_estimate: None,
                ended_at: Some(session.ended_at.unwrap().to_rfc3339()),
            };
            storage
                .update_session(&session_id.to_string(), &jwt, &req)
                .await?;
        }
        Ok(session)
    }

    pub async fn get_session(
        &self,
        _project_id: &ProjectId,
        _agent_instance_id: &AgentInstanceId,
        session_id: &SessionId,
    ) -> Result<Session, SessionError> {
        if let Some(ref storage) = self.storage_client {
            let jwt = self.get_jwt()?;
            match storage.get_session(&session_id.to_string(), &jwt).await {
                Ok(ss) => {
                    return storage_session_to_session(ss, None)
                        .map_err(|e| SessionError::Parse(e));
                }
                Err(aura_storage::StorageError::Server { status: 404, .. }) => {
                    return Err(SessionError::NotFound);
                }
                Err(e) => return Err(SessionError::Storage(e)),
            }
        }
        Err(SessionError::NotFound)
    }

    pub async fn list_sessions(
        &self,
        _project_id: &ProjectId,
        agent_instance_id: &AgentInstanceId,
    ) -> Result<Vec<Session>, SessionError> {
        if let Some(ref storage) = self.storage_client {
            let jwt = self.get_jwt()?;
            let storage_sessions = storage
                .list_sessions(&agent_instance_id.to_string(), &jwt)
                .await?;
            return Ok(storage_sessions
                .into_iter()
                .filter_map(|s| storage_session_to_session(s, None).ok())
                .collect());
        }
        Ok(Vec::new())
    }

    pub async fn record_task_worked(
        &self,
        project_id: &ProjectId,
        _agent_instance_id: &AgentInstanceId,
        _session_id: &SessionId,
        task_id: TaskId,
    ) -> Result<Session, SessionError> {
        let mut session = Session::dummy(*project_id);
        session.tasks_worked.push(task_id);
        Ok(session)
    }

    pub async fn close_stale_sessions(
        &self,
        project_id: &ProjectId,
    ) -> Result<Vec<Session>, SessionError> {
        let Some(ref storage) = self.storage_client else {
            return Ok(Vec::new());
        };
        let jwt = self.get_jwt()?;
        let agents = storage
            .list_project_agents(&project_id.to_string(), &jwt)
            .await?;
        let mut closed = Vec::new();
        for agent in &agents {
            let sessions = storage.list_sessions(&agent.id, &jwt).await?;
            for ss in sessions {
                if ss.status.as_deref() == Some("active") {
                    let req = aura_storage::UpdateSessionRequest {
                        status: Some("completed".to_string()),
                        context_usage_estimate: None,
                        ended_at: Some(Utc::now().to_rfc3339()),
                    };
                    if let Err(e) =
                        storage.update_session(&ss.id, &jwt, &req).await
                    {
                        warn!(session_id = %ss.id, error = %e, "failed to close stale session");
                        continue;
                    }
                    if let Ok(s) = storage_session_to_session(ss, None) {
                        closed.push(s);
                    }
                }
            }
        }
        Ok(closed)
    }

    pub async fn session_count(
        &self,
        project_id: &ProjectId,
        agent_instance_id: &AgentInstanceId,
    ) -> Result<usize, SessionError> {
        Ok(self.list_sessions(project_id, agent_instance_id).await?.len())
    }

    pub async fn generate_rollover_summary(
        &self,
        llm: &MeteredLlm,
        api_key: &str,
        conversation_history: &str,
    ) -> Result<String, SessionError> {
        let resp = llm
            .complete_with_model(
                aura_claude::FAST_MODEL,
                api_key,
                SUMMARY_SYSTEM_PROMPT,
                conversation_history,
                2048,
                "aura_session_rollover",
                None,
            )
            .await?;
        Ok(resp.text)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;
    use aura_claude::mock::{MockLlmProvider, MockResponse};
    use aura_billing::BillingClient;

    static ENV_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

    async fn start_mock_billing_server() -> String {
        use axum::{routing::{get, post}, Json, Router};
        use tokio::net::TcpListener;

        let app = Router::new()
            .route(
                "/api/credits/balance",
                get(|| async {
                    Json(serde_json::json!({"balance": 999999, "purchases": []}))
                }),
            )
            .route(
                "/api/credits/debit",
                post(|| async {
                    Json(serde_json::json!({
                        "success": true,
                        "balance": 999998,
                        "transactionId": "tx-1"
                    }))
                }),
            );

        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!("http://{}", listener.local_addr().unwrap());
        tokio::spawn(async move { axum::serve(listener, app).await.ok() });
        url
    }

    async fn make_test_llm(
        mock: Arc<MockLlmProvider>,
    ) -> (MeteredLlm, tempfile::TempDir) {
        let url = start_mock_billing_server().await;
        let billing = {
            let _guard = ENV_LOCK.lock().unwrap();
            std::env::set_var("BILLING_SERVER_URL", &url);
            Arc::new(BillingClient::new())
        };

        let tmp = tempfile::TempDir::new().unwrap();
        let store = Arc::new(aura_store::RocksStore::open(tmp.path()).unwrap());

        let session = serde_json::to_vec(&aura_core::ZeroAuthSession {
            user_id: "u1".into(),
            network_user_id: None,
            profile_id: None,
            display_name: "Test".into(),
            profile_image: String::new(),
            primary_zid: "zid-1".into(),
            zero_wallet: "w1".into(),
            wallets: vec![],
            access_token: "test-token".into(),
            created_at: chrono::Utc::now(),
            validated_at: chrono::Utc::now(),
        })
        .unwrap();
        store.put_setting("zero_auth_session", &session).unwrap();

        let llm = MeteredLlm::new(mock, billing, store);
        (llm, tmp)
    }

    // -----------------------------------------------------------------------
    // SessionService pure-logic tests (no StorageClient or local persistence)
    // -----------------------------------------------------------------------

    #[tokio::test]
    async fn should_rollover_at_threshold() {
        let tmp = tempfile::TempDir::new().unwrap();
        let store = Arc::new(aura_store::RocksStore::open(tmp.path()).unwrap());
        let svc = SessionService::new(store, 0.8, 150_000);

        let below = Session {
            session_id: SessionId::new(),
            agent_instance_id: AgentInstanceId::new(),
            project_id: ProjectId::new(),
            active_task_id: None,
            tasks_worked: vec![],
            context_usage_estimate: 0.79,
            total_input_tokens: 0,
            total_output_tokens: 0,
            summary_of_previous_context: String::new(),
            status: SessionStatus::Active,
            user_id: None,
            model: None,
            started_at: Utc::now(),
            ended_at: None,
        };
        assert!(!svc.should_rollover(&below));

        let at = Session {
            context_usage_estimate: 0.8,
            ..below.clone()
        };
        assert!(svc.should_rollover(&at));

        let above = Session {
            context_usage_estimate: 0.95,
            ..below
        };
        assert!(svc.should_rollover(&above));
    }

    #[tokio::test]
    async fn create_session_returns_active_session() {
        let tmp = tempfile::TempDir::new().unwrap();
        let store = Arc::new(aura_store::RocksStore::open(tmp.path()).unwrap());
        let svc = SessionService::new(store, 0.8, 150_000);

        let pid = ProjectId::new();
        let aid = AgentInstanceId::new();
        let session = svc
            .create_session(&aid, &pid, None, "initial context".into(), None, None)
            .await
            .unwrap();

        assert_eq!(session.status, SessionStatus::Active);
        assert_eq!(session.summary_of_previous_context, "initial context");
        assert_eq!(session.project_id, pid);
        assert_eq!(session.agent_instance_id, aid);
        assert_eq!(session.context_usage_estimate, 0.0);
    }

    // Full session CRUD + rollover tests require a running aura-storage instance.
    // Local store session methods are now stubs. End-to-end session lifecycle
    // is tested via the test script (scripts/test-aura-storage.mjs).

    // -----------------------------------------------------------------------
    // generate_rollover_summary with MockLlmProvider
    // -----------------------------------------------------------------------

    #[tokio::test]
    async fn generate_summary_returns_llm_text() {
        let mock = Arc::new(MockLlmProvider::with_responses(vec![
            MockResponse::text("The user discussed authentication and database setup.")
                .with_tokens(200, 100),
        ]));

        let (llm, _tmp_llm) = make_test_llm(mock.clone()).await;

        let tmp = tempfile::TempDir::new().unwrap();
        let store = Arc::new(aura_store::RocksStore::open(tmp.path()).unwrap());
        let svc = SessionService::new(store, 0.8, 150_000);

        let summary = svc
            .generate_rollover_summary(
                &llm,
                "test-key",
                "User: How do I set up auth?\nAssistant: Use JWT tokens.",
            )
            .await
            .unwrap();

        assert_eq!(summary, "The user discussed authentication and database setup.");
        assert_eq!(mock.call_count(), 1);

        let calls = mock.recorded_calls().await;
        assert_eq!(calls[0].system_prompt, SUMMARY_SYSTEM_PROMPT);
    }
}
