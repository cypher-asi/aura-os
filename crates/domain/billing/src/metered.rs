use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};

use tokio::sync::mpsc;
use tracing::{info, warn};

use aura_claude::{
    ClaudeStreamEvent, LlmProvider, LlmResponse, RichMessage,
    StreamTokenCapture, ThinkingConfig, ToolDefinition, ToolStreamResponse,
};
use aura_core::ZeroAuthSession;
use aura_store::RocksStore;

use crate::client::BillingClient;
use crate::error::BillingError;

#[derive(Debug, thiserror::Error)]
pub enum MeteredLlmError {
    #[error("Insufficient credits")]
    InsufficientCredits,

    #[error("LLM error: {0}")]
    Llm(#[from] aura_claude::ClaudeClientError),

    #[error("Billing error: {0}")]
    Billing(#[from] BillingError),
}

pub struct MeteredLlm {
    provider: Arc<dyn LlmProvider>,
    billing: Arc<BillingClient>,
    store: Arc<RocksStore>,
    credits_exhausted: AtomicBool,
}

impl MeteredLlm {
    pub fn new(
        provider: Arc<dyn LlmProvider>,
        billing: Arc<BillingClient>,
        store: Arc<RocksStore>,
    ) -> Self {
        Self {
            provider,
            billing,
            store,
            credits_exhausted: AtomicBool::new(false),
        }
    }

    pub fn is_credits_exhausted(&self) -> bool {
        self.credits_exhausted.load(Ordering::SeqCst)
    }

    fn access_token(&self) -> Option<String> {
        self.store
            .get_setting("zero_auth_session")
            .ok()
            .and_then(|bytes| serde_json::from_slice::<ZeroAuthSession>(&bytes).ok())
            .map(|s| s.access_token)
    }

    async fn pre_flight_check(&self) -> Result<(), MeteredLlmError> {
        let Some(token) = self.access_token() else {
            warn!("No access token available — cannot verify credits");
            self.credits_exhausted.store(true, Ordering::SeqCst);
            return Err(MeteredLlmError::InsufficientCredits);
        };
        if self.credits_exhausted.load(Ordering::SeqCst) {
            match self.billing.ensure_has_credits(&token).await {
                Ok(_) => {
                    info!("Credits topped up, resetting exhausted flag");
                    self.credits_exhausted.store(false, Ordering::SeqCst);
                }
                Err(_) => return Err(MeteredLlmError::InsufficientCredits),
            }
        } else {
            if let Err(_) = self.billing.ensure_has_credits(&token).await {
                self.credits_exhausted.store(true, Ordering::SeqCst);
                return Err(MeteredLlmError::InsufficientCredits);
            }
        }
        Ok(())
    }

    async fn debit(
        &self,
        input_tokens: u64,
        output_tokens: u64,
        reason: &str,
        metadata: Option<serde_json::Value>,
    ) {
        let amount = input_tokens + output_tokens;
        if amount == 0 {
            return;
        }
        let Some(token) = self.access_token() else {
            warn!("No access token available for credit debit");
            return;
        };
        match self.billing.debit_credits(&token, amount, reason, None, metadata).await {
            Ok(resp) => {
                info!(amount, reason, balance = resp.balance, tx = %resp.transaction_id, "Credits debited");
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
            }
            Err(e) => {
                warn!(error = %e, reason, "Failed to debit credits");
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
        self.debit(resp.input_tokens, resp.output_tokens, reason, metadata).await;
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
        let (inp, out) = handle.finalize().await;
        self.debit(inp, out, reason, metadata).await;
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
        let (inp, out) = handle.finalize().await;
        self.debit(inp, out, reason, metadata).await;
        Ok(result)
    }

    pub async fn complete_stream_with_tools(
        &self,
        api_key: &str,
        system_prompt: &str,
        messages: Vec<RichMessage>,
        tools: Vec<ToolDefinition>,
        max_tokens: u32,
        event_tx: mpsc::UnboundedSender<ClaudeStreamEvent>,
        reason: &str,
        metadata: Option<serde_json::Value>,
    ) -> Result<ToolStreamResponse, MeteredLlmError> {
        self.pre_flight_check().await?;
        let resp = self.provider.complete_stream_with_tools(
            api_key, system_prompt, messages, tools, max_tokens, None, event_tx,
        ).await?;
        self.debit(resp.input_tokens, resp.output_tokens, reason, metadata).await;
        Ok(resp)
    }

    pub async fn complete_stream_with_tools_thinking(
        &self,
        api_key: &str,
        system_prompt: &str,
        messages: Vec<RichMessage>,
        tools: Vec<ToolDefinition>,
        max_tokens: u32,
        thinking: ThinkingConfig,
        event_tx: mpsc::UnboundedSender<ClaudeStreamEvent>,
        reason: &str,
        metadata: Option<serde_json::Value>,
    ) -> Result<ToolStreamResponse, MeteredLlmError> {
        self.pre_flight_check().await?;
        let resp = self.provider.complete_stream_with_tools(
            api_key, system_prompt, messages, tools, max_tokens, Some(thinking), event_tx,
        ).await?;
        self.debit(resp.input_tokens, resp.output_tokens, reason, metadata).await;
        Ok(resp)
    }
}
