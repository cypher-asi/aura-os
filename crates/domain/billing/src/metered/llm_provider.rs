use async_trait::async_trait;
use tokio::sync::mpsc;

use aura_claude::{
    ClaudeClientError, LlmProvider, LlmResponse, LlmStreamEvent,
    StreamTokenCapture, ToolStreamRequest, ToolStreamResponse,
};

use super::{MeteredLlm, MeteredLlmError};

const TRAIT_BILLING_REASON: &str = "llm_provider";

impl MeteredLlm {
    pub(crate) fn map_billing_err(e: MeteredLlmError) -> ClaudeClientError {
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
        req: ToolStreamRequest<'_>,
    ) -> Result<ToolStreamResponse, ClaudeClientError> {
        let estimated_input: u64 = aura_claude::estimate_tokens(req.system_prompt)
            + req.messages.iter().map(aura_claude::estimate_message_tokens).sum::<u64>();
        let estimated_credits = self.estimate_credits(aura_claude::DEFAULT_MODEL, estimated_input, 0);
        self.pre_flight_check_for(estimated_credits).await.map_err(Self::map_billing_err)?;
        let resp = self.provider.complete_stream_with_tools(req).await?;
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
