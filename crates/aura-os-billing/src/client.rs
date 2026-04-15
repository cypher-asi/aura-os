use std::time::Duration;

use reqwest::{Client, Method, StatusCode};
use tracing::{debug, warn};

use aura_os_core::{BillingAccount, CheckoutSessionResponse, CreditBalance, TransactionsResponse};

use crate::error::BillingError;

#[derive(Clone)]
pub struct BillingClient {
    http: Client,
    base_url: String,
}

impl BillingClient {
    pub fn new() -> Self {
        let base_url = std::env::var("Z_BILLING_URL")
            .unwrap_or_else(|_| "https://z-billing.onrender.com".to_string());
        Self {
            http: Client::builder()
                .connect_timeout(Duration::from_secs(10))
                .timeout(Duration::from_secs(60))
                .build()
                .expect("failed to build billing http client"),
            base_url,
        }
    }

    pub fn with_base_url(base_url: String) -> Self {
        Self {
            http: Client::builder()
                .connect_timeout(Duration::from_secs(10))
                .timeout(Duration::from_secs(60))
                .build()
                .expect("failed to build billing http client"),
            base_url,
        }
    }

    async fn send_authed_json(
        &self,
        method: Method,
        path: &str,
        access_token: &str,
        body: Option<serde_json::Value>,
    ) -> Result<reqwest::Response, BillingError> {
        let url = format!("{}{}", self.base_url, path);
        let mut req = self
            .http
            .request(method, &url)
            .header("authorization", format!("Bearer {access_token}"));
        if let Some(body) = body {
            req = req.json(&body);
        }
        req.send().await.map_err(BillingError::from)
    }

    async fn json_or_server_error<T: serde::de::DeserializeOwned>(
        &self,
        resp: reqwest::Response,
        error_context: &str,
    ) -> Result<T, BillingError> {
        let status = resp.status();
        if !status.is_success() {
            let body = resp.text().await.unwrap_or_default();
            warn!(status = status.as_u16(), %body, "{error_context}");
            return Err(BillingError::ServerError {
                status: status.as_u16(),
                body,
            });
        }
        resp.json()
            .await
            .map_err(|e| BillingError::Deserialize(e.to_string()))
    }

    async fn get_balance_once(&self, access_token: &str) -> Result<CreditBalance, BillingError> {
        let url = format!("{}/v1/credits/balance", self.base_url);
        debug!(%url, "Fetching credit balance");
        let resp = self
            .send_authed_json(Method::GET, "/v1/credits/balance", access_token, None)
            .await?;
        self.json_or_server_error(resp, "z-billing error fetching balance")
            .await
    }

    async fn create_purchase_once(
        &self,
        access_token: &str,
        amount_usd: f64,
    ) -> Result<CheckoutSessionResponse, BillingError> {
        let url = format!("{}/v1/credits/purchase", self.base_url);
        debug!(%url, amount_usd, "Creating purchase");
        let resp = self
            .send_authed_json(
                Method::POST,
                "/v1/credits/purchase",
                access_token,
                Some(serde_json::json!({ "amount_usd": amount_usd })),
            )
            .await?;
        self.json_or_server_error(resp, "z-billing error creating purchase")
            .await
    }

    async fn get_transactions_once(
        &self,
        access_token: &str,
    ) -> Result<TransactionsResponse, BillingError> {
        let url = format!("{}/v1/credits/transactions", self.base_url);
        debug!(%url, "Fetching transactions");
        let resp = self
            .send_authed_json(Method::GET, "/v1/credits/transactions", access_token, None)
            .await?;
        self.json_or_server_error(resp, "z-billing error fetching transactions")
            .await
    }

    async fn get_account_once(&self, access_token: &str) -> Result<BillingAccount, BillingError> {
        let url = format!("{}/v1/accounts/me", self.base_url);
        debug!(%url, "Fetching billing account");
        let resp = self
            .send_authed_json(Method::GET, "/v1/accounts/me", access_token, None)
            .await?;
        let status = resp.status();
        if status == StatusCode::NOT_FOUND {
            let body = resp.text().await.unwrap_or_default();
            warn!(status = status.as_u16(), %body, "z-billing error fetching account");
            return Err(BillingError::AccountNotFound { body });
        }
        self.json_or_server_error(resp, "z-billing error fetching account")
            .await
    }

    async fn provision_account(&self, access_token: &str) -> Result<(), BillingError> {
        for path in [
            "/v1/accounts",
            "/v1/accounts/register",
            "/v1/accounts/provision",
        ] {
            let resp = self
                .send_authed_json(
                    Method::POST,
                    path,
                    access_token,
                    Some(serde_json::json!({})),
                )
                .await?;
            let status = resp.status();
            if status.is_success() || status == StatusCode::CONFLICT {
                debug!(%path, status = status.as_u16(), "Provisioned billing account");
                return Ok(());
            }

            let body = resp.text().await.unwrap_or_default();
            if status == StatusCode::NOT_FOUND || status == StatusCode::METHOD_NOT_ALLOWED {
                debug!(
                    %path,
                    status = status.as_u16(),
                    %body,
                    "Billing provisioning endpoint unavailable, trying fallback"
                );
                continue;
            }

            warn!(
                %path,
                status = status.as_u16(),
                %body,
                "z-billing error provisioning account"
            );
            return Err(BillingError::AccountProvisioningFailed {
                status: status.as_u16(),
                body,
            });
        }

        Err(BillingError::AccountProvisioningFailed {
            status: StatusCode::NOT_FOUND.as_u16(),
            body: "no supported z-billing account provisioning endpoint found".to_string(),
        })
    }

    pub async fn ensure_account(&self, access_token: &str) -> Result<(), BillingError> {
        match self.get_account_once(access_token).await {
            Ok(_) => Ok(()),
            Err(BillingError::AccountNotFound { body }) => {
                debug!(%body, "Billing account missing, attempting auto-provision");
                self.provision_account(access_token).await?;
                self.get_account_once(access_token).await.map(|_| ())
            }
            Err(other) => Err(other),
        }
    }

    pub async fn get_balance(&self, access_token: &str) -> Result<CreditBalance, BillingError> {
        self.ensure_account(access_token).await?;
        self.get_balance_once(access_token).await
    }

    pub async fn create_purchase(
        &self,
        access_token: &str,
        amount_usd: f64,
    ) -> Result<CheckoutSessionResponse, BillingError> {
        self.ensure_account(access_token).await?;
        self.create_purchase_once(access_token, amount_usd).await
    }

    pub async fn get_transactions(
        &self,
        access_token: &str,
    ) -> Result<TransactionsResponse, BillingError> {
        self.ensure_account(access_token).await?;
        self.get_transactions_once(access_token).await
    }

    pub async fn get_account(&self, access_token: &str) -> Result<BillingAccount, BillingError> {
        self.ensure_account(access_token).await?;
        self.get_account_once(access_token).await
    }

    pub async fn ensure_has_credits(&self, access_token: &str) -> Result<i64, BillingError> {
        let balance = self.get_balance(access_token).await?;
        if balance.balance_cents > 0 {
            Ok(balance.balance_cents)
        } else {
            Err(BillingError::InsufficientCredits {
                balance_cents: balance.balance_cents,
            })
        }
    }
}

impl Default for BillingClient {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{
        extract::State,
        http::StatusCode as AxumStatusCode,
        response::IntoResponse,
        routing::{get, post},
        Json, Router,
    };
    use std::sync::Arc;
    use tokio::net::TcpListener;
    use tokio::sync::Mutex;

    async fn start_server(app: Router) -> (String, BillingClient) {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!("http://{}", listener.local_addr().unwrap());
        tokio::spawn(async move { axum::serve(listener, app).await.ok() });

        let client = BillingClient::with_base_url(url.clone());
        (url, client)
    }

    #[tokio::test]
    async fn test_get_balance_success() {
        let app = Router::new().route(
            "/v1/credits/balance",
            get(|| async {
                Json(serde_json::json!({
                    "balance_cents": 50000,
                    "plan": "pro",
                    "balance_formatted": "$500.00"
                }))
            }),
        );
        let (_url, client) = start_server(app).await;
        let bal = client.get_balance("tok").await.unwrap();
        assert_eq!(bal.balance_cents, 50000);
        assert_eq!(bal.plan, "pro");
        assert_eq!(bal.balance_formatted, "$500.00");
    }

    #[tokio::test]
    async fn test_get_balance_unauthorized() {
        use axum::http::StatusCode;
        let app = Router::new().route(
            "/v1/credits/balance",
            get(|| async { (StatusCode::UNAUTHORIZED, "unauthorized") }),
        );
        let (_url, client) = start_server(app).await;
        let err = client.get_balance("bad-tok").await.unwrap_err();
        match err {
            BillingError::ServerError { status, .. } => assert_eq!(status, 401),
            other => panic!("expected ServerError, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn test_create_purchase_success() {
        let app = Router::new().route(
            "/v1/credits/purchase",
            post(|| async {
                Json(serde_json::json!({
                    "checkout_url": "https://checkout.example.com/sess_1",
                    "session_id": "sess_1"
                }))
            }),
        );
        let (_url, client) = start_server(app).await;
        let resp = client.create_purchase("tok", 10.0).await.unwrap();
        assert_eq!(resp.checkout_url, "https://checkout.example.com/sess_1");
        assert_eq!(resp.session_id, "sess_1");
    }

    #[tokio::test]
    async fn test_create_purchase_invalid_amount() {
        use axum::http::StatusCode;
        let app = Router::new().route(
            "/v1/credits/purchase",
            post(|| async { (StatusCode::BAD_REQUEST, "invalid amount") }),
        );
        let (_url, client) = start_server(app).await;
        let err = client.create_purchase("tok", -5.0).await.unwrap_err();
        match err {
            BillingError::ServerError { status, .. } => assert_eq!(status, 400),
            other => panic!("expected ServerError, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn test_get_transactions_success() {
        let app = Router::new().route(
            "/v1/credits/transactions",
            get(|| async {
                Json(serde_json::json!({
                    "transactions": [
                        {
                            "id": "tx-1",
                            "amount_cents": -500,
                            "transaction_type": "usage",
                            "balance_after_cents": 49500,
                            "description": "LLM call",
                            "created_at": "2026-03-01T00:00:00Z"
                        }
                    ],
                    "has_more": true
                }))
            }),
        );
        let (_url, client) = start_server(app).await;
        let resp = client.get_transactions("tok").await.unwrap();
        assert_eq!(resp.transactions.len(), 1);
        assert_eq!(resp.transactions[0].id, "tx-1");
        assert_eq!(resp.transactions[0].amount_cents, -500);
        assert!(resp.has_more);
    }

    #[tokio::test]
    async fn test_get_transactions_empty() {
        let app = Router::new().route(
            "/v1/credits/transactions",
            get(|| async {
                Json(serde_json::json!({
                    "transactions": [],
                    "has_more": false
                }))
            }),
        );
        let (_url, client) = start_server(app).await;
        let resp = client.get_transactions("tok").await.unwrap();
        assert!(resp.transactions.is_empty());
        assert!(!resp.has_more);
    }

    #[tokio::test]
    async fn test_get_account_success() {
        let app = Router::new().route(
            "/v1/accounts/me",
            get(|| async {
                Json(serde_json::json!({
                    "user_id": "u-123",
                    "balance_cents": 100000,
                    "balance_formatted": "$1,000.00",
                    "lifetime_purchased_cents": 200000,
                    "lifetime_granted_cents": 5000,
                    "lifetime_used_cents": 105000,
                    "plan": "pro",
                    "auto_refill_enabled": true,
                    "created_at": "2026-01-15T12:00:00Z"
                }))
            }),
        );
        let (_url, client) = start_server(app).await;
        let acct = client.get_account("tok").await.unwrap();
        assert_eq!(acct.user_id, "u-123");
        assert_eq!(acct.balance_cents, 100000);
        assert_eq!(acct.plan, "pro");
        assert!(acct.auto_refill_enabled);
    }

    #[tokio::test]
    async fn test_get_balance_auto_provisions_missing_account() {
        #[derive(Default)]
        struct MockState {
            account_exists: bool,
            account_probe_count: usize,
            provision_count: usize,
        }

        type SharedState = Arc<Mutex<MockState>>;

        async fn get_account(State(state): State<SharedState>) -> axum::response::Response {
            let mut guard = state.lock().await;
            guard.account_probe_count += 1;
            if guard.account_exists {
                Json(serde_json::json!({
                    "user_id": "u-123",
                    "balance_cents": 5000,
                    "balance_formatted": "$50.00",
                    "lifetime_purchased_cents": 5000,
                    "lifetime_granted_cents": 0,
                    "lifetime_used_cents": 0,
                    "plan": "free",
                    "auto_refill_enabled": false,
                    "created_at": "2026-01-15T12:00:00Z"
                }))
                .into_response()
            } else {
                (
                    AxumStatusCode::NOT_FOUND,
                    Json(serde_json::json!({
                        "error": { "code": "not_found", "message": "Account not found" }
                    })),
                )
                    .into_response()
            }
        }

        async fn create_account(State(state): State<SharedState>) -> axum::response::Response {
            let mut guard = state.lock().await;
            guard.provision_count += 1;
            guard.account_exists = true;
            (
                AxumStatusCode::CREATED,
                Json(serde_json::json!({ "status": "created" })),
            )
                .into_response()
        }

        async fn get_balance(State(state): State<SharedState>) -> axum::response::Response {
            let guard = state.lock().await;
            if guard.account_exists {
                Json(serde_json::json!({
                    "balance_cents": 5000,
                    "plan": "free",
                    "balance_formatted": "$50.00"
                }))
                .into_response()
            } else {
                (
                    AxumStatusCode::NOT_FOUND,
                    Json(serde_json::json!({
                        "error": { "code": "not_found", "message": "Account not found" }
                    })),
                )
                    .into_response()
            }
        }

        let state = Arc::new(Mutex::new(MockState::default()));
        let app = Router::new()
            .route("/v1/accounts/me", get(get_account))
            .route("/v1/accounts", post(create_account))
            .route("/v1/credits/balance", get(get_balance))
            .with_state(state.clone());
        let (_url, client) = start_server(app).await;

        let balance = client.get_balance("tok").await.unwrap();
        assert_eq!(balance.balance_cents, 5000);

        let guard = state.lock().await;
        assert_eq!(guard.provision_count, 1);
        assert_eq!(guard.account_probe_count, 2);
    }

    #[tokio::test]
    async fn test_ensure_has_credits_sufficient() {
        let app = Router::new().route(
            "/v1/credits/balance",
            get(|| async {
                Json(serde_json::json!({
                    "balance_cents": 5000,
                    "plan": "free",
                    "balance_formatted": "$50.00"
                }))
            }),
        );
        let (_url, client) = start_server(app).await;
        let cents = client.ensure_has_credits("tok").await.unwrap();
        assert_eq!(cents, 5000);
    }

    #[tokio::test]
    async fn test_ensure_has_credits_zero() {
        let app = Router::new().route(
            "/v1/credits/balance",
            get(|| async {
                Json(serde_json::json!({
                    "balance_cents": 0,
                    "plan": "free",
                    "balance_formatted": "$0.00"
                }))
            }),
        );
        let (_url, client) = start_server(app).await;
        let err = client.ensure_has_credits("tok").await.unwrap_err();
        match err {
            BillingError::InsufficientCredits { balance_cents } => {
                assert_eq!(balance_cents, 0);
            }
            other => panic!("expected InsufficientCredits, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn test_ensure_has_credits_negative() {
        let app = Router::new().route(
            "/v1/credits/balance",
            get(|| async {
                Json(serde_json::json!({
                    "balance_cents": -200,
                    "plan": "free",
                    "balance_formatted": "-$2.00"
                }))
            }),
        );
        let (_url, client) = start_server(app).await;
        let err = client.ensure_has_credits("tok").await.unwrap_err();
        match err {
            BillingError::InsufficientCredits { balance_cents } => {
                assert_eq!(balance_cents, -200);
            }
            other => panic!("expected InsufficientCredits, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn test_new_reads_z_billing_url() {
        let _guard = crate::testutil::ENV_LOCK
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        std::env::set_var("Z_BILLING_URL", "https://custom.example.com");
        let client = BillingClient::new();
        assert_eq!(client.base_url, "https://custom.example.com");
        std::env::remove_var("Z_BILLING_URL");
        let client2 = BillingClient::new();
        assert_eq!(client2.base_url, "https://z-billing.onrender.com");
    }

    #[test]
    fn test_credit_balance_deserialize() {
        let json = r#"{"balance_cents": 42000, "plan": "pro", "balance_formatted": "$420.00"}"#;
        let bal: CreditBalance = serde_json::from_str(json).unwrap();
        assert_eq!(bal.balance_cents, 42000);
        assert_eq!(bal.plan, "pro");
        assert_eq!(bal.balance_formatted, "$420.00");
    }

    #[test]
    fn test_credit_transaction_deserialize() {
        let json = r#"{
            "id": "tx-99",
            "amount_cents": -1500,
            "transaction_type": "usage",
            "balance_after_cents": 40500,
            "description": "LLM opus call",
            "created_at": "2026-03-20T10:00:00Z"
        }"#;
        let tx: aura_os_core::CreditTransaction = serde_json::from_str(json).unwrap();
        assert_eq!(tx.id, "tx-99");
        assert_eq!(tx.amount_cents, -1500);
        assert_eq!(tx.transaction_type, "usage");
        assert_eq!(tx.balance_after_cents, 40500);
    }

    #[test]
    fn test_transactions_response_deserialize() {
        let json = r#"{
            "transactions": [
                {
                    "id": "tx-1",
                    "amount_cents": 10000,
                    "transaction_type": "purchase",
                    "balance_after_cents": 10000,
                    "description": "Credit purchase",
                    "created_at": "2026-03-01T00:00:00Z"
                },
                {
                    "id": "tx-2",
                    "amount_cents": -300,
                    "transaction_type": "usage",
                    "balance_after_cents": 9700,
                    "description": "Haiku call",
                    "created_at": "2026-03-02T00:00:00Z"
                }
            ],
            "has_more": false
        }"#;
        let resp: TransactionsResponse = serde_json::from_str(json).unwrap();
        assert_eq!(resp.transactions.len(), 2);
        assert!(!resp.has_more);
        assert_eq!(resp.transactions[0].transaction_type, "purchase");
        assert_eq!(resp.transactions[1].amount_cents, -300);
    }

    #[test]
    fn test_billing_account_deserialize() {
        let json = r#"{
            "user_id": "u-abc",
            "balance_cents": 75000,
            "balance_formatted": "$750.00",
            "lifetime_purchased_cents": 200000,
            "lifetime_granted_cents": 10000,
            "lifetime_used_cents": 135000,
            "plan": "enterprise",
            "auto_refill_enabled": true,
            "created_at": "2025-12-01T00:00:00Z"
        }"#;
        let acct: BillingAccount = serde_json::from_str(json).unwrap();
        assert_eq!(acct.user_id, "u-abc");
        assert_eq!(acct.balance_cents, 75000);
        assert_eq!(acct.lifetime_purchased_cents, 200000);
        assert!(acct.auto_refill_enabled);
        assert_eq!(acct.plan, "enterprise");
    }
}
