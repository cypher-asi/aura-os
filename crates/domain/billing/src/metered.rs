use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Instant;

use async_trait::async_trait;
use tokio::sync::{mpsc, Mutex};
use tracing::{info, warn};

const PRE_FLIGHT_CACHE_TTL_SECS: u64 = 30;

use aura_claude::{
    ClaudeClientError, ClaudeStreamEvent, LlmProvider, LlmResponse, LlmStreamEvent,
    RichMessage, StreamTokenCapture, ThinkingConfig, ToolDefinition, ToolStreamResponse,
};
use aura_core::ZeroAuthSession;
use aura_store::RocksStore;

use crate::client::BillingClient;
use crate::error::BillingError;
use crate::pricing::PricingService;

#[derive(Debug, thiserror::Error)]
pub enum MeteredLlmError {
    #[error("Insufficient credits")]
    InsufficientCredits,

    #[error("LLM error: {0}")]
    Llm(#[from] aura_claude::ClaudeClientError),

    #[error("Billing error: {0}")]
    Billing(#[from] BillingError),
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
    provider: Arc<dyn LlmProvider>,
    billing: Arc<BillingClient>,
    store: Arc<RocksStore>,
    pricing: PricingService,
    credits_exhausted: AtomicBool,
    last_preflight_ok: Mutex<Option<Instant>>,
    credits_per_usd: f64,
}

const DEFAULT_CREDITS_PER_USD: f64 = 114_286.0;

impl MeteredLlm {
    pub fn new(
        provider: Arc<dyn LlmProvider>,
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
    /// counts. Uses the same formula as `debit` but doesn't actually charge.
    pub fn estimate_credits(&self, model: &str, estimated_input_tokens: u64, estimated_output_tokens: u64) -> u64 {
        let (inp_rate, out_rate) = self.pricing.lookup_rate(model);
        let usd_cost = (estimated_input_tokens as f64 * inp_rate
            + estimated_output_tokens as f64 * out_rate) / 1_000_000.0;
        (usd_cost * self.credits_per_usd).round() as u64
    }

    pub async fn current_balance(&self) -> Option<u64> {
        let token = self.access_token()?;
        self.billing.get_balance(&token).await.ok().map(|b| b.total_credits)
    }

    fn access_token(&self) -> Option<String> {
        self.store
            .get_setting("zero_auth_session")
            .ok()
            .and_then(|bytes| serde_json::from_slice::<ZeroAuthSession>(&bytes).ok())
            .map(|s| s.access_token)
    }

    async fn pre_flight_check(&self) -> Result<(), MeteredLlmError> {
        self.pre_flight_check_for(0).await
    }

    /// Pre-flight check with cost awareness. When `estimated_credits > 0`,
    /// verifies that the user's balance can cover at least that amount before
    /// making the API call.
    async fn pre_flight_check_for(&self, estimated_credits: u64) -> Result<(), MeteredLlmError> {
        let Some(token) = self.access_token() else {
            warn!("No access token available — cannot verify credits");
            self.credits_exhausted.store(true, Ordering::SeqCst);
            return Err(MeteredLlmError::InsufficientCredits);
        };

        if !self.credits_exhausted.load(Ordering::SeqCst) && estimated_credits == 0 {
            let cache = self.last_preflight_ok.lock().await;
            if let Some(ts) = *cache {
                if ts.elapsed().as_secs() < PRE_FLIGHT_CACHE_TTL_SECS {
                    return Ok(());
                }
            }
            drop(cache);
        }

        let required = estimated_credits.max(1);

        if self.credits_exhausted.load(Ordering::SeqCst) {
            match self.billing.ensure_has_credits_for(&token, required).await {
                Ok(_) => {
                    info!("Credits topped up, resetting exhausted flag");
                    self.credits_exhausted.store(false, Ordering::SeqCst);
                }
                Err(_) => return Err(MeteredLlmError::InsufficientCredits),
            }
        } else {
            if let Err(_) = self.billing.ensure_has_credits_for(&token, required).await {
                self.credits_exhausted.store(true, Ordering::SeqCst);
                return Err(MeteredLlmError::InsufficientCredits);
            }
        }

        *self.last_preflight_ok.lock().await = Some(Instant::now());
        Ok(())
    }

    async fn debit(
        &self,
        model: &str,
        input_tokens: u64,
        output_tokens: u64,
        cache_creation_input_tokens: u64,
        cache_read_input_tokens: u64,
        reason: &str,
        metadata: Option<serde_json::Value>,
    ) -> Result<(), MeteredLlmError> {
        let (inp_rate, out_rate) = self.pricing.lookup_rate(model);
        let non_cached = input_tokens.saturating_sub(cache_creation_input_tokens + cache_read_input_tokens);
        let usd_cost = (
            non_cached as f64 * inp_rate
            + cache_creation_input_tokens as f64 * inp_rate * 1.25
            + cache_read_input_tokens as f64 * inp_rate * 0.1
            + output_tokens as f64 * out_rate
        ) / 1_000_000.0;
        let amount = (usd_cost * self.credits_per_usd).round() as u64;
        if amount == 0 {
            return Ok(());
        }
        let Some(token) = self.access_token() else {
            warn!("No access token available for credit debit");
            self.credits_exhausted.store(true, Ordering::SeqCst);
            return Err(MeteredLlmError::InsufficientCredits);
        };
        match self.billing.debit_credits(&token, amount, reason, None, metadata).await {
            Ok(resp) => {
                info!(amount, reason, balance = resp.balance, tx = %resp.transaction_id, "Credits debited");
                Ok(())
            }
            Err(BillingError::InsufficientCredits { available, required }) => {
                warn!(available, required, "Insufficient credits during debit, draining remaining");
                if available > 0 {
                    match self.billing.debit_credits(&token, available, reason, None, None).await {
                        Ok(resp) => {
                            info!(amount = available, balance = resp.balance, "Drained remaining credits");
                        }
                        Err(e) => {
                            warn!(error = %e, "Failed to drain remaining credits");
                        }
                    }
                }
                self.credits_exhausted.store(true, Ordering::SeqCst);
                Err(MeteredLlmError::InsufficientCredits)
            }
            Err(e) => {
                warn!(error = %e, reason, "Failed to debit credits — flagging exhausted to stop loop");
                self.credits_exhausted.store(true, Ordering::SeqCst);
                Err(MeteredLlmError::Billing(e))
            }
        }
    }

    pub async fn complete(
        &self,
        api_key: &str,
        system_prompt: &str,
        user_message: &str,
        max_tokens: u32,
        reason: &str,
        metadata: Option<serde_json::Value>,
    ) -> Result<LlmResponse, MeteredLlmError> {
        self.pre_flight_check().await?;
        let resp = self.provider.complete(api_key, system_prompt, user_message, max_tokens).await?;
        self.debit(aura_claude::DEFAULT_MODEL, resp.input_tokens, resp.output_tokens, 0, 0, reason, metadata).await?;
        Ok(resp)
    }

    /// Like `complete`, but sends the request to a specific model (e.g. haiku
    /// for cheap auxiliary tasks). The debit is computed at that model's rates.
    pub async fn complete_with_model(
        &self,
        model: &str,
        api_key: &str,
        system_prompt: &str,
        user_message: &str,
        max_tokens: u32,
        reason: &str,
        metadata: Option<serde_json::Value>,
    ) -> Result<LlmResponse, MeteredLlmError> {
        self.pre_flight_check().await?;
        let resp = self.provider.complete_with_model(model, api_key, system_prompt, user_message, max_tokens).await?;
        self.debit(model, resp.input_tokens, resp.output_tokens, 0, 0, reason, metadata).await?;
        Ok(resp)
    }

    pub async fn complete_stream(
        &self,
        api_key: &str,
        system_prompt: &str,
        user_message: &str,
        max_tokens: u32,
        event_tx: mpsc::UnboundedSender<ClaudeStreamEvent>,
        reason: &str,
        metadata: Option<serde_json::Value>,
    ) -> Result<String, MeteredLlmError> {
        self.pre_flight_check().await?;
        let (tx, handle) = StreamTokenCapture::forwarding(event_tx);
        let result = self.provider.complete_stream(
            api_key, system_prompt, user_message, max_tokens, tx,
        ).await?;
        let (inp, out, cache_create, cache_read) = handle.finalize().await;
        self.debit(aura_claude::DEFAULT_MODEL, inp, out, cache_create, cache_read, reason, metadata).await?;
        Ok(result)
    }

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
        self.debit(aura_claude::DEFAULT_MODEL, inp, out, cache_create, cache_read, reason, metadata).await?;
        Ok(result)
    }

    pub async fn complete_stream_with_tools(
        &self,
        api_key: &str,
        system_prompt: &str,
        messages: Vec<RichMessage>,
        tools: Vec<ToolDefinition>,
        max_tokens: u32,
        thinking: Option<ThinkingConfig>,
        event_tx: mpsc::UnboundedSender<ClaudeStreamEvent>,
        reason: &str,
        metadata: Option<serde_json::Value>,
    ) -> Result<ToolStreamResponse, MeteredLlmError> {
        let estimated_input: u64 = aura_claude::estimate_tokens(system_prompt)
            + messages.iter().map(aura_claude::estimate_message_tokens).sum::<u64>();
        let estimated_credits = self.estimate_credits(aura_claude::DEFAULT_MODEL, estimated_input, 0);
        self.pre_flight_check_for(estimated_credits).await?;
        let resp = self.provider.complete_stream_with_tools(
            api_key, system_prompt, messages, tools, max_tokens, thinking, event_tx,
        ).await?;
        let billing_model = if resp.model_used.is_empty() { aura_claude::DEFAULT_MODEL } else { &resp.model_used };
        self.debit(billing_model, resp.input_tokens, resp.output_tokens, resp.cache_creation_input_tokens, resp.cache_read_input_tokens, reason, metadata).await?;
        Ok(resp)
    }
}

// ---------------------------------------------------------------------------
// LlmProvider impl — enables MeteredLlm as a transparent billing decorator.
//
// Callers that hold `Arc<dyn LlmProvider>` get automatic preflight/debit.
// A generic billing reason is used; callers needing custom reasons should
// use the inherent methods above instead.
// ---------------------------------------------------------------------------

const TRAIT_BILLING_REASON: &str = "llm_provider";

impl MeteredLlm {
    fn map_billing_err(e: MeteredLlmError) -> ClaudeClientError {
        match e {
            MeteredLlmError::InsufficientCredits => ClaudeClientError::InsufficientCredits,
            MeteredLlmError::Llm(inner) => inner,
            MeteredLlmError::Billing(be) => {
                ClaudeClientError::Api { status: 500, message: format!("billing: {be}") }
            }
        }
    }
}

#[async_trait]
impl LlmProvider for MeteredLlm {
    async fn complete(
        &self,
        api_key: &str,
        system_prompt: &str,
        user_message: &str,
        max_tokens: u32,
    ) -> Result<LlmResponse, ClaudeClientError> {
        self.pre_flight_check().await.map_err(Self::map_billing_err)?;
        let resp = self.provider.complete(api_key, system_prompt, user_message, max_tokens).await?;
        self.debit(aura_claude::DEFAULT_MODEL, resp.input_tokens, resp.output_tokens, 0, 0, TRAIT_BILLING_REASON, None)
            .await.map_err(Self::map_billing_err)?;
        Ok(resp)
    }

    async fn complete_stream(
        &self,
        api_key: &str,
        system_prompt: &str,
        user_message: &str,
        max_tokens: u32,
        event_tx: mpsc::UnboundedSender<LlmStreamEvent>,
    ) -> Result<String, ClaudeClientError> {
        self.pre_flight_check().await.map_err(Self::map_billing_err)?;
        let (tx, handle) = StreamTokenCapture::forwarding(event_tx);
        let result = self.provider.complete_stream(api_key, system_prompt, user_message, max_tokens, tx).await?;
        let (inp, out, cache_create, cache_read) = handle.finalize().await;
        self.debit(aura_claude::DEFAULT_MODEL, inp, out, cache_create, cache_read, TRAIT_BILLING_REASON, None)
            .await.map_err(Self::map_billing_err)?;
        Ok(result)
    }

    async fn complete_stream_multi(
        &self,
        api_key: &str,
        system_prompt: &str,
        messages: Vec<(String, String)>,
        max_tokens: u32,
        event_tx: mpsc::UnboundedSender<LlmStreamEvent>,
    ) -> Result<String, ClaudeClientError> {
        self.pre_flight_check().await.map_err(Self::map_billing_err)?;
        let (tx, handle) = StreamTokenCapture::forwarding(event_tx);
        let result = self.provider.complete_stream_multi(api_key, system_prompt, messages, max_tokens, tx).await?;
        let (inp, out, cache_create, cache_read) = handle.finalize().await;
        self.debit(aura_claude::DEFAULT_MODEL, inp, out, cache_create, cache_read, TRAIT_BILLING_REASON, None)
            .await.map_err(Self::map_billing_err)?;
        Ok(result)
    }

    async fn complete_stream_with_tools(
        &self,
        api_key: &str,
        system_prompt: &str,
        messages: Vec<RichMessage>,
        tools: Vec<ToolDefinition>,
        max_tokens: u32,
        thinking: Option<ThinkingConfig>,
        event_tx: mpsc::UnboundedSender<LlmStreamEvent>,
    ) -> Result<ToolStreamResponse, ClaudeClientError> {
        let estimated_input: u64 = aura_claude::estimate_tokens(system_prompt)
            + messages.iter().map(aura_claude::estimate_message_tokens).sum::<u64>();
        let estimated_credits = self.estimate_credits(aura_claude::DEFAULT_MODEL, estimated_input, 0);
        self.pre_flight_check_for(estimated_credits).await.map_err(Self::map_billing_err)?;
        let resp = self.provider.complete_stream_with_tools(
            api_key, system_prompt, messages, tools, max_tokens, thinking, event_tx,
        ).await?;
        let billing_model = if resp.model_used.is_empty() { aura_claude::DEFAULT_MODEL } else { &resp.model_used };
        self.debit(billing_model, resp.input_tokens, resp.output_tokens, resp.cache_creation_input_tokens, resp.cache_read_input_tokens, TRAIT_BILLING_REASON, None)
            .await.map_err(Self::map_billing_err)?;
        Ok(resp)
    }

    async fn complete_with_model(
        &self,
        model: &str,
        api_key: &str,
        system_prompt: &str,
        user_message: &str,
        max_tokens: u32,
    ) -> Result<LlmResponse, ClaudeClientError> {
        self.pre_flight_check().await.map_err(Self::map_billing_err)?;
        let resp = self.provider.complete_with_model(model, api_key, system_prompt, user_message, max_tokens).await?;
        self.debit(model, resp.input_tokens, resp.output_tokens, 0, 0, TRAIT_BILLING_REASON, None)
            .await.map_err(Self::map_billing_err)?;
        Ok(resp)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use aura_claude::mock::{MockLlmProvider, MockResponse};
    use crate::testutil;

    #[tokio::test]
    async fn test_no_access_token_returns_insufficient_credits() {
        let tmp = tempfile::TempDir::new().unwrap();
        let store = Arc::new(RocksStore::open(tmp.path()).unwrap());
        let billing = Arc::new(BillingClient::default());
        let mock = Arc::new(MockLlmProvider::with_responses(vec![
            MockResponse::text("unreachable"),
        ]));

        let metered = MeteredLlm::new(mock, billing, store);

        let err = metered
            .complete("key", "sys", "hi", 100, "test", None)
            .await
            .unwrap_err();

        assert!(err.is_insufficient_credits());
        assert!(metered.is_credits_exhausted());
    }

    #[tokio::test]
    async fn test_complete_calls_provider_and_debits() {
        let mock = Arc::new(MockLlmProvider::with_responses(vec![
            MockResponse::text("hello").with_tokens(100, 50),
        ]));
        let (metered, _tmp) = testutil::make_test_llm(mock.clone()).await;

        let resp = metered
            .complete("key", "sys", "msg", 200, "reason", None)
            .await
            .unwrap();

        assert_eq!(resp.text, "hello");
        assert_eq!(mock.call_count(), 1);
        assert!(!metered.is_credits_exhausted());
    }

    #[tokio::test]
    async fn test_credits_exhausted_flag_persists_across_calls() {
        let tmp = tempfile::TempDir::new().unwrap();
        let store = Arc::new(RocksStore::open(tmp.path()).unwrap());
        let billing = Arc::new(BillingClient::default());
        let mock = Arc::new(MockLlmProvider::with_responses(vec![
            MockResponse::text("a"),
            MockResponse::text("b"),
        ]));

        let metered = MeteredLlm::new(mock, billing, store);

        let r1 = metered.complete("k", "s", "m", 10, "r", None).await;
        assert!(r1.unwrap_err().is_insufficient_credits());
        assert!(metered.is_credits_exhausted());

        let r2 = metered.complete("k", "s", "m", 10, "r", None).await;
        assert!(r2.unwrap_err().is_insufficient_credits());
        assert!(metered.is_credits_exhausted());
    }

    #[tokio::test]
    async fn test_complete_stream_forwards_events() {
        let mock = Arc::new(MockLlmProvider::with_responses(vec![
            MockResponse::text("streamed").with_tokens(80, 40),
        ]));
        let (metered, _tmp) = testutil::make_test_llm(mock).await;

        let (event_tx, mut event_rx) = mpsc::unbounded_channel();
        let text = metered
            .complete_stream("key", "sys", "msg", 200, event_tx, "stream-test", None)
            .await
            .unwrap();

        assert_eq!(text, "streamed");

        let mut events = vec![];
        while let Ok(evt) = event_rx.try_recv() {
            events.push(evt);
        }
        assert!(events
            .iter()
            .any(|e| matches!(e, ClaudeStreamEvent::Delta(t) if t == "streamed")));
        assert!(events
            .iter()
            .any(|e| matches!(e, ClaudeStreamEvent::Done { .. })));
    }
}
