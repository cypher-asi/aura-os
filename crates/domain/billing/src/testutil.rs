/// Shared test utilities for billing-related tests.
///
/// This module is public so downstream crates (aura-chat, aura-engine) can
/// reuse the mock billing server and session helpers instead of duplicating them.
use std::sync::Arc;

use aura_core::ZeroAuthSession;
use aura_store::RocksStore;

use crate::client::BillingClient;
use crate::metered::MeteredLlm;

pub static ENV_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

pub async fn start_mock_billing_server() -> String {
    use axum::{routing::get, Json, Router};
    use tokio::net::TcpListener;

    let app = Router::new()
        .route(
            "/v1/credits/balance",
            get(|| async {
                Json(serde_json::json!({
                    "balance_cents": 999999,
                    "plan": "free",
                    "balance_formatted": "$9,999.99"
                }))
            }),
        )
        .route(
            "/v1/credits/transactions",
            get(|| async {
                Json(serde_json::json!({
                    "transactions": [],
                    "has_more": false
                }))
            }),
        )
        .route(
            "/v1/accounts/me",
            get(|| async {
                Json(serde_json::json!({
                    "user_id": "u1",
                    "balance_cents": 999999,
                    "balance_formatted": "$9,999.99",
                    "lifetime_purchased_cents": 1000000,
                    "lifetime_granted_cents": 0,
                    "lifetime_used_cents": 1,
                    "plan": "free",
                    "auto_refill_enabled": false,
                    "created_at": "2026-01-01T00:00:00Z"
                }))
            }),
        );

    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://{}", listener.local_addr().unwrap());
    tokio::spawn(async move { axum::serve(listener, app).await.ok() });
    url
}

// ---------------------------------------------------------------------------
// Stateful mock billing server
// ---------------------------------------------------------------------------

pub struct MockBillingState {
    pub balance_cents: i64,
}

impl MockBillingState {
    pub fn new(initial_balance_cents: i64) -> Self {
        Self {
            balance_cents: initial_balance_cents,
        }
    }
}

/// Start a mock billing server with mutable state for balance tracking.
pub async fn start_stateful_mock_billing_server(
    state: Arc<tokio::sync::Mutex<MockBillingState>>,
) -> String {
    use axum::{extract::State, routing::get, Json, Router};
    use tokio::net::TcpListener;

    type SharedState = Arc<tokio::sync::Mutex<MockBillingState>>;

    async fn balance_handler(State(st): State<SharedState>) -> axum::response::Response {
        let guard = st.lock().await;
        let body = serde_json::json!({
            "balance_cents": guard.balance_cents,
            "plan": "free",
            "balance_formatted": format!("${:.2}", guard.balance_cents as f64 / 100.0)
        });
        axum::response::IntoResponse::into_response(Json(body))
    }

    let app = Router::new()
        .route("/v1/credits/balance", get(balance_handler))
        .with_state(state);

    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://{}", listener.local_addr().unwrap());
    tokio::spawn(async move { axum::serve(listener, app).await.ok() });
    url
}

pub fn billing_client_for_url(url: &str) -> BillingClient {
    BillingClient::with_base_url(url.to_string())
}

pub fn store_zero_auth_session(store: &RocksStore) {
    let session = serde_json::to_vec(&ZeroAuthSession {
        user_id: "u1".into(),
        network_user_id: None,
        profile_id: None,
        display_name: "Test".into(),
        profile_image: String::new(),
        primary_zid: "zid-1".into(),
        zero_wallet: "w1".into(),
        wallets: vec![],
        access_token: "test-token".into(),
        is_zero_pro: false,
        created_at: chrono::Utc::now(),
        validated_at: chrono::Utc::now(),
    })
    .unwrap();
    store.put_setting("zero_auth_session", &session).unwrap();
}

/// Create a fully wired `MeteredLlm` backed by a mock billing server and
/// the given `LlmProvider`. Always operates in non-router mode regardless
/// of the `AURA_ROUTER_URL` env var (avoids env-var races with parallel tests).
pub async fn make_test_llm(
    provider: Arc<dyn aura_claude::LlmProvider>,
) -> (Arc<MeteredLlm>, tempfile::TempDir) {
    let url = start_mock_billing_server().await;
    let billing = Arc::new(billing_client_for_url(&url));
    let tmp = tempfile::TempDir::new().unwrap();
    let store = Arc::new(RocksStore::open(tmp.path()).unwrap());
    store_zero_auth_session(&store);
    let mut llm = MeteredLlm::new(provider, billing, store);
    llm.router_mode = false;
    (Arc::new(llm), tmp)
}

/// Like `make_test_llm`, but backed by a stateful mock server so tests can
/// configure low balances. Always operates in non-router mode.
pub async fn make_test_llm_stateful(
    provider: Arc<dyn aura_claude::LlmProvider>,
    state: Arc<tokio::sync::Mutex<MockBillingState>>,
) -> (Arc<MeteredLlm>, tempfile::TempDir) {
    let url = start_stateful_mock_billing_server(state).await;
    let billing = Arc::new(billing_client_for_url(&url));
    let tmp = tempfile::TempDir::new().unwrap();
    let store = Arc::new(RocksStore::open(tmp.path()).unwrap());
    store_zero_auth_session(&store);
    let mut llm = MeteredLlm::new(provider, billing, store);
    llm.router_mode = false;
    (Arc::new(llm), tmp)
}
