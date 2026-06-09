//! Service-authenticated usage pricing calls.

use reqwest::Method;
use serde::{Deserialize, Serialize};

use crate::error::BillingError;

use super::BillingClient;

#[derive(Debug, Clone)]
pub struct LlmUsageQuote {
    pub provider: String,
    pub model: String,
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub zero_pro_user: bool,
}

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
pub struct UsageQuoteResponse {
    pub cost_cents: i64,
    pub currency: String,
}

#[derive(Debug, Serialize)]
struct UsageQuoteRequest<'a> {
    metric: UsageQuoteMetric<'a>,
    #[serde(rename = "zeroProUser")]
    zero_pro_user: bool,
}

#[derive(Debug, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
enum UsageQuoteMetric<'a> {
    LlmTokens {
        provider: &'a str,
        model: &'a str,
        input_tokens: u64,
        output_tokens: u64,
    },
}

impl BillingClient {
    pub async fn quote_llm_usage(
        &self,
        quote: LlmUsageQuote,
    ) -> Result<UsageQuoteResponse, BillingError> {
        let body = serde_json::to_value(UsageQuoteRequest {
            metric: UsageQuoteMetric::LlmTokens {
                provider: &quote.provider,
                model: &quote.model,
                input_tokens: quote.input_tokens,
                output_tokens: quote.output_tokens,
            },
            zero_pro_user: quote.zero_pro_user,
        })
        .map_err(|error| BillingError::Deserialize(error.to_string()))?;
        let resp = self
            .send_service_json(Method::POST, "/v1/usage/quote", body)
            .await?;
        self.json_or_server_error(resp, "z-billing error quoting usage")
            .await
    }
}
