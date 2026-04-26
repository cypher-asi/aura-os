//! Credit balance, purchase checkout, transaction history, and the
//! `ensure_has_credits` gate. Each public method first calls
//! [`BillingClient::ensure_account`] so a freshly-signed-up user
//! never sees a spurious 404 from the underlying z-billing service.

use reqwest::Method;
use tracing::debug;

use aura_os_core::{CheckoutSessionResponse, CreditBalance, TransactionsResponse};

use crate::error::BillingError;

use super::BillingClient;

impl BillingClient {
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
