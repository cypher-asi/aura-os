use std::sync::Arc;

use tokio::sync::mpsc;
use tracing::{info, warn};

use aura_claude::{
    ClaudeClient, ClaudeStreamEvent, LlmResponse, RichMessage, ThinkingConfig,
    ToolDefinition, ToolStreamResponse,
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
    provider: Arc<ClaudeClient>,
    billing: Arc<BillingClient>,
    store: Arc<RocksStore>,
}

impl MeteredLlm {
    pub fn new(
        provider: Arc<ClaudeClient>,
        billing: Arc<BillingClient>,
        store: Arc<RocksStore>,
    ) -> Self {
        Self { provider, billing, store }
    }

    pub fn provider(&self) -> &ClaudeClient {
        &self.provider
    }

    pub fn provider_arc(&self) -> Arc<ClaudeClient> {
        self.provider.clone()
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
            return Ok(());
        };
        self.billing
            .ensure_has_credits(&token)
            .await
            .map_err(|_| MeteredLlmError::InsufficientCredits)?;
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
                warn!(available, required, "Insufficient credits during debit");
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
        let resp = self.provider.complete_with_usage(api_key, system_prompt, user_message, max_tokens).await?;
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

        let (inner_tx, mut inner_rx) = mpsc::unbounded_channel::<ClaudeStreamEvent>();
        let fwd_tx = event_tx.clone();
        let token_capture: Arc<tokio::sync::Mutex<(u64, u64)>> =
            Arc::new(tokio::sync::Mutex::new((0, 0)));
        let tc = token_capture.clone();

        let forwarder = tokio::spawn(async move {
            while let Some(evt) = inner_rx.recv().await {
                if let ClaudeStreamEvent::Done { input_tokens, output_tokens, .. } = &evt {
                    let mut g = tc.lock().await;
                    g.0 = *input_tokens;
                    g.1 = *output_tokens;
                }
                let _ = fwd_tx.send(evt);
            }
        });

        let result = self.provider.complete_stream(
            api_key, system_prompt, user_message, max_tokens, inner_tx,
        ).await?;
        let _ = forwarder.await;

        let (inp, out) = *token_capture.lock().await;
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

        let (inner_tx, mut inner_rx) = mpsc::unbounded_channel::<ClaudeStreamEvent>();
        let fwd_tx = event_tx.clone();
        let token_capture: Arc<tokio::sync::Mutex<(u64, u64)>> =
            Arc::new(tokio::sync::Mutex::new((0, 0)));
        let tc = token_capture.clone();

        let forwarder = tokio::spawn(async move {
            while let Some(evt) = inner_rx.recv().await {
                if let ClaudeStreamEvent::Done { input_tokens, output_tokens, .. } = &evt {
                    let mut g = tc.lock().await;
                    g.0 = *input_tokens;
                    g.1 = *output_tokens;
                }
                let _ = fwd_tx.send(evt);
            }
        });

        let result = self.provider.complete_stream_multi(
            api_key, system_prompt, messages, max_tokens, inner_tx,
        ).await?;
        let _ = forwarder.await;

        let (inp, out) = *token_capture.lock().await;
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
            api_key, system_prompt, messages, tools, max_tokens, event_tx,
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
        let resp = self.provider.complete_stream_with_tools_thinking(
            api_key, system_prompt, messages, tools, max_tokens, thinking, event_tx,
        ).await?;
        self.debit(resp.input_tokens, resp.output_tokens, reason, metadata).await;
        Ok(resp)
    }
}
