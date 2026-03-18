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

pub fn billing_client_for_url(url: &str) -> BillingClient {
    let _guard = ENV_LOCK.lock().unwrap();
    std::env::set_var("BILLING_SERVER_URL", url);
    BillingClient::new()
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
        created_at: chrono::Utc::now(),
        validated_at: chrono::Utc::now(),
    })
    .unwrap();
    store.put_setting("zero_auth_session", &session).unwrap();
}

/// Create a fully wired `MeteredLlm` backed by a mock billing server and
/// the given `LlmProvider`. Returns the metered LLM and a temp dir (keep
/// it alive for the duration of the test).
pub async fn make_test_llm(
    provider: Arc<dyn aura_claude::LlmProvider>,
) -> (Arc<MeteredLlm>, tempfile::TempDir) {
    let url = start_mock_billing_server().await;
    let billing = Arc::new(billing_client_for_url(&url));
    let tmp = tempfile::TempDir::new().unwrap();
    let store = Arc::new(RocksStore::open(tmp.path()).unwrap());
    store_zero_auth_session(&store);
    let llm = Arc::new(MeteredLlm::new(provider, billing, store));
    (llm, tmp)
}
