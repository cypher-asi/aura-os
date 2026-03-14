use std::env;

use reqwest::Client;
use serde::{Deserialize, Serialize};
use tracing::debug;

use aura_core::{CheckoutSessionResponse, CreditBalance, CreditTier};

use crate::error::BillingError;

#[derive(Debug, Serialize)]
struct CheckoutRequest {
    #[serde(skip_serializing_if = "Option::is_none")]
    tier_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    custom_credits: Option<u64>,
    entity_id: String,
}

#[derive(Debug, Deserialize)]
struct ZpsCheckoutResponse {
    #[serde(alias = "checkoutUrl")]
    checkout_url: String,
    #[serde(alias = "sessionId")]
    session_id: String,
}

#[derive(Debug, Deserialize)]
struct ZpsBalanceResponse {
    #[serde(alias = "totalCredits")]
    total_credits: u64,
    #[serde(default)]
    purchases: Vec<ZpsPurchase>,
}

#[derive(Debug, Deserialize)]
struct ZpsPurchase {
    id: String,
    #[serde(alias = "tierId")]
    tier_id: Option<String>,
    credits: u64,
    #[serde(alias = "amountCents")]
    amount_cents: u64,
    status: String,
    #[serde(alias = "createdAt")]
    created_at: String,
}

#[derive(Clone)]
pub struct BillingClient {
    http: Client,
    base_url: String,
    internal_token: String,
}

impl BillingClient {
    pub fn new() -> Self {
        let base_url = env::var("BILLING_SERVER_URL")
            .unwrap_or_else(|_| "https://billing.zero.tech".to_string());
        let internal_token =
            env::var("BILLING_INTERNAL_TOKEN").unwrap_or_default();

        Self {
            http: Client::new(),
            base_url,
            internal_token,
        }
    }

    pub async fn get_tiers(&self) -> Result<Vec<CreditTier>, BillingError> {
        let url = format!("{}/api/shanty/credits/tiers", self.base_url);
        debug!(%url, "Fetching credit tiers");

        let resp = self.http.get(&url).send().await?;
        let status = resp.status();
        if !status.is_success() {
            let body = resp.text().await.unwrap_or_default();
            return Err(BillingError::ServerError {
                status: status.as_u16(),
                body,
            });
        }
        resp.json().await.map_err(|e| BillingError::Deserialize(e.to_string()))
    }

    pub async fn get_balance(
        &self,
        access_token: &str,
        entity_id: &str,
    ) -> Result<CreditBalance, BillingError> {
        let url = format!(
            "{}/api/shanty/credits/balance?entityId={}",
            self.base_url, entity_id
        );
        debug!(%url, "Fetching credit balance");

        let resp = self
            .http
            .get(&url)
            .bearer_auth(access_token)
            .send()
            .await?;
        let status = resp.status();
        if !status.is_success() {
            let body = resp.text().await.unwrap_or_default();
            return Err(BillingError::ServerError {
                status: status.as_u16(),
                body,
            });
        }
        let zps: ZpsBalanceResponse = resp
            .json()
            .await
            .map_err(|e| BillingError::Deserialize(e.to_string()))?;

        Ok(CreditBalance {
            total_credits: zps.total_credits,
            purchases: zps
                .purchases
                .into_iter()
                .map(|p| aura_core::CreditPurchase {
                    id: p.id,
                    tier_id: p.tier_id,
                    credits: p.credits,
                    amount_cents: p.amount_cents,
                    status: p.status,
                    created_at: p
                        .created_at
                        .parse()
                        .unwrap_or_else(|_| chrono::Utc::now()),
                })
                .collect(),
        })
    }

    pub async fn create_checkout_session(
        &self,
        access_token: &str,
        entity_id: &str,
        tier_id: Option<String>,
        custom_credits: Option<u64>,
    ) -> Result<CheckoutSessionResponse, BillingError> {
        let url = format!(
            "{}/api/shanty/credits/checkout-session",
            self.base_url
        );
        debug!(%url, "Creating checkout session");

        let body = CheckoutRequest {
            tier_id,
            custom_credits,
            entity_id: entity_id.to_string(),
        };

        let resp = self
            .http
            .post(&url)
            .bearer_auth(access_token)
            .json(&body)
            .send()
            .await?;
        let status = resp.status();
        if !status.is_success() {
            let body = resp.text().await.unwrap_or_default();
            return Err(BillingError::ServerError {
                status: status.as_u16(),
                body,
            });
        }
        let zps: ZpsCheckoutResponse = resp
            .json()
            .await
            .map_err(|e| BillingError::Deserialize(e.to_string()))?;

        Ok(CheckoutSessionResponse {
            checkout_url: zps.checkout_url,
            session_id: zps.session_id,
        })
    }

    pub fn verify_internal_token(&self, token: &str) -> bool {
        if self.internal_token.is_empty() {
            return false;
        }
        token == self.internal_token
    }
}

impl Default for BillingClient {
    fn default() -> Self {
        Self::new()
    }
}
