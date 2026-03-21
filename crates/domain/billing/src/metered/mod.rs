pub(crate) mod debit;
mod llm_provider;
mod model_provider;
mod preflight;

#[cfg(test)]
mod tests;

use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Instant;

use tokio::sync::{mpsc, Mutex};

use aura_claude::{
    ClaudeStreamEvent, LlmResponse, RichMessage, StreamTokenCapture,
    ThinkingConfig, ToolDefinition, ToolStreamRequest, ToolStreamResponse,
};
use aura_core::ZeroAuthSession;
use aura_store::RocksStore;

use crate::client::BillingClient;
use crate::pricing::PricingService;

const PRE_FLIGHT_CACHE_TTL_SECS: u64 = 30;

#[derive(Debug, thiserror::Error)]
pub enum MeteredLlmError {
    #[error("Insufficient credits")]
    InsufficientCredits,

    #[error("LLM error: {0}")]
    Llm(#[from] aura_claude::ClaudeClientError),

    #[error("Billing error: {0}")]
    Billing(#[from] crate::error::BillingError),
}

impl MeteredLlmError {
    pub fn is_insufficient_credits(&self) -> bool {
        matches!(self, MeteredLlmError::InsufficientCredits)
    }

    /// Returns true for any billing-related failure (insufficient credits,
    /// server errors, deserialization, network issues). Use this to decide
    /// whether to stop the automation loop — we must not keep running LLM
    /// calls if we can't record the billing for them.
    pub fn is_billing_error(&self) -> bool {
        matches!(self, MeteredLlmError::InsufficientCredits | MeteredLlmError::Billing(_))
    }
}

pub struct MeteredLlm {
    pub(crate) provider: Arc<dyn aura_claude::LlmProvider>,
    pub(crate) billing: Arc<BillingClient>,
    pub(crate) store: Arc<RocksStore>,
    pub(crate) pricing: PricingService,
    pub(crate) credits_exhausted: AtomicBool,
    pub(crate) last_preflight_ok: Mutex<Option<Instant>>,
    pub(crate) credits_per_usd: f64,
}

// ---------------------------------------------------------------------------
// Parameter structs (to avoid too_many_arguments)
// ---------------------------------------------------------------------------

/// Bundled parameters for non-streaming metered completions.
pub struct MeteredCompletionRequest<'a> {
    pub model: Option<&'a str>,
    pub api_key: &'a str,
    pub system_prompt: &'a str,
    pub user_message: &'a str,
    pub max_tokens: u32,
    pub billing_reason: &'a str,
    pub metadata: Option<serde_json::Value>,
}

/// Bundled parameters for tool-use streaming metered requests.
pub struct MeteredStreamRequest<'a> {
    pub api_key: &'a str,
    pub system_prompt: &'a str,
    pub messages: Vec<RichMessage>,
    pub tools: Vec<ToolDefinition>,
    pub max_tokens: u32,
    pub thinking: Option<ThinkingConfig>,
    pub event_tx: mpsc::UnboundedSender<ClaudeStreamEvent>,
    pub model_override: Option<&'a str>,
    pub billing_reason: &'a str,
    pub metadata: Option<serde_json::Value>,
}

const DEFAULT_CREDITS_PER_USD: f64 = 114_286.0;

impl MeteredLlm {
    pub fn new(
        provider: Arc<dyn aura_claude::LlmProvider>,
        billing: Arc<BillingClient>,
        store: Arc<RocksStore>,
    ) -> Self {
        let credits_per_usd: f64 = std::env::var("BILLING_CREDITS_PER_USD")
            .ok()
            .and_then(|v| v.parse().ok())
            .unwrap_or(DEFAULT_CREDITS_PER_USD);
        let pricing = PricingService::new(store.clone());
        Self {
            provider,
            billing,
            store,
            pricing,
            credits_exhausted: AtomicBool::new(false),
            last_preflight_ok: Mutex::new(None),
            credits_per_usd,
        }
    }

    pub fn is_credits_exhausted(&self) -> bool {
        self.credits_exhausted.load(Ordering::SeqCst)
    }

    /// Estimate how many credits a call would cost given the estimated token
    /// counts. Applies a conservative cache discount (assumes 50% of input
    /// tokens are cache reads at 0.1x cost) to avoid stopping the tool loop
    /// prematurely when prompt caching is active.
    pub fn estimate_credits(&self, model: &str, estimated_input_tokens: u64, estimated_output_tokens: u64) -> u64 {
        let (inp_rate, out_rate) = self.pricing.lookup_rate(model);
        let cache_read_fraction = 0.5;
        let non_cached = estimated_input_tokens as f64 * (1.0 - cache_read_fraction);
        let cached = estimated_input_tokens as f64 * cache_read_fraction;
        let usd_cost = (non_cached * inp_rate + cached * inp_rate * 0.1
            + estimated_output_tokens as f64 * out_rate) / 1_000_000.0;
        (usd_cost * self.credits_per_usd).round() as u64
    }

    pub async fn current_balance(&self) -> Option<u64> {
        let token = self.access_token()?;
        self.billing.get_balance(&token).await.ok().map(|b| b.total_credits)
    }

    pub(crate) fn access_token(&self) -> Option<String> {
        self.store
            .get_setting("zero_auth_session")
            .ok()
            .and_then(|bytes| serde_json::from_slice::<ZeroAuthSession>(&bytes).ok())
            .map(|s| s.access_token)
    }

    // -----------------------------------------------------------------------
    // Public API: metered LLM calls with custom billing reason + metadata
    // -----------------------------------------------------------------------

    pub async fn complete(
        &self,
        req: MeteredCompletionRequest<'_>,
    ) -> Result<LlmResponse, MeteredLlmError> {
        self.pre_flight_check().await?;
        let (model, resp) = match req.model {
            Some(m) => {
                let r = self.provider.complete_with_model(m, req.api_key, req.system_prompt, req.user_message, req.max_tokens).await?;
                (m, r)
            }
            None => {
                let r = self.provider.complete(req.api_key, req.system_prompt, req.user_message, req.max_tokens).await?;
                (aura_claude::DEFAULT_MODEL, r)
            }
        };
        self.debit(debit::DebitParams {
            model, input_tokens: resp.input_tokens, output_tokens: resp.output_tokens,
            cache_creation_input_tokens: 0, cache_read_input_tokens: 0,
            reason: req.billing_reason, metadata: req.metadata,
        }).await?;
        Ok(resp)
    }

    pub async fn complete_stream(
        &self,
        req: MeteredCompletionRequest<'_>,
        event_tx: mpsc::UnboundedSender<ClaudeStreamEvent>,
    ) -> Result<String, MeteredLlmError> {
        self.pre_flight_check().await?;
        let (tx, handle) = StreamTokenCapture::forwarding(event_tx);
        let result = self.provider.complete_stream(
            req.api_key, req.system_prompt, req.user_message, req.max_tokens, tx,
        ).await?;
        let (inp, out, cache_create, cache_read) = handle.finalize().await;
        self.debit(debit::DebitParams {
            model: aura_claude::DEFAULT_MODEL, input_tokens: inp, output_tokens: out,
            cache_creation_input_tokens: cache_create, cache_read_input_tokens: cache_read,
            reason: req.billing_reason, metadata: req.metadata,
        }).await?;
        Ok(result)
    }

    #[allow(clippy::too_many_arguments)]
    pub async fn complete_stream_multi(
        &self,
        api_key: &str,
        system_prompt: &str,
        messages: Vec<(String, String)>,
        max_tokens: u32,
        event_tx: mpsc::UnboundedSender<ClaudeStreamEvent>,
        reason: &str,
        metadata: Option<serde_json::Value>,
    ) -> Result<String, MeteredLlmError> {
        self.pre_flight_check().await?;
        let (tx, handle) = StreamTokenCapture::forwarding(event_tx);
        let result = self.provider.complete_stream_multi(
            api_key, system_prompt, messages, max_tokens, tx,
        ).await?;
        let (inp, out, cache_create, cache_read) = handle.finalize().await;
        self.debit(debit::DebitParams {
            model: aura_claude::DEFAULT_MODEL, input_tokens: inp, output_tokens: out,
            cache_creation_input_tokens: cache_create, cache_read_input_tokens: cache_read,
            reason, metadata,
        }).await?;
        Ok(result)
    }

    pub async fn complete_stream_with_tools(
        &self,
        req: MeteredStreamRequest<'_>,
    ) -> Result<ToolStreamResponse, MeteredLlmError> {
        let MeteredStreamRequest {
            api_key, system_prompt, messages, tools, max_tokens,
            thinking, event_tx, model_override, billing_reason, metadata,
        } = req;

        let estimated_input: u64 = aura_claude::estimate_tokens(system_prompt)
            + messages.iter().map(aura_claude::estimate_message_tokens).sum::<u64>();
        let estimated_credits = self.estimate_credits(aura_claude::DEFAULT_MODEL, estimated_input, 0);
        self.pre_flight_check_for(estimated_credits).await?;

        let resp = self.provider.complete_stream_with_tools(ToolStreamRequest {
            api_key, system_prompt, messages, tools, max_tokens,
            thinking, event_tx, model_override,
        }).await?;

        let billing_model = if resp.model_used.is_empty() { aura_claude::DEFAULT_MODEL } else { &resp.model_used };
        self.debit(debit::DebitParams {
            model: billing_model, input_tokens: resp.input_tokens,
            output_tokens: resp.output_tokens,
            cache_creation_input_tokens: resp.cache_creation_input_tokens,
            cache_read_input_tokens: resp.cache_read_input_tokens,
            reason: billing_reason, metadata,
        }).await?;
        Ok(resp)
    }
}
