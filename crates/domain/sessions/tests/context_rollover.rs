use std::sync::Arc;

use axum::{
    extract::{Path, State},
    routing::{get, post},
    Json, Router,
};
use chrono::Utc;
use tokio::net::TcpListener;
use tokio::sync::Mutex;

use aura_claude::mock::{MockLlmProvider, MockResponse};
use aura_core::*;
use aura_sessions::SessionService;
use aura_storage::{
    CreateSessionRequest, StorageClient, StorageSession, UpdateSessionRequest,
};

// ---------------------------------------------------------------------------
// Mock aura-storage HTTP server
// ---------------------------------------------------------------------------

type SessionDb = Arc<Mutex<Vec<StorageSession>>>;

async fn create_session_handler(
    Path(project_agent_id): Path<String>,
    State(db): State<SessionDb>,
    Json(req): Json<CreateSessionRequest>,
) -> Json<StorageSession> {
    let session = StorageSession {
        id: SessionId::new().to_string(),
        project_agent_id: Some(project_agent_id),
        project_id: Some(req.project_id),
        status: req.status.or(Some("active".to_string())),
        context_usage_estimate: req.context_usage_estimate,
        summary_of_previous_context: req.summary_of_previous_context,
        ended_at: None,
        created_at: Some(Utc::now().to_rfc3339()),
        updated_at: Some(Utc::now().to_rfc3339()),
    };
    let mut db = db.lock().await;
    db.push(session.clone());
    Json(session)
}

async fn get_session_handler(
    Path(session_id): Path<String>,
    State(db): State<SessionDb>,
) -> Result<Json<StorageSession>, axum::http::StatusCode> {
    let db = db.lock().await;
    db.iter()
        .find(|s| s.id == session_id)
        .cloned()
        .map(Json)
        .ok_or(axum::http::StatusCode::NOT_FOUND)
}

async fn update_session_handler(
    Path(session_id): Path<String>,
    State(db): State<SessionDb>,
    Json(req): Json<UpdateSessionRequest>,
) -> axum::http::StatusCode {
    let mut db = db.lock().await;
    if let Some(session) = db.iter_mut().find(|s| s.id == session_id) {
        if let Some(status) = req.status {
            session.status = Some(status);
        }
        if let Some(usage) = req.context_usage_estimate {
            session.context_usage_estimate = Some(usage);
        }
        if let Some(ended) = req.ended_at {
            session.ended_at = Some(ended);
        }
        session.updated_at = Some(Utc::now().to_rfc3339());
        axum::http::StatusCode::OK
    } else {
        axum::http::StatusCode::NOT_FOUND
    }
}

async fn list_sessions_handler(
    Path(_project_agent_id): Path<String>,
    State(db): State<SessionDb>,
) -> Json<Vec<StorageSession>> {
    let db = db.lock().await;
    Json(db.clone())
}

/// Spin up a mock aura-storage and return (base_url, session_db).
async fn start_mock_storage() -> (String, SessionDb) {
    let db: SessionDb = Arc::new(Mutex::new(Vec::new()));

    let app = Router::new()
        .route(
            "/api/project-agents/:project_agent_id/sessions",
            post(create_session_handler).get(list_sessions_handler),
        )
        .route(
            "/api/sessions/:session_id",
            get(get_session_handler).put(update_session_handler),
        )
        .with_state(db.clone());

    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://{}", listener.local_addr().unwrap());
    tokio::spawn(async move { axum::serve(listener, app).await.ok() });
    (url, db)
}

/// Create a SessionService wired to the mock storage and a fresh RocksDB.
fn make_session_service(
    store: &Arc<aura_store::RocksStore>,
    storage_url: &str,
    rollover_threshold: f64,
) -> SessionService {
    let storage = Arc::new(StorageClient::with_base_url(storage_url));
    SessionService::new(store.clone(), rollover_threshold, 200_000)
        .with_storage_client(Some(storage))
}

fn store_test_jwt(store: &aura_store::RocksStore) {
    let session = serde_json::to_vec(&ZeroAuthSession {
        user_id: "u1".into(),
        network_user_id: None,
        profile_id: None,
        display_name: "Test".into(),
        profile_image: String::new(),
        primary_zid: "zid-1".into(),
        zero_wallet: "w1".into(),
        wallets: vec![],
        access_token: "test-jwt".into(),
        created_at: Utc::now(),
        validated_at: Utc::now(),
    })
    .unwrap();
    store.put_setting("zero_auth_session", &session).unwrap();
}

// ---------------------------------------------------------------------------
// Mock billing server (needed for MeteredLlm)
// ---------------------------------------------------------------------------

static ENV_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

async fn start_mock_billing() -> String {
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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[tokio::test]
async fn should_rollover_respects_threshold() {
    let tmp = tempfile::TempDir::new().unwrap();
    let store = Arc::new(aura_store::RocksStore::open(tmp.path()).unwrap());
    let svc = SessionService::new(store, 0.5, 200_000);

    let base = Session::dummy(ProjectId::new());

    let below = Session {
        context_usage_estimate: 0.49,
        ..base.clone()
    };
    assert!(!svc.should_rollover(&below), "below threshold should not trigger");

    let at = Session {
        context_usage_estimate: 0.5,
        ..base.clone()
    };
    assert!(svc.should_rollover(&at), "at threshold should trigger");

    let above = Session {
        context_usage_estimate: 0.9,
        ..base.clone()
    };
    assert!(svc.should_rollover(&above), "above threshold should trigger");
}

#[tokio::test]
async fn should_rollover_triggers_on_max_tasks() {
    let tmp = tempfile::TempDir::new().unwrap();
    let store = Arc::new(aura_store::RocksStore::open(tmp.path()).unwrap());
    let svc = SessionService::new(store, 0.99, 200_000);

    let base = Session::dummy(ProjectId::new());

    let seven_tasks = Session {
        tasks_worked: (0..7).map(|_| TaskId::new()).collect(),
        context_usage_estimate: 0.1,
        ..base.clone()
    };
    assert!(!svc.should_rollover(&seven_tasks), "7 tasks should not trigger");

    let eight_tasks = Session {
        tasks_worked: (0..8).map(|_| TaskId::new()).collect(),
        context_usage_estimate: 0.1,
        ..base
    };
    assert!(svc.should_rollover(&eight_tasks), "8 tasks should trigger");
}

#[tokio::test]
async fn rollover_session_marks_old_and_creates_new() {
    let (storage_url, db) = start_mock_storage().await;
    let tmp = tempfile::TempDir::new().unwrap();
    let store = Arc::new(aura_store::RocksStore::open(tmp.path()).unwrap());
    store_test_jwt(&store);

    let svc = make_session_service(&store, &storage_url, 0.5);

    let pid = ProjectId::new();
    let aid = AgentInstanceId::new();

    let original = svc
        .create_session(&aid, &pid, None, String::new(), None, None)
        .await
        .expect("create_session should succeed");

    assert_eq!(original.status, SessionStatus::Active);
    assert_eq!(original.context_usage_estimate, 0.0);

    let new_session = svc
        .rollover_session(
            &pid,
            &aid,
            &original.session_id,
            "Summary of previous work".into(),
            None,
        )
        .await
        .expect("rollover_session should succeed");

    assert_ne!(new_session.session_id, original.session_id);
    assert_eq!(new_session.status, SessionStatus::Active);
    assert_eq!(
        new_session.summary_of_previous_context,
        "Summary of previous work"
    );
    assert_eq!(new_session.context_usage_estimate, 0.0);

    let sessions = db.lock().await;
    let old = sessions
        .iter()
        .find(|s| s.id == original.session_id.to_string())
        .expect("old session should exist in storage");
    assert_eq!(old.status.as_deref(), Some("rolled_over"));
    assert!(old.ended_at.is_some(), "old session should have ended_at set");
}

#[tokio::test]
async fn rollover_chain_creates_linked_sessions() {
    let (storage_url, db) = start_mock_storage().await;
    let tmp = tempfile::TempDir::new().unwrap();
    let store = Arc::new(aura_store::RocksStore::open(tmp.path()).unwrap());
    store_test_jwt(&store);

    let svc = make_session_service(&store, &storage_url, 0.3);

    let pid = ProjectId::new();
    let aid = AgentInstanceId::new();

    let s1 = svc
        .create_session(&aid, &pid, None, String::new(), None, None)
        .await
        .unwrap();

    let s2 = svc
        .rollover_session(&pid, &aid, &s1.session_id, "work from s1".into(), None)
        .await
        .unwrap();

    let s3 = svc
        .rollover_session(&pid, &aid, &s2.session_id, "work from s1 + s2".into(), None)
        .await
        .unwrap();

    assert_eq!(s3.summary_of_previous_context, "work from s1 + s2");

    let sessions = db.lock().await;
    assert_eq!(sessions.len(), 3, "should have 3 sessions total");

    let rolled = sessions
        .iter()
        .filter(|s| s.status.as_deref() == Some("rolled_over"))
        .count();
    assert_eq!(rolled, 2, "first two sessions should be rolled_over");

    let active = sessions
        .iter()
        .filter(|s| s.status.as_deref() == Some("active"))
        .count();
    assert_eq!(active, 1, "only the latest session should be active");
}

#[tokio::test]
async fn update_context_usage_accumulates() {
    let (storage_url, _db) = start_mock_storage().await;
    let tmp = tempfile::TempDir::new().unwrap();
    let store = Arc::new(aura_store::RocksStore::open(tmp.path()).unwrap());
    store_test_jwt(&store);

    let svc = make_session_service(&store, &storage_url, 0.8);

    let pid = ProjectId::new();
    let aid = AgentInstanceId::new();

    let session = svc
        .create_session(&aid, &pid, None, String::new(), None, None)
        .await
        .unwrap();

    // 40k tokens out of 200k context window = 0.2 usage
    let updated = svc
        .update_context_usage(&pid, &aid, &session.session_id, 20_000, 20_000)
        .await
        .unwrap();

    let expected = 40_000.0 / 200_000.0; // 0.2
    assert!(
        (updated.context_usage_estimate - expected).abs() < 0.001,
        "usage should be ~0.2, got {}",
        updated.context_usage_estimate
    );

    // Another 80k tokens → total 120k/200k = 0.6
    let updated2 = svc
        .update_context_usage(&pid, &aid, &session.session_id, 40_000, 40_000)
        .await
        .unwrap();

    let expected2 = expected + 80_000.0 / 200_000.0; // 0.6
    assert!(
        (updated2.context_usage_estimate - expected2).abs() < 0.001,
        "usage should be ~0.6, got {}",
        updated2.context_usage_estimate
    );
}

#[tokio::test]
async fn context_usage_caps_at_one() {
    let (storage_url, _db) = start_mock_storage().await;
    let tmp = tempfile::TempDir::new().unwrap();
    let store = Arc::new(aura_store::RocksStore::open(tmp.path()).unwrap());
    store_test_jwt(&store);

    let svc = make_session_service(&store, &storage_url, 0.8);

    let pid = ProjectId::new();
    let aid = AgentInstanceId::new();

    let session = svc
        .create_session(&aid, &pid, None, String::new(), None, None)
        .await
        .unwrap();

    // 500k tokens on a 200k window → usage would be 2.5, should cap at 1.0
    let updated = svc
        .update_context_usage(&pid, &aid, &session.session_id, 250_000, 250_000)
        .await
        .unwrap();

    assert_eq!(
        updated.context_usage_estimate, 1.0,
        "usage should cap at 1.0"
    );
}

#[tokio::test]
async fn end_to_end_usage_triggers_rollover() {
    let (storage_url, db) = start_mock_storage().await;
    let tmp = tempfile::TempDir::new().unwrap();
    let store = Arc::new(aura_store::RocksStore::open(tmp.path()).unwrap());
    store_test_jwt(&store);

    let threshold = 0.5;
    let svc = make_session_service(&store, &storage_url, threshold);

    let pid = ProjectId::new();
    let aid = AgentInstanceId::new();

    let session = svc
        .create_session(&aid, &pid, None, String::new(), None, None)
        .await
        .unwrap();

    // Push usage to 0.3 → below threshold
    svc.update_context_usage(&pid, &aid, &session.session_id, 30_000, 30_000)
        .await
        .unwrap();

    let current = svc.get_session(&pid, &aid, &session.session_id).await.unwrap();
    assert!(
        !svc.should_rollover(&current),
        "0.3 usage should not trigger rollover at 0.5 threshold"
    );

    // Push usage to 0.6 → above threshold
    svc.update_context_usage(&pid, &aid, &session.session_id, 30_000, 30_000)
        .await
        .unwrap();

    let current = svc.get_session(&pid, &aid, &session.session_id).await.unwrap();
    assert!(
        svc.should_rollover(&current),
        "0.6 usage should trigger rollover at 0.5 threshold"
    );

    // Perform rollover
    let new_session = svc
        .rollover_session(
            &pid,
            &aid,
            &session.session_id,
            "Completed auth module".into(),
            None,
        )
        .await
        .unwrap();

    assert_eq!(new_session.status, SessionStatus::Active);
    assert_eq!(new_session.context_usage_estimate, 0.0);
    assert_eq!(new_session.summary_of_previous_context, "Completed auth module");

    let sessions = db.lock().await;
    assert_eq!(sessions.len(), 2);

    let old = sessions.iter().find(|s| s.id == session.session_id.to_string()).unwrap();
    assert_eq!(old.status.as_deref(), Some("rolled_over"));
}

#[tokio::test]
async fn generate_rollover_summary_calls_llm() {
    let mock = Arc::new(MockLlmProvider::with_responses(vec![
        MockResponse::text("Implemented user auth with JWT tokens and session management.")
            .with_tokens(200, 80),
    ]));

    let billing_url = start_mock_billing().await;
    let billing = {
        let _guard = ENV_LOCK.lock().unwrap();
        std::env::set_var("BILLING_SERVER_URL", &billing_url);
        Arc::new(aura_billing::BillingClient::new())
    };

    let tmp_llm = tempfile::TempDir::new().unwrap();
    let store_llm = Arc::new(aura_store::RocksStore::open(tmp_llm.path()).unwrap());
    store_test_jwt(&store_llm);
    let llm = aura_billing::MeteredLlm::new(mock.clone(), billing, store_llm.clone());

    let svc = SessionService::new(store_llm, 0.5, 200_000);

    let summary = svc
        .generate_rollover_summary(
            &llm,
            "test-key",
            "User asked about auth. Assistant set up JWT-based auth.",
        )
        .await
        .expect("summary generation should succeed");

    assert_eq!(
        summary,
        "Implemented user auth with JWT tokens and session management."
    );
    assert_eq!(mock.call_count(), 1);
}
