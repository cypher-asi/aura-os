mod error;
pub use error::SessionError;

use std::sync::Arc;

use chrono::Utc;

use aura_core::*;
use aura_store::RocksStore;
use aura_billing::MeteredLlm;

pub use aura_core::SESSION_SUMMARY_SYSTEM_PROMPT as SUMMARY_SYSTEM_PROMPT;

pub struct SessionService {
    store: Arc<RocksStore>,
    rollover_threshold: f64,
    model_context_window: u64,
}

impl SessionService {
    pub fn new(store: Arc<RocksStore>) -> Self {
        Self {
            store,
            rollover_threshold: 0.5,
            model_context_window: 200_000,
        }
    }

    #[cfg(test)]
    pub fn with_threshold(store: Arc<RocksStore>, threshold: f64) -> Self {
        Self {
            store,
            rollover_threshold: threshold,
            model_context_window: 200_000,
        }
    }

    pub fn create_session(
        &self,
        agent_instance_id: &AgentInstanceId,
        project_id: &ProjectId,
        active_task_id: Option<TaskId>,
        summary: String,
        user_id: Option<String>,
        model: Option<String>,
    ) -> Result<Session, SessionError> {
        let now = Utc::now();
        let session = Session {
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
        };
        self.store.put_session(&session)?;
        Ok(session)
    }

    pub fn update_context_usage(
        &self,
        project_id: &ProjectId,
        agent_instance_id: &AgentInstanceId,
        session_id: &SessionId,
        input_tokens: u64,
        output_tokens: u64,
    ) -> Result<Session, SessionError> {
        let mut session = self.get_session(project_id, agent_instance_id, session_id)?;
        let turn_usage =
            (input_tokens + output_tokens) as f64 / self.model_context_window as f64;
        session.context_usage_estimate =
            (session.context_usage_estimate + turn_usage).min(1.0);
        session.total_input_tokens += input_tokens;
        session.total_output_tokens += output_tokens;
        self.store.put_session(&session)?;
        Ok(session)
    }

    pub fn should_rollover(&self, session: &Session) -> bool {
        session.context_usage_estimate >= self.rollover_threshold
    }

    pub fn rollover_session(
        &self,
        project_id: &ProjectId,
        agent_instance_id: &AgentInstanceId,
        session_id: &SessionId,
        summary: String,
        next_task_id: Option<TaskId>,
    ) -> Result<Session, SessionError> {
        let mut old_session = self.get_session(project_id, agent_instance_id, session_id)?;
        let user_id = old_session.user_id.clone();
        let model = old_session.model.clone();
        old_session.status = SessionStatus::RolledOver;
        old_session.ended_at = Some(Utc::now());
        self.store.put_session(&old_session)?;

        self.create_session(agent_instance_id, project_id, next_task_id, summary, user_id, model)
    }

    pub fn end_session(
        &self,
        project_id: &ProjectId,
        agent_instance_id: &AgentInstanceId,
        session_id: &SessionId,
        status: SessionStatus,
    ) -> Result<Session, SessionError> {
        let mut session = self.get_session(project_id, agent_instance_id, session_id)?;
        session.status = status;
        session.ended_at = Some(Utc::now());
        self.store.put_session(&session)?;
        Ok(session)
    }

    pub fn get_session(
        &self,
        project_id: &ProjectId,
        agent_instance_id: &AgentInstanceId,
        session_id: &SessionId,
    ) -> Result<Session, SessionError> {
        self.store
            .get_session(project_id, agent_instance_id, session_id)
            .map_err(|e| match e {
                aura_store::StoreError::NotFound(_) => SessionError::NotFound,
                other => SessionError::Store(other),
            })
    }

    pub fn list_sessions(
        &self,
        project_id: &ProjectId,
        agent_instance_id: &AgentInstanceId,
    ) -> Result<Vec<Session>, SessionError> {
        Ok(self.store.list_sessions_by_agent(project_id, agent_instance_id)?)
    }

    pub fn record_task_worked(
        &self,
        project_id: &ProjectId,
        agent_instance_id: &AgentInstanceId,
        session_id: &SessionId,
        task_id: TaskId,
    ) -> Result<Session, SessionError> {
        let mut session = self.get_session(project_id, agent_instance_id, session_id)?;
        if !session.tasks_worked.contains(&task_id) {
            session.tasks_worked.push(task_id);
            self.store.put_session(&session)?;
        }
        Ok(session)
    }

    /// Mark any leftover `Active` sessions for this project as `Completed`.
    /// Called on engine startup to clean up sessions orphaned by crashes or
    /// restarts.
    pub fn close_stale_sessions(
        &self,
        project_id: &ProjectId,
    ) -> Result<Vec<Session>, SessionError> {
        let all = self.store.list_sessions_by_project(project_id)?;
        let mut closed = Vec::new();
        for mut session in all {
            if session.status == SessionStatus::Active {
                session.status = SessionStatus::Completed;
                session.ended_at = Some(Utc::now());
                self.store.put_session(&session)?;
                closed.push(session);
            }
        }
        Ok(closed)
    }

    pub fn session_count(
        &self,
        project_id: &ProjectId,
        agent_instance_id: &AgentInstanceId,
    ) -> Result<usize, SessionError> {
        Ok(self
            .store
            .list_sessions_by_agent(project_id, agent_instance_id)?
            .len())
    }

    pub async fn generate_rollover_summary(
        &self,
        llm: &MeteredLlm,
        api_key: &str,
        conversation_history: &str,
    ) -> Result<String, SessionError> {
        let resp = llm
            .complete(api_key, SUMMARY_SYSTEM_PROMPT, conversation_history, 2048, "aura_session_rollover", None)
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
    // SessionService basic operations
    // -----------------------------------------------------------------------

    #[test]
    fn should_rollover_at_threshold() {
        let tmp = tempfile::TempDir::new().unwrap();
        let store = Arc::new(aura_store::RocksStore::open(tmp.path()).unwrap());
        let svc = SessionService::with_threshold(store, 0.5);

        let below = Session {
            session_id: SessionId::new(),
            agent_instance_id: AgentInstanceId::new(),
            project_id: ProjectId::new(),
            active_task_id: None,
            tasks_worked: vec![],
            context_usage_estimate: 0.49,
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
            context_usage_estimate: 0.5,
            ..below.clone()
        };
        assert!(svc.should_rollover(&at));

        let above = Session {
            context_usage_estimate: 0.8,
            ..below
        };
        assert!(svc.should_rollover(&above));
    }

    #[test]
    fn create_and_get_session() {
        let tmp = tempfile::TempDir::new().unwrap();
        let store = Arc::new(aura_store::RocksStore::open(tmp.path()).unwrap());
        let svc = SessionService::new(store);

        let pid = ProjectId::new();
        let aid = AgentInstanceId::new();
        let session = svc
            .create_session(&aid, &pid, None, "initial context".into(), None, None)
            .unwrap();

        assert_eq!(session.status, SessionStatus::Active);
        assert_eq!(session.summary_of_previous_context, "initial context");

        let fetched = svc
            .get_session(&pid, &aid, &session.session_id)
            .unwrap();
        assert_eq!(fetched.session_id, session.session_id);
    }

    #[test]
    fn rollover_session_ends_old_creates_new() {
        let tmp = tempfile::TempDir::new().unwrap();
        let store = Arc::new(aura_store::RocksStore::open(tmp.path()).unwrap());
        let svc = SessionService::new(store);

        let pid = ProjectId::new();
        let aid = AgentInstanceId::new();
        let old = svc
            .create_session(&aid, &pid, None, String::new(), None, None)
            .unwrap();

        let new_session = svc
            .rollover_session(&pid, &aid, &old.session_id, "summary".into(), None)
            .unwrap();

        let old_fetched = svc.get_session(&pid, &aid, &old.session_id).unwrap();
        assert_eq!(old_fetched.status, SessionStatus::RolledOver);
        assert!(old_fetched.ended_at.is_some());

        assert_eq!(new_session.status, SessionStatus::Active);
        assert_eq!(new_session.summary_of_previous_context, "summary");
        assert_ne!(new_session.session_id, old.session_id);
    }

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
        let svc = SessionService::new(store);

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
