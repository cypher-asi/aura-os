use std::sync::Arc;

use axum::{
    extract::{Path, State},
    routing::{get, post},
    Json, Router,
};
use chrono::Utc;
use tokio::net::TcpListener;
use tokio::sync::Mutex;

use aura_core::*;
use aura_sessions::SessionService;
use aura_storage::{CreateSessionRequest, StorageClient, StorageSession, UpdateSessionRequest};

pub type SessionDb = Arc<Mutex<Vec<StorageSession>>>;

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
        tasks_worked_count: Some(0),
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
        if let Some(count) = req.tasks_worked_count {
            session.tasks_worked_count = Some(count);
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

pub async fn start_mock_storage() -> (String, SessionDb) {
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

    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .expect("test TCP listener should bind");
    let url = format!(
        "http://{}",
        listener
            .local_addr()
            .expect("listener should have local address"),
    );
    tokio::spawn(async move { axum::serve(listener, app).await.ok() });
    (url, db)
}

pub fn make_session_service(
    store: &Arc<aura_store::RocksStore>,
    storage_url: &str,
    rollover_threshold: f64,
) -> SessionService {
    let storage = Arc::new(StorageClient::with_base_url(storage_url));
    SessionService::new(store.clone(), rollover_threshold, 200_000)
        .with_storage_client(Some(storage))
}

pub fn store_test_jwt(store: &aura_store::RocksStore) {
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
    .expect("test session should serialize");
    store
        .put_setting("zero_auth_session", &session)
        .expect("test JWT should be stored");
}
