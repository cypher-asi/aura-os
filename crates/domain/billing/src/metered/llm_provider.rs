use std::sync::atomic::Ordering;

use async_trait::async_trait;
use tokio::sync::mpsc;

use aura_claude::{
    ClaudeClientError, LlmProvider, LlmResponse, LlmStreamEvent, StreamTokenCapture,
    ToolStreamRequest, ToolStreamResponse,
};

use super::debit::DebitParams;
use super::{MeteredLlm, MeteredLlmError};

const TRAIT_BILLING_REASON: &str = "llm_provider";

impl MeteredLlm {
    pub(crate) fn map_billing_err(e: MeteredLlmError) -> ClaudeClientError {
        match e {
            MeteredLlmError::InsufficientCredits => ClaudeClientError::InsufficientCredits,
            MeteredLlmError::Llm(inner) => inner,
            MeteredLlmError::Billing(be) => ClaudeClientError::Api {
                status: 500,
                message: format!("billing: {be}"),
            },
        }
    }

    fn handle_llm_result_for_trait<T>(
        &self,
        result: Result<T, ClaudeClientError>,
    ) -> Result<T, ClaudeClientError> {
        match result {
            Ok(v) => Ok(v),
            Err(ClaudeClientError::InsufficientCredits) => {
                self.credits_exhausted.store(true, Ordering::SeqCst);
                Err(ClaudeClientError::InsufficientCredits)
            }
            Err(e) => Err(e),
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
        let credential = self
            .resolve_credential(api_key)
            .map_err(Self::map_billing_err)?;
        if self.router_mode {
            let result = self
                .provider
                .complete(&credential, system_prompt, user_message, max_tokens)
                .await;
            return self.handle_llm_result_for_trait(result);
        }
        self.pre_flight_check()
            .await
            .map_err(Self::map_billing_err)?;
        let resp = self
            .provider
            .complete(api_key, system_prompt, user_message, max_tokens)
            .await?;
        self.debit(DebitParams {
            model: aura_claude::DEFAULT_MODEL,
            input_tokens: resp.input_tokens,
            output_tokens: resp.output_tokens,
            cache_creation_input_tokens: 0,
            cache_read_input_tokens: 0,
            reason: TRAIT_BILLING_REASON,
            metadata: None,
        })
        .await
        .map_err(Self::map_billing_err)?;
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
        let credential = self
            .resolve_credential(api_key)
            .map_err(Self::map_billing_err)?;
        if self.router_mode {
            let result = self
                .provider
                .complete_stream(
                    &credential,
                    system_prompt,
                    user_message,
                    max_tokens,
                    event_tx,
                )
                .await;
            return self.handle_llm_result_for_trait(result);
        }
        self.pre_flight_check()
            .await
            .map_err(Self::map_billing_err)?;
        let (tx, handle) = StreamTokenCapture::forwarding(event_tx);
        let result = self
            .provider
            .complete_stream(api_key, system_prompt, user_message, max_tokens, tx)
            .await?;
        let (inp, out, cache_create, cache_read) = handle.finalize().await;
        self.debit(DebitParams {
            model: aura_claude::DEFAULT_MODEL,
            input_tokens: inp,
            output_tokens: out,
            cache_creation_input_tokens: cache_create,
            cache_read_input_tokens: cache_read,
            reason: TRAIT_BILLING_REASON,
            metadata: None,
        })
        .await
        .map_err(Self::map_billing_err)?;
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
        let credential = self
            .resolve_credential(api_key)
            .map_err(Self::map_billing_err)?;
        if self.router_mode {
            let result = self
                .provider
                .complete_stream_multi(&credential, system_prompt, messages, max_tokens, event_tx)
                .await;
            return self.handle_llm_result_for_trait(result);
        }
        self.pre_flight_check()
            .await
            .map_err(Self::map_billing_err)?;
        let (tx, handle) = StreamTokenCapture::forwarding(event_tx);
        let result = self
            .provider
            .complete_stream_multi(api_key, system_prompt, messages, max_tokens, tx)
            .await?;
        let (inp, out, cache_create, cache_read) = handle.finalize().await;
        self.debit(DebitParams {
            model: aura_claude::DEFAULT_MODEL,
            input_tokens: inp,
            output_tokens: out,
            cache_creation_input_tokens: cache_create,
            cache_read_input_tokens: cache_read,
            reason: TRAIT_BILLING_REASON,
            metadata: None,
        })
        .await
        .map_err(Self::map_billing_err)?;
        Ok(result)
    }

    async fn complete_stream_with_tools(
        &self,
        req: ToolStreamRequest<'_>,
    ) -> Result<ToolStreamResponse, ClaudeClientError> {
        let credential = self
            .resolve_credential(req.api_key)
            .map_err(Self::map_billing_err)?;
        if self.router_mode {
            let inner_req = ToolStreamRequest {
                api_key: &credential,
                ..req
            };
            let result = self.provider.complete_stream_with_tools(inner_req).await;
            return self.handle_llm_result_for_trait(result);
        }
        let estimated_input: u64 = aura_claude::estimate_tokens(req.system_prompt)
            + req
                .messages
                .iter()
                .map(aura_claude::estimate_message_tokens)
                .sum::<u64>();
        let estimated_credits =
            self.estimate_credits(aura_claude::DEFAULT_MODEL, estimated_input, 0);
        self.pre_flight_check_for(estimated_credits)
            .await
            .map_err(Self::map_billing_err)?;
        let resp = self.provider.complete_stream_with_tools(req).await?;
        let billing_model = if resp.model_used.is_empty() {
            aura_claude::DEFAULT_MODEL
        } else {
            &resp.model_used
        };
        self.debit(DebitParams {
            model: billing_model,
            input_tokens: resp.input_tokens,
            output_tokens: resp.output_tokens,
            cache_creation_input_tokens: resp.cache_creation_input_tokens,
            cache_read_input_tokens: resp.cache_read_input_tokens,
            reason: TRAIT_BILLING_REASON,
            metadata: None,
        })
        .await
        .map_err(Self::map_billing_err)?;
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
        let credential = self
            .resolve_credential(api_key)
            .map_err(Self::map_billing_err)?;
        if self.router_mode {
            let result = self
                .provider
                .complete_with_model(model, &credential, system_prompt, user_message, max_tokens)
                .await;
            return self.handle_llm_result_for_trait(result);
        }
        self.pre_flight_check()
            .await
            .map_err(Self::map_billing_err)?;
        let resp = self
            .provider
            .complete_with_model(model, api_key, system_prompt, user_message, max_tokens)
            .await?;
        self.debit(DebitParams {
            model,
            input_tokens: resp.input_tokens,
            output_tokens: resp.output_tokens,
            cache_creation_input_tokens: 0,
            cache_read_input_tokens: 0,
            reason: TRAIT_BILLING_REASON,
            metadata: None,
        })
        .await
        .map_err(Self::map_billing_err)?;
        Ok(resp)
    }
}
